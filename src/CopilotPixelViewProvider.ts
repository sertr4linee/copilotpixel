import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  loadCharacterSprites,
  loadDefaultLayout,
  loadFloorTiles,
  loadFurnitureAssets,
  loadWallTiles,
  sendAssetsToWebview,
  sendCharacterSpritesToWebview,
  sendFloorTilesToWebview,
  sendWallTilesToWebview,
} from './assetLoader.js';
import {
  GLOBAL_KEY_SOUND_ENABLED,
  LAYOUT_REVISION_KEY,
  WORKSPACE_KEY_AGENT_SEATS,
} from './constants.js';
import type { LayoutWatcher } from './layoutPersistence.js';
import { readLayoutFromFile, watchLayoutFile, writeLayoutToFile } from './layoutPersistence.js';
import {
  ensureSessionScan,
  getSessionsBasePath,
  persistSessions,
  pruneAgentsOutsideWorkspace,
  removeAgent,
  restoreSessions,
  scanForNewSessions,
  seedInitialSessions,
  sendExistingAgents,
  sendLayout,
} from './sessionManager.js';
import {
  createSkill,
  deleteSkill,
  scanSkills,
  setSkillEnabled,
} from './skillsScanner.js';
import type { SessionState } from './types.js';

export class CopilotPixelViewProvider implements vscode.WebviewViewProvider {
  nextAgentId = { current: 1 };
  agents = new Map<number, SessionState>();
  webviewView: vscode.WebviewView | undefined;

  // Per-agent timers
  fileWatchers = new Map<number, fs.FSWatcher>();
  pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
  waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  jsonlPollTimers = new Map<number, ReturnType<typeof setInterval>>();
  permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();

  // Session discovery
  knownSessionIds = new Set<string>();
  sessionScanTimer = { current: null as ReturnType<typeof setInterval> | null };
  showAllSessions = false; // default: workspace-only mode

  private get workspacePaths(): string[] {
    if (this.showAllSessions) return [];
    return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  }

  // Bundled default layout
  defaultLayout: Record<string, unknown> | null = null;

  // Cross-window layout sync
  layoutWatcher: LayoutWatcher | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {}

  private get extensionUri(): vscode.Uri {
    return this.context.extensionUri;
  }

  private get webview(): vscode.Webview | undefined {
    return this.webviewView?.webview;
  }

