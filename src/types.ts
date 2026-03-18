export interface ToolHistoryEntry {
  toolName: string;
  status: string;
  timestamp: number;
}

export interface SessionState {
  id: number;
  sessionId: string;
  eventsDir: string;
  eventsFile: string;
  fileOffset: number;
  lineBuffer: string;
  activeToolIds: Set<string>;
  activeToolStatuses: Map<string, string>;
  activeToolNames: Map<string, string>;
  activeSubagentToolIds: Map<string, Set<string>>; // parentToolId → active sub-tool IDs
  activeSubagentToolNames: Map<string, Map<string, string>>; // parentToolId → (subToolId → toolName)
  isWaiting: boolean;
  permissionSent: boolean;
  hadToolsInTurn: boolean;
  // Metadata from session.start event
  branch?: string;
  repository?: string;
  cwd?: string;
  startTime?: string;    // ISO timestamp from session.start
  summary?: string;      // from workspace.yaml
  checkpointCount?: number;
  currentIntent?: string; // last report_intent text
  toolHistory: ToolHistoryEntry[]; // accumulated tool history (max 50)
}

export interface PersistedSession {
  id: number;
  sessionId: string;
  eventsFile: string;
  eventsDir: string;
  branch?: string;
  repository?: string;
  cwd?: string;
}
