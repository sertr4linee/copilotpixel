import { useEffect, useRef, useState } from 'react';

import type { SessionMeta } from './AgentLabels.js';

export interface ToolHistoryEntry {
  toolName: string;
  status: string;
  timestamp: number;
}

interface AgentDetailPanelProps {
  agentId: number | null;
  sessionMeta: Record<number, SessionMeta>;
  agentIntents: Record<number, string>;
  agentToolHistory: Record<number, ToolHistoryEntry[]>;
  agentStatuses: Record<number, string>;
  onClose: () => void;
  onFocusAgent: (id: number) => void;
}

function formatDuration(startTimeIso?: string): string {
  if (!startTimeIso) return '';
  const ms = Date.now() - new Date(startTimeIso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getToolColor(toolName: string): string {
  if (toolName === 'bash') return '#f0a04b';
  if (toolName === 'view' || toolName === 'grep' || toolName === 'glob') return '#3794ff';
  if (toolName === 'edit' || toolName === 'create') return '#89d185';
  if (toolName === 'task') return '#b5a9ff';
  if (toolName === 'ask_user') return '#f48771';
  if (toolName.startsWith('web_') || toolName.startsWith('playwright-')) return '#d7ba7d';
  if (toolName.startsWith('github-mcp-')) return '#79c0ff';
  if (toolName.startsWith('context7-')) return '#4ec9b0';
  return '#888';
}

function MetaRow({
  label,
  value,
  color,
  small,
}: {
  label: string;
  value: string;
  color?: string;
  small?: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', marginBottom: 5 }}>
      <span
        style={{
          fontSize: '15px',
          color: 'var(--pixel-text-dim)',
          minWidth: 72,
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: small ? '14px' : '17px',
          color: color ?? 'var(--pixel-text)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

export function AgentDetailPanel({
  agentId,
  sessionMeta,
  agentIntents,
  agentToolHistory,
  agentStatuses,
  onClose,
  onFocusAgent,
}: AgentDetailPanelProps) {
  const [, setTick] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  if (agentId === null) return null;

  const meta = sessionMeta[agentId];
  const intent = agentIntents[agentId];
  const history = agentToolHistory[agentId] ?? [];
  const status = agentStatuses[agentId];
  const isActive = status === 'active';
  const duration = formatDuration(meta?.startTime);
  const folderName = meta?.cwd ? (meta.cwd.split('/').pop() ?? meta.cwd) : `Agent #${agentId}`;

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 190,
          background: 'rgba(0,0,0,0.25)',
        }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: 310,
          zIndex: 200,
          background: 'var(--pixel-bg)',
          borderLeft: '2px solid var(--pixel-border)',
          boxShadow: '-6px 0 24px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: 'var(--vscode-font-family, monospace)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderBottom: '2px solid var(--pixel-border)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                flexShrink: 0,
                background: isActive
                  ? 'var(--vscode-charts-green, #89d185)'
                  : 'var(--vscode-charts-yellow, #cca700)',
              }}
            />
            <span
              style={{
                fontSize: '22px',
                fontWeight: 600,
                color: 'var(--pixel-text)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {folderName}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--pixel-text-dim)',
              cursor: 'pointer',
              fontSize: '24px',
              padding: '2px 6px',
              lineHeight: 1,
              flexShrink: 0,
            }}
            title="Close"
          >
            ×
          </button>
        </div>

        {/* Metadata */}
        <div
          style={{
            padding: '10px 12px',
            borderBottom: '1px solid var(--pixel-border)',
            flexShrink: 0,
          }}
        >
          {meta?.repository && (
            <MetaRow
              label="Repo"
              value={meta.repository}
              color="var(--vscode-charts-blue, #3794ff)"
            />
          )}
          {meta?.branch && <MetaRow label="Branch" value={meta.branch} />}
          {meta?.cwd && <MetaRow label="CWD" value={meta.cwd} small />}
          {duration && <MetaRow label="Duration" value={duration} />}
          {meta?.checkpointCount !== undefined && meta.checkpointCount > 0 && (
            <MetaRow
              label="Checkpoints"
              value={`✦ ${meta.checkpointCount}`}
              color="var(--vscode-charts-green, #89d185)"
            />
          )}
          {intent && (
            <MetaRow
              label="Intent"
              value={`⚡ ${intent}`}
              color="var(--vscode-charts-yellow, #cca700)"
            />
          )}
          {meta?.summary && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: '15px', color: 'var(--pixel-text-dim)', marginBottom: 4 }}>
                Summary
              </div>
              <div
                style={{
                  fontSize: '16px',
                  color: 'var(--pixel-text)',
                  lineHeight: 1.4,
                  fontStyle: 'italic',
                }}
              >
                {meta.summary}
              </div>
            </div>
          )}
        </div>

        {/* Open folder button */}
        <div
          style={{
            padding: '8px 12px',
            borderBottom: '1px solid var(--pixel-border)',
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => onFocusAgent(agentId)}
            style={{
              width: '100%',
              padding: '5px 10px',
              fontSize: '18px',
              background: 'var(--pixel-btn-bg)',
              color: 'var(--pixel-text)',
              border: '2px solid var(--pixel-border)',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            📂 Open session folder
          </button>
        </div>

        {/* Tool history */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              padding: '8px 12px 4px',
              fontSize: '17px',
              color: 'var(--pixel-text-dim)',
              flexShrink: 0,
            }}
          >
            Tool History ({history.length})
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 12px' }}>
            {history.length === 0 ? (
              <div
                style={{
                  fontSize: '16px',
                  color: 'var(--pixel-text-dim)',
                  fontStyle: 'italic',
                  padding: '8px 0',
                }}
              >
                No tools used yet this session
              </div>
            ) : (
              [...history].reverse().map((entry, i) => (
                <div
                  key={i}
                  style={{
                    padding: '5px 8px',
                    marginBottom: 3,
                    background: 'var(--pixel-btn-bg)',
                    borderLeft: `3px solid ${getToolColor(entry.toolName)}`,
                  }}
                >
                  <div
                    style={{
                      color: 'var(--pixel-text)',
                      fontSize: '15px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {entry.status}
                  </div>
                  <div style={{ color: 'var(--pixel-text-dim)', fontSize: '13px', marginTop: 2 }}>
                    {formatTime(entry.timestamp)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
