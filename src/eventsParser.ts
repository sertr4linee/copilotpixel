import * as path from 'path';
import type * as vscode from 'vscode';

import {
  BASH_COMMAND_DISPLAY_MAX_LENGTH,
  TASK_DESCRIPTION_DISPLAY_MAX_LENGTH,
  TEXT_IDLE_DELAY_MS,
  TOOL_DONE_DELAY_MS,
} from './constants.js';
import {
  cancelPermissionTimer,
  cancelWaitingTimer,
  clearAgentActivity,
  startPermissionTimer,
  startWaitingTimer,
} from './timerManager.js';
import type { SessionState } from './types.js';

// Tools that never block on permission — safe to ignore for permission heuristic
export const PERMISSION_EXEMPT_TOOLS = new Set([
  'task',
  'report_intent',
  'store_memory',
]);

/**
 * Map a Copilot CLI tool name + arguments to a human-readable status string.
 */
export function formatToolStatus(toolName: string, args: Record<string, unknown>): string {
  const base = (p: unknown) => (typeof p === 'string' ? path.basename(p) : '');

  switch (toolName) {
    case 'bash': {
      const cmd = (args.command as string) || '';
      return `Running: ${cmd.length > BASH_COMMAND_DISPLAY_MAX_LENGTH ? cmd.slice(0, BASH_COMMAND_DISPLAY_MAX_LENGTH) + '\u2026' : cmd}`;
    }
    case 'view':
      return `Reading ${base(args.path ?? args.file_path)}`;
    case 'edit':
      return `Editing ${base(args.path ?? args.file_path)}`;
    case 'create':
      return `Creating ${base(args.path ?? args.file_path)}`;
    case 'grep':
      return 'Searching code';
    case 'glob':
      return 'Searching files';
    case 'task': {
      const desc = typeof args.description === 'string' ? args.description : '';
      return desc
        ? `Subtask: ${desc.length > TASK_DESCRIPTION_DISPLAY_MAX_LENGTH ? desc.slice(0, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH) + '\u2026' : desc}`
        : 'Running subtask';
    }
    case 'ask_user':
      return 'Waiting for your answer';
    case 'report_intent': {
      const intent = typeof args.intent === 'string' ? args.intent : '';
      return intent ? `Planning: ${intent}` : 'Planning...';
    }
    case 'store_memory':
      return 'Saving memory';
    case 'sql':
      return 'Querying database';
    case 'web_search':
      return 'Searching the web';
    case 'web_fetch':
      return 'Fetching web content';
    default: {
      // MCP tools: github-mcp-server-*, playwright-browser_*, ide-*, vibekanban-*
      if (toolName.startsWith('github-mcp-server-')) {
        const method = toolName.replace('github-mcp-server-', '');
        return `GitHub: ${method}`;
      }
      if (toolName.startsWith('playwright-browser_')) {
        const action = toolName.replace('playwright-browser_', '');
        return `Browser: ${action}`;
      }
      if (toolName.startsWith('ide-')) {
        const action = toolName.replace('ide-', '');
        return `IDE: ${action}`;
      }
      if (toolName.startsWith('vibekanban-')) {
        const action = toolName.replace('vibekanban-', '');
        return `Project: ${action}`;
      }
      if (toolName.startsWith('context7-')) {
        return 'Fetching docs';
      }
      return `Using ${toolName}`;
    }
  }
}

/**
 * Process a single line from events.jsonl (Copilot CLI format).
 *
 * Copilot CLI event types:
 *   session.start         → capture metadata (cwd, branch, repo)
 *   user.message          → new user turn, reset state
 *   assistant.turn_start  → agent becomes active
 *   assistant.message     → contains toolRequests array
 *   tool.execution_start  → tool starts
 *   tool.execution_complete → tool finishes
 *   assistant.turn_end    → turn ends → set waiting
 *   hook.start            → possible permission prompt (PreToolUse blocked)
 *   hook.end              → hook resolved
 */
