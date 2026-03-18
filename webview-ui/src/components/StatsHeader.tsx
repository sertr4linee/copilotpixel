import type { ToolActivity } from '../office/types.js';

interface StatsHeaderProps {
  agents: number[];
  agentStatuses: Record<number, string>;
  agentTools: Record<number, ToolActivity[]>;
}

export function StatsHeader({ agents, agentStatuses, agentTools }: StatsHeaderProps) {
  const total = agents.length;
  if (total === 0) return null;

  const active = agents.filter(
    (id) =>
      agentStatuses[id] === 'active' || agentTools[id]?.some((t) => !t.done),
  ).length;
  const waiting = agents.filter((id) => agentStatuses[id] === 'waiting').length;

  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 'var(--pixel-controls-z)' as React.CSSProperties['zIndex'],
        background: 'var(--pixel-bg)',
        border: '2px solid var(--pixel-border)',
        borderRadius: 0,
        padding: '3px 12px',
        boxShadow: 'var(--pixel-shadow)',
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        fontSize: '18px',
        pointerEvents: 'none',
      }}
    >
      <span style={{ color: 'var(--pixel-text)' }}>
        {total} session{total !== 1 ? 's' : ''}
      </span>
      {active > 0 && (
        <span style={{ color: 'var(--vscode-charts-green, #89d185)' }}>● {active} active</span>
      )}
      {waiting > 0 && (
        <span style={{ color: 'var(--vscode-charts-yellow, #cca700)' }}>◎ {waiting} waiting</span>
      )}
    </div>
  );
}
