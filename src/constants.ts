// ── Timing (ms) ──────────────────────────────────────────────
export const JSONL_POLL_INTERVAL_MS = 1000;
export const FILE_WATCHER_POLL_INTERVAL_MS = 1000;
export const SESSION_SCAN_INTERVAL_MS = 1000;
export const TOOL_DONE_DELAY_MS = 300;
export const PERMISSION_TIMER_DELAY_MS = 7000;
export const TEXT_IDLE_DELAY_MS = 5000;

// ── Display Truncation ──────────────────────────────────────
export const BASH_COMMAND_DISPLAY_MAX_LENGTH = 30;
export const TASK_DESCRIPTION_DISPLAY_MAX_LENGTH = 40;

// ── User-Level Layout Persistence ─────────────────────────────
export const LAYOUT_FILE_DIR = '.pixel-agents';
export const LAYOUT_FILE_NAME = 'layout.json';
export const LAYOUT_FILE_POLL_INTERVAL_MS = 2000;
export const LAYOUT_REVISION_KEY = 'layoutRevision';

// ── Settings Persistence ────────────────────────────────────
export const GLOBAL_KEY_SOUND_ENABLED = 'copilot-pixel.soundEnabled';

// ── VS Code Identifiers ─────────────────────────────────────
export const VIEW_ID = 'copilot-pixel.panelView';
export const COMMAND_SHOW_PANEL = 'copilot-pixel.showPanel';
export const COMMAND_EXPORT_DEFAULT_LAYOUT = 'copilot-pixel.exportDefaultLayout';
export const COMMAND_RESCAN_SESSIONS = 'copilot-pixel.rescanSessions';
export const WORKSPACE_KEY_AGENTS = 'copilot-pixel.agents';
export const WORKSPACE_KEY_AGENT_SEATS = 'copilot-pixel.agentSeats';
export const WORKSPACE_KEY_LAYOUT = 'copilot-pixel.layout';

// ── Copilot CLI Session Discovery ────────────────────────────
export const COPILOT_SESSIONS_DIR = '.copilot/session-state';
export const EVENTS_FILE_NAME = 'events.jsonl';