export function processEventsLine(
  agentId: number,
  line: string,
  agents: Map<number, SessionState>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  webview: vscode.Webview | undefined,
): void {
  const agent = agents.get(agentId);
  if (!agent) return;

  let record: Record<string, unknown>;
  try {
    record = JSON.parse(line);
  } catch {
    return; // Ignore malformed lines
  }

  const type = record.type as string;
  const data = (record.data ?? {}) as Record<string, unknown>;

  switch (type) {
    case 'session.start': {
      const ctx = (data.context ?? {}) as Record<string, unknown>;
      agent.cwd = ctx.cwd as string | undefined;
      agent.branch = ctx.branch as string | undefined;
      agent.repository = ctx.repository as string | undefined;
      // Notify webview of metadata update
      webview?.postMessage({
        type: 'sessionMetadata',
        id: agentId,
        branch: agent.branch,
        repository: agent.repository,
        cwd: agent.cwd,
      });
      break;
    }

    case 'user.message': {
      // New user turn — reset all activity
      cancelWaitingTimer(agentId, waitingTimers);
      clearAgentActivity(agent, agentId, permissionTimers, webview);
      agent.hadToolsInTurn = false;
      break;
    }

    case 'assistant.turn_start': {
      cancelWaitingTimer(agentId, waitingTimers);
      agent.isWaiting = false;
      webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
      break;
    }

    case 'assistant.message': {
      // toolRequests: [{toolCallId, name, arguments}]
      const toolRequests = data.toolRequests as Array<{
        toolCallId: string;
        name: string;
        arguments: Record<string, unknown>;
      }> | undefined;

      if (!toolRequests || toolRequests.length === 0) {
        // Text-only turn — use silence timer
        if (!agent.hadToolsInTurn) {
          startWaitingTimer(agentId, TEXT_IDLE_DELAY_MS, agents, waitingTimers, webview);
        }
        break;
      }

      cancelWaitingTimer(agentId, waitingTimers);
      agent.hadToolsInTurn = true;
      break;
    }

    case 'tool.execution_start': {
      const toolCallId = data.toolCallId as string;
      const toolName = data.toolName as string;
      const toolArgs = (data.arguments ?? {}) as Record<string, unknown>;

      if (!toolCallId || !toolName) break;

      cancelWaitingTimer(agentId, waitingTimers);
      agent.isWaiting = false;
      agent.hadToolsInTurn = true;

      const status = formatToolStatus(toolName, toolArgs);
      agent.activeToolIds.add(toolCallId);
      agent.activeToolStatuses.set(toolCallId, status);
      agent.activeToolNames.set(toolCallId, toolName);

      webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
      webview?.postMessage({ type: 'agentToolStart', id: agentId, toolId: toolCallId, status });

      // Sub-agent detection: task tool spawns a sub-agent
      const parentToolId = data.parentToolCallId as string | undefined;
      if (parentToolId && agent.activeToolNames.get(parentToolId) === 'task') {
        let subTools = agent.activeSubagentToolIds.get(parentToolId);
        if (!subTools) {
          subTools = new Set();
          agent.activeSubagentToolIds.set(parentToolId, subTools);
        }
        subTools.add(toolCallId);

        let subNames = agent.activeSubagentToolNames.get(parentToolId);
        if (!subNames) {
          subNames = new Map();
          agent.activeSubagentToolNames.set(parentToolId, subNames);
        }
        subNames.set(toolCallId, toolName);

        webview?.postMessage({
          type: 'subagentToolStart',
          id: agentId,
          parentToolId,
          toolId: toolCallId,
          status,
        });
      }

      if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
        startPermissionTimer(agentId, agents, permissionTimers, PERMISSION_EXEMPT_TOOLS, webview);
      }
      break;
    }

    case 'tool.execution_complete': {
      const toolCallId = data.toolCallId as string;
      if (!toolCallId) break;

      const completedToolName = agent.activeToolNames.get(toolCallId);

      // If a task sub-agent completed, clear its children
      if (completedToolName === 'task') {
        agent.activeSubagentToolIds.delete(toolCallId);
        agent.activeSubagentToolNames.delete(toolCallId);
        webview?.postMessage({ type: 'subagentClear', id: agentId, parentToolId: toolCallId });
      }

      // Remove from sub-agent tracking if this was a sub-tool
      for (const [parentId, subTools] of agent.activeSubagentToolIds) {
        if (subTools.has(toolCallId)) {
          subTools.delete(toolCallId);
          agent.activeSubagentToolNames.get(parentId)?.delete(toolCallId);
          const tid = toolCallId;
          const pid = parentId;
          setTimeout(() => {
            webview?.postMessage({ type: 'subagentToolDone', id: agentId, parentToolId: pid, toolId: tid });
          }, TOOL_DONE_DELAY_MS);
          break;
        }
      }

      agent.activeToolIds.delete(toolCallId);
      agent.activeToolStatuses.delete(toolCallId);
      agent.activeToolNames.delete(toolCallId);

      const tid = toolCallId;
      setTimeout(() => {
        webview?.postMessage({ type: 'agentToolDone', id: agentId, toolId: tid });
      }, TOOL_DONE_DELAY_MS);

      // All tools completed — allow text-idle timer
      if (agent.activeToolIds.size === 0) {
        agent.hadToolsInTurn = false;
      }
      break;
    }

    case 'assistant.turn_end': {
      cancelWaitingTimer(agentId, waitingTimers);
      cancelPermissionTimer(agentId, permissionTimers);

      // Clean up any stale tool state
      if (agent.activeToolIds.size > 0) {
        agent.activeToolIds.clear();
        agent.activeToolStatuses.clear();
        agent.activeToolNames.clear();
        agent.activeSubagentToolIds.clear();
        agent.activeSubagentToolNames.clear();
        webview?.postMessage({ type: 'agentToolsClear', id: agentId });
      }

      agent.isWaiting = true;
      agent.permissionSent = false;
      agent.hadToolsInTurn = false;
      webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'waiting' });
      break;
    }

    case 'hook.start': {
      // PreToolUse hook starting — may block on permission
      const hookType = data.hookType as string | undefined;
      if (hookType === 'PreToolUse' && agent.activeToolIds.size > 0) {
        // A PreToolUse hook means user confirmation may be needed
        agent.permissionSent = true;
        console.log(`[Copilot Pixel] Agent ${agentId}: PreToolUse hook started — possible permission`);
        webview?.postMessage({ type: 'agentToolPermission', id: agentId });
      }
      break;
    }

    case 'hook.end': {
      // Hook resolved — clear permission state
      if (agent.permissionSent) {
        agent.permissionSent = false;
        webview?.postMessage({ type: 'agentToolPermissionClear', id: agentId });
      }
      break;
    }

    default:
      // Unknown event types are silently ignored
      break;
  }
}