  private persistSessions = (): void => {
    persistSessions(this.agents, this.context);
  };

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.webviewView = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getWebviewContent(webviewView.webview, this.extensionUri);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'rescanSessions') {
        this.knownSessionIds.clear();
        if (this.sessionScanTimer.current) {
          clearInterval(this.sessionScanTimer.current);
          this.sessionScanTimer.current = null;
        }
        scanForNewSessions(
          this.knownSessionIds,
          this.nextAgentId,
          this.agents,
          this.fileWatchers,
          this.pollingTimers,
          this.waitingTimers,
          this.permissionTimers,
          this.jsonlPollTimers,
          this.webview,
          this.persistSessions,
          this.workspacePaths,
        );
        this.startSessionScan();
      } else if (message.type === 'setShowAllSessions') {
        const showAll = message.showAll as boolean;
        if (this.showAllSessions === showAll) return;
        this.showAllSessions = showAll;
        if (!showAll) {
          // Switched to workspace-only: remove agents not belonging to this workspace
          pruneAgentsOutsideWorkspace(
            this.agents,
            this.knownSessionIds,
            this.workspacePaths,
            this.fileWatchers,
            this.pollingTimers,
            this.waitingTimers,
            this.permissionTimers,
            this.jsonlPollTimers,
            this.webview,
            this.persistSessions,
          );
        } else {
          // Switched to show-all: discover sessions from other workspaces
          scanForNewSessions(
            this.knownSessionIds,
            this.nextAgentId,
            this.agents,
            this.fileWatchers,
            this.pollingTimers,
            this.waitingTimers,
            this.permissionTimers,
            this.jsonlPollTimers,
            this.webview,
            this.persistSessions,
            [], // empty = no filter
          );
        }
        // Confirm state change back to webview so the toggle button updates
        this.webview?.postMessage({ type: 'showAllSessionsChanged', showAllSessions: showAll });

        // Restart interval with updated filter
        if (this.sessionScanTimer.current) {
          clearInterval(this.sessionScanTimer.current);
          this.sessionScanTimer.current = null;
        }
        this.startSessionScan();
      } else if (message.type === 'focusAgent') {
        // No terminal to focus in Copilot CLI mode — open the session folder instead
        const agent = this.agents.get(message.id as number);
        if (agent && fs.existsSync(agent.eventsDir)) {
          vscode.env.openExternal(vscode.Uri.file(agent.eventsDir));
        }
      } else if (message.type === 'closeAgent') {
        const id = message.id as number;
        removeAgent(
          id,
          this.agents,
          this.fileWatchers,
          this.pollingTimers,
          this.waitingTimers,
          this.permissionTimers,
          this.jsonlPollTimers,
          this.persistSessions,
        );
        webviewView.webview.postMessage({ type: 'agentClosed', id });
      } else if (message.type === 'saveAgentSeats') {
        this.context.workspaceState.update(WORKSPACE_KEY_AGENT_SEATS, message.seats);
      } else if (message.type === 'saveLayout') {
        this.layoutWatcher?.markOwnWrite();
        writeLayoutToFile(message.layout as Record<string, unknown>);
      } else if (message.type === 'setSoundEnabled') {
        this.context.globalState.update(GLOBAL_KEY_SOUND_ENABLED, message.enabled);
      } else if (message.type === 'loadSkills') {
        const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
        const skills = scanSkills(folders);
        this.webview?.postMessage({ type: 'skillsLoaded', skills });
      } else if (message.type === 'setSkillEnabled') {
        try {
          setSkillEnabled(message.filePath as string, message.enabled as boolean);
        } catch (e) {
          vscode.window.showErrorMessage(`Failed to toggle skill: ${String(e)}`);
        }
        const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
        this.webview?.postMessage({ type: 'skillsLoaded', skills: scanSkills(folders) });
      } else if (message.type === 'createSkill') {
        const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
        const targetDir =
          folders.length > 0
            ? require('path').join(folders[0], '.github', 'extensions')
            : require('path').join(require('os').homedir(), '.github', 'extensions');
        try {
          createSkill(
            targetDir,
            message.name as string,
            message.description as string,
            message.content as string,
          );
        } catch (e) {
          vscode.window.showErrorMessage(`Failed to create skill: ${String(e)}`);
        }
        this.webview?.postMessage({ type: 'skillsLoaded', skills: scanSkills(folders) });
      } else if (message.type === 'deleteSkill') {
        try {
          deleteSkill(message.filePath as string);
        } catch (e) {
          vscode.window.showErrorMessage(`Failed to delete skill: ${String(e)}`);
        }
        const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
        this.webview?.postMessage({ type: 'skillsLoaded', skills: scanSkills(folders) });
      } else if (message.type === 'webviewReady') {
        restoreSessions(
          this.context,
          this.nextAgentId,
          this.agents,
          this.knownSessionIds,
          this.fileWatchers,
          this.pollingTimers,
          this.waitingTimers,
          this.permissionTimers,
          this.jsonlPollTimers,
          this.webview,
          this.persistSessions,
        );

        // Prune restored sessions that don't belong to the current workspace.
        // (restoreSessions has no workspace filter, so we clean up here)
        if (!this.showAllSessions) {
          pruneAgentsOutsideWorkspace(
            this.agents,
            this.knownSessionIds,
            this.workspacePaths,
            this.fileWatchers,
            this.pollingTimers,
            this.waitingTimers,
            this.permissionTimers,
            this.jsonlPollTimers,
            undefined, // webview not ready yet, no agentClosed needed
            this.persistSessions,
          );
        }

        // Silently register sessions on disk filtered by workspace.
        seedInitialSessions(
          this.knownSessionIds,
          this.nextAgentId,
          this.agents,
          this.fileWatchers,
          this.pollingTimers,
          this.waitingTimers,
          this.permissionTimers,
          this.jsonlPollTimers,
          this.persistSessions,
          this.workspacePaths,
        );

        const soundEnabled = this.context.globalState.get<boolean>(GLOBAL_KEY_SOUND_ENABLED, true);
        const showAllSessions = this.showAllSessions;
        this.webview?.postMessage({ type: 'settingsLoaded', soundEnabled, showAllSessions });

        this.startSessionScan();

        // Load assets and send layout
        (async () => {
          try {
            const extensionPath = this.extensionUri.fsPath;
            const bundledAssetsDir = path.join(extensionPath, 'dist', 'assets');
            let assetsRoot: string | null = null;
            if (fs.existsSync(bundledAssetsDir)) {
              assetsRoot = path.join(extensionPath, 'dist');
            } else {
              const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
              if (workspaceRoot) assetsRoot = workspaceRoot;
            }

            if (assetsRoot) {
              this.defaultLayout = loadDefaultLayout(assetsRoot);

              const charSprites = await loadCharacterSprites(assetsRoot);
              if (charSprites && this.webview) sendCharacterSpritesToWebview(this.webview, charSprites);

              const floorTiles = await loadFloorTiles(assetsRoot);
              if (floorTiles && this.webview) sendFloorTilesToWebview(this.webview, floorTiles);

              const wallTiles = await loadWallTiles(assetsRoot);
              if (wallTiles && this.webview) sendWallTilesToWebview(this.webview, wallTiles);

              const assets = await loadFurnitureAssets(assetsRoot);
              if (assets && this.webview) sendAssetsToWebview(this.webview, assets);
            }
          } catch (err) {
            console.error('[Copilot Pixel] Error loading assets:', err);
          }

          if (this.webview) {
            sendLayout(this.context, this.webview, this.defaultLayout);
            this.startLayoutWatcher();
          }
        })();

        sendExistingAgents(this.agents, this.context, this.webview);
      } else if (message.type === 'openSessionsFolder') {
        const base = getSessionsBasePath();
        if (fs.existsSync(base)) {
          vscode.env.openExternal(vscode.Uri.file(base));
        }
      } else if (message.type === 'exportLayout') {
        const layout = readLayoutFromFile();
        if (!layout) {
          vscode.window.showWarningMessage('Copilot Pixel: No saved layout to export.');
          return;
        }
        const uri = await vscode.window.showSaveDialog({
          filters: { 'JSON Files': ['json'] },
          defaultUri: vscode.Uri.file(path.join(os.homedir(), 'copilot-pixel-layout.json')),
        });
        if (uri) {
          fs.writeFileSync(uri.fsPath, JSON.stringify(layout, null, 2), 'utf-8');
          vscode.window.showInformationMessage('Copilot Pixel: Layout exported successfully.');
        }
      } else if (message.type === 'importLayout') {
        const uris = await vscode.window.showOpenDialog({
          filters: { 'JSON Files': ['json'] },
          canSelectMany: false,
        });
        if (!uris || uris.length === 0) return;
        try {
          const raw = fs.readFileSync(uris[0].fsPath, 'utf-8');
          const imported = JSON.parse(raw) as Record<string, unknown>;
          if (imported.version !== 1 || !Array.isArray(imported.tiles)) {
            vscode.window.showErrorMessage('Copilot Pixel: Invalid layout file.');
            return;
          }
          this.layoutWatcher?.markOwnWrite();
          writeLayoutToFile(imported);
          this.webview?.postMessage({ type: 'layoutLoaded', layout: imported });
          vscode.window.showInformationMessage('Copilot Pixel: Layout imported successfully.');
        } catch {
          vscode.window.showErrorMessage('Copilot Pixel: Failed to read or parse layout file.');
        }
      }
    });
  }

  private startSessionScan(): void {
    ensureSessionScan(
      this.knownSessionIds,
      this.sessionScanTimer,
      this.nextAgentId,
      this.agents,
      this.fileWatchers,
      this.pollingTimers,
      this.waitingTimers,
      this.permissionTimers,
      this.jsonlPollTimers,
      this.webview,
      this.persistSessions,
      this.workspacePaths,
    );
  }

  /** Export current saved layout as a versioned default-layout-{N}.json (dev utility) */
  exportDefaultLayout(): void {
    const layout = readLayoutFromFile();
    if (!layout) {
      vscode.window.showWarningMessage('Copilot Pixel: No saved layout found.');
      return;
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      vscode.window.showErrorMessage('Copilot Pixel: No workspace folder found.');
      return;
    }
    const assetsDir = path.join(workspaceRoot, 'webview-ui', 'public', 'assets');

    let maxRevision = 0;
    if (fs.existsSync(assetsDir)) {
      for (const file of fs.readdirSync(assetsDir)) {
        const match = /^default-layout-(\d+)\.json$/.exec(file);
        if (match) maxRevision = Math.max(maxRevision, parseInt(match[1], 10));
      }
    }
    const nextRevision = maxRevision + 1;
    layout[LAYOUT_REVISION_KEY] = nextRevision;

    const targetPath = path.join(assetsDir, `default-layout-${nextRevision}.json`);
    fs.writeFileSync(targetPath, JSON.stringify(layout, null, 2), 'utf-8');
    vscode.window.showInformationMessage(
      `Copilot Pixel: Default layout exported as revision ${nextRevision} to ${targetPath}`,
    );
  }

  private startLayoutWatcher(): void {
    if (this.layoutWatcher) return;
    this.layoutWatcher = watchLayoutFile((layout) => {
      this.webview?.postMessage({ type: 'layoutLoaded', layout });
    });
  }

  dispose() {
    this.layoutWatcher?.dispose();
    this.layoutWatcher = null;
    for (const id of [...this.agents.keys()]) {
      removeAgent(
        id,
        this.agents,
        this.fileWatchers,
        this.pollingTimers,
        this.waitingTimers,
        this.permissionTimers,
        this.jsonlPollTimers,
        this.persistSessions,
      );
    }
    if (this.sessionScanTimer.current) {
      clearInterval(this.sessionScanTimer.current);
      this.sessionScanTimer.current = null;
    }
  }
}

export function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const distPath = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
  const indexPath = vscode.Uri.joinPath(distPath, 'index.html').fsPath;

  let html = fs.readFileSync(indexPath, 'utf-8');

  html = html.replace(/(href|src)="\.\/([^"]+)"/g, (_match, attr, filePath) => {
    const fileUri = vscode.Uri.joinPath(distPath, filePath);
    const webviewUri = webview.asWebviewUri(fileUri);
    return `${attr}="${webviewUri}"`;
  });

  return html;
}
