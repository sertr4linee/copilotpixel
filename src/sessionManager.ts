import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  COPILOT_SESSIONS_DIR,
  EVENTS_FILE_NAME,
  JSONL_POLL_INTERVAL_MS,
  SESSION_SCAN_INTERVAL_MS,
  WORKSPACE_KEY_AGENT_SEATS,
  WORKSPACE_KEY_AGENTS,
} from './constants.js';
import { migrateAndLoadLayout } from './layoutPersistence.js';
import { readNewLines, startFileWatching } from './sessionFileWatcher.js';
import { cancelPermissionTimer, cancelWaitingTimer } from './timerManager.js';
import type { PersistedSession, SessionState } from './types.js';

export function getSessionsBasePath(): string {
  return path.join(os.homedir(), COPILOT_SESSIONS_DIR);
}

/**
 * Read the workspace.yaml from a session directory and extract cwd / git_root.
 * Returns null if the file doesn't exist or can't be parsed.
 */
export function readSessionWorkspaceMeta(
  sessionDir: string,
): { cwd: string; gitRoot?: string } | null {
  const yamlPath = path.join(sessionDir, 'workspace.yaml');
  try {
    if (!fs.existsSync(yamlPath)) return null;
    const content = fs.readFileSync(yamlPath, 'utf-8');
    const cwd = content.match(/^cwd:\s*(.+)$/m)?.[1]?.trim();
    if (!cwd) return null;
    const gitRoot = content.match(/^git_root:\s*(.+)$/m)?.[1]?.trim();
    return { cwd, gitRoot };
  } catch {
    return null;
  }
}

/**
 * Returns true if the session belongs to one of the provided workspace paths.
 * If `workspacePaths` is empty/null, every session matches (show-all mode).
 */
export function sessionMatchesWorkspace(
  sessionId: string,
  workspacePaths: readonly string[],
): boolean {
  if (workspacePaths.length === 0) return true;
  const base = getSessionsBasePath();
  const meta = readSessionWorkspaceMeta(path.join(base, sessionId));
  // If we can't determine the workspace, exclude in filtered mode (conservative)
  if (!meta) return false;
  return workspacePaths.some(
    (wp) => meta.cwd === wp || meta.gitRoot === wp,
  );
}

/**
 * Discover all active Copilot CLI session directories.
 * Returns the set of session UUIDs found under ~/.copilot/session-state/
 */
export function discoverSessionDirs(): string[] {
  const base = getSessionsBasePath();
  try {
    if (!fs.existsSync(base)) return [];
    return fs
      .readdirSync(base, { withFileTypes: true })
      .filter(
        (e) =>
          e.isDirectory() &&
          /^[0-9a-f-]{36}$/i.test(e.name) &&
          fs.existsSync(path.join(base, e.name, EVENTS_FILE_NAME)),
      )
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Remove all agents whose sessions do not match the given workspace paths.
 * Sends `agentClosed` for each removed agent. Used when switching to workspace-only mode.
 */
export function pruneAgentsOutsideWorkspace(
  agents: Map<number, SessionState>,
  knownSessionIds: Set<string>,
  workspacePaths: readonly string[],
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
  webview: vscode.Webview | undefined,
  persistSessions: () => void,
): void {
  const toRemove: number[] = [];
  for (const [id, agent] of agents) {
    if (!sessionMatchesWorkspace(agent.sessionId, workspacePaths)) {
      toRemove.push(id);
    }
  }
  for (const id of toRemove) {
    const agent = agents.get(id);
    if (agent) knownSessionIds.delete(agent.sessionId);
    removeAgent(
      id,
      agents,
      fileWatchers,
      pollingTimers,
      waitingTimers,
      permissionTimers,
      jsonlPollTimers,
      persistSessions,
    );
    webview?.postMessage({ type: 'agentClosed', id });
  }
}

/**
 * Silently register all currently discovered sessions into `agents` and `knownSessionIds`
 * WITHOUT sending any `agentCreated` webview messages.
 *
 * Call this at startup BEFORE `sendExistingAgents` so the full list is available for
 * the `existingAgents` message. `restoreSessions()` already handles previously-persisted
 * sessions, so only newly-found ones are registered here.
 */
export function seedInitialSessions(
  knownSessionIds: Set<string>,
  nextAgentIdRef: { current: number },
  agents: Map<number, SessionState>,
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
  persistSessions: () => void,
  workspacePaths: readonly string[] = [],
): void {
  const managedSessionIds = new Set<string>(
    [...agents.values()].map((a) => a.sessionId),
  );
  for (const sessionId of discoverSessionDirs()) {
    if (!sessionMatchesWorkspace(sessionId, workspacePaths)) continue;
    if (!knownSessionIds.has(sessionId)) {
      knownSessionIds.add(sessionId);
      if (!managedSessionIds.has(sessionId)) {
        // Pass undefined for webview so no agentCreated message is posted
        registerNewSession(
          sessionId,
          nextAgentIdRef,
          agents,
          fileWatchers,
          pollingTimers,
          waitingTimers,
          permissionTimers,
          jsonlPollTimers,
          undefined,
          persistSessions,
        );
      }
    }
  }
}

/**
 * Ensure the session scan interval is running.
 * Only catches sessions that appear AFTER startup — `seedInitialSessions` handles
 * existing ones. New sessions discovered by the interval DO send `agentCreated`.
 */
export function ensureSessionScan(
  knownSessionIds: Set<string>,
  sessionScanTimerRef: { current: ReturnType<typeof setInterval> | null },
  nextAgentIdRef: { current: number },
  agents: Map<number, SessionState>,
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
  webview: vscode.Webview | undefined,
  persistSessions: () => void,
  workspacePaths: readonly string[] = [],
): void {
  if (sessionScanTimerRef.current) return;

  sessionScanTimerRef.current = setInterval(() => {
    scanForNewSessions(
      knownSessionIds,
      nextAgentIdRef,
      agents,
      fileWatchers,
      pollingTimers,
      waitingTimers,
      permissionTimers,
      jsonlPollTimers,
      webview,
      persistSessions,
      workspacePaths,
    );
  }, SESSION_SCAN_INTERVAL_MS);
}

/**
 * Scan for sessions not yet known and register them, sending `agentCreated` for each.
 * Used by the interval timer and by the manual rescan handler.
 */
export function scanForNewSessions(
  knownSessionIds: Set<string>,
  nextAgentIdRef: { current: number },
  agents: Map<number, SessionState>,
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
  webview: vscode.Webview | undefined,
  persistSessions: () => void,
  workspacePaths: readonly string[] = [],
): void {
  // Build set of session IDs that already have an agent (guards against duplicates on rescan)
  const managedSessionIds = new Set<string>(
    [...agents.values()].map((a) => a.sessionId),
  );

  const discovered = discoverSessionDirs();
  for (const sessionId of discovered) {
    if (!sessionMatchesWorkspace(sessionId, workspacePaths)) continue;
    if (!knownSessionIds.has(sessionId)) {
      knownSessionIds.add(sessionId);
      if (!managedSessionIds.has(sessionId)) {
        registerNewSession(
          sessionId,
          nextAgentIdRef,
          agents,
          fileWatchers,
          pollingTimers,
          waitingTimers,
          permissionTimers,
          jsonlPollTimers,
          webview,
          persistSessions,
        );
      }
    }
  }
}

function registerNewSession(
  sessionId: string,
  nextAgentIdRef: { current: number },
  agents: Map<number, SessionState>,
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
  webview: vscode.Webview | undefined,
  persistSessions: () => void,
): void {
  const eventsDir = path.join(getSessionsBasePath(), sessionId);
  const eventsFile = path.join(eventsDir, EVENTS_FILE_NAME);

  const id = nextAgentIdRef.current++;
  const agent: SessionState = {
    id,
    sessionId,
    eventsDir,
    eventsFile,
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
  };

  agents.set(id, agent);
  persistSessions();
  console.log(`[Copilot Pixel] Agent ${id}: registered session ${sessionId}`);
  webview?.postMessage({ type: 'agentCreated', id, folderName: sessionId.slice(0, 8) });

  // Poll for events.jsonl to appear (session may have just started)
  const pollTimer = setInterval(() => {
    try {
      if (fs.existsSync(eventsFile)) {
        clearInterval(pollTimer);
        jsonlPollTimers.delete(id);
        startFileWatching(
          id,
          eventsFile,
          agents,
          fileWatchers,
          pollingTimers,
          waitingTimers,
          permissionTimers,
          webview,
        );
        readNewLines(id, agents, waitingTimers, permissionTimers, webview);
      }
    } catch {
      /* file may not exist yet */
    }
  }, JSONL_POLL_INTERVAL_MS);
  jsonlPollTimers.set(id, pollTimer);
}

export function removeAgent(
  agentId: number,
  agents: Map<number, SessionState>,
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
  persistSessions: () => void,
): void {
  const agent = agents.get(agentId);
  if (!agent) return;

  const jpTimer = jsonlPollTimers.get(agentId);
  if (jpTimer) clearInterval(jpTimer);
  jsonlPollTimers.delete(agentId);

  fileWatchers.get(agentId)?.close();
  fileWatchers.delete(agentId);

  const pt = pollingTimers.get(agentId);
  if (pt) clearInterval(pt);
  pollingTimers.delete(agentId);

  try {
    fs.unwatchFile(agent.eventsFile);
  } catch {
    /* ignore */
  }

  cancelWaitingTimer(agentId, waitingTimers);
  cancelPermissionTimer(agentId, permissionTimers);

  agents.delete(agentId);
  persistSessions();
}

export function persistSessions(
  agents: Map<number, SessionState>,
  context: vscode.ExtensionContext,
): void {
  const persisted: PersistedSession[] = [];
  for (const agent of agents.values()) {
    persisted.push({
      id: agent.id,
      sessionId: agent.sessionId,
      eventsFile: agent.eventsFile,
      eventsDir: agent.eventsDir,
      branch: agent.branch,
      repository: agent.repository,
      cwd: agent.cwd,
    });
  }
  context.workspaceState.update(WORKSPACE_KEY_AGENTS, persisted);
}

export function restoreSessions(
  context: vscode.ExtensionContext,
  nextAgentIdRef: { current: number },
  agents: Map<number, SessionState>,
  knownSessionIds: Set<string>,
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
  webview: vscode.Webview | undefined,
  doPersist: () => void,
): void {
  const persisted = context.workspaceState.get<PersistedSession[]>(WORKSPACE_KEY_AGENTS, []);
  if (persisted.length === 0) return;

  let maxId = 0;

  for (const p of persisted) {
    // Only restore sessions whose events.jsonl still exists
    if (!fs.existsSync(p.eventsFile)) continue;

    const agent: SessionState = {
      id: p.id,
      sessionId: p.sessionId,
      eventsDir: p.eventsDir,
      eventsFile: p.eventsFile,
      fileOffset: 0,
      lineBuffer: '',
      activeToolIds: new Set(),
      activeToolStatuses: new Map(),
      activeToolNames: new Map(),
      activeSubagentToolIds: new Map(),
      activeSubagentToolNames: new Map(),
      isWaiting: false,
      permissionSent: false,
      hadToolsInTurn: false,
      branch: p.branch,
      repository: p.repository,
      cwd: p.cwd,
    };

    agents.set(p.id, agent);
    knownSessionIds.add(p.sessionId);

    if (p.id > maxId) maxId = p.id;

    try {
      const stat = fs.statSync(p.eventsFile);
      agent.fileOffset = stat.size; // Skip to end — only watch new events
      startFileWatching(
        p.id,
        p.eventsFile,
        agents,
        fileWatchers,
        pollingTimers,
        waitingTimers,
        permissionTimers,
        webview,
      );
    } catch {
      /* stat may fail — poll for file */
      const pollTimer = setInterval(() => {
        try {
          if (fs.existsSync(agent.eventsFile)) {
            clearInterval(pollTimer);
            jsonlPollTimers.delete(p.id);
            const stat = fs.statSync(agent.eventsFile);
            agent.fileOffset = stat.size;
            startFileWatching(p.id, agent.eventsFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
          }
        } catch {
          /* ignore */
        }
      }, JSONL_POLL_INTERVAL_MS);
      jsonlPollTimers.set(p.id, pollTimer);
    }

    console.log(`[Copilot Pixel] Restored session ${p.id} → ${p.sessionId}`);
  }

  if (maxId >= nextAgentIdRef.current) {
    nextAgentIdRef.current = maxId + 1;
  }

  doPersist();
}

export function sendExistingAgents(
  agents: Map<number, SessionState>,
  context: vscode.ExtensionContext,
  webview: vscode.Webview | undefined,
): void {
  if (!webview) return;

  const agentIds = [...agents.keys()].sort((a, b) => a - b);
  const agentMeta = context.workspaceState.get<
    Record<string, { palette?: number; seatId?: string }>
  >(WORKSPACE_KEY_AGENT_SEATS, {});

  const folderNames: Record<number, string> = {};
  const sessionMeta: Record<number, { branch?: string; repository?: string; cwd?: string }> = {};

  for (const [id, agent] of agents) {
    folderNames[id] = agent.sessionId.slice(0, 8);
    if (agent.branch || agent.repository || agent.cwd) {
      sessionMeta[id] = { branch: agent.branch, repository: agent.repository, cwd: agent.cwd };
    }
  }

  webview.postMessage({
    type: 'existingAgents',
    agents: agentIds,
    agentMeta,
    folderNames,
    sessionMeta,
  });

  sendCurrentAgentStatuses(agents, webview);
}

export function sendCurrentAgentStatuses(
  agents: Map<number, SessionState>,
  webview: vscode.Webview | undefined,
): void {
  if (!webview) return;
  for (const [agentId, agent] of agents) {
    for (const [toolId, status] of agent.activeToolStatuses) {
      webview.postMessage({ type: 'agentToolStart', id: agentId, toolId, status });
    }
    if (agent.isWaiting) {
      webview.postMessage({ type: 'agentStatus', id: agentId, status: 'waiting' });
    }
  }
}

export function sendLayout(
  context: vscode.ExtensionContext,
  webview: vscode.Webview | undefined,
  defaultLayout?: Record<string, unknown> | null,
): void {
  if (!webview) return;
  const result = migrateAndLoadLayout(context, defaultLayout);
  webview.postMessage({
    type: 'layoutLoaded',
    layout: result?.layout ?? null,
    wasReset: result?.wasReset ?? false,
  });
}
