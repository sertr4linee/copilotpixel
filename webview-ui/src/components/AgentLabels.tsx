import { useEffect, useState } from 'react';

import type { SubagentCharacter } from '../hooks/useExtensionMessages.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { CharacterState, TILE_SIZE } from '../office/types.js';

export interface SessionMeta {
  branch?: string;
  repository?: string;
  cwd?: string;
  startTime?: string;       // ISO timestamp from session.start
  summary?: string;         // from workspace.yaml
  checkpointCount?: number; // number of checkpoint files
}

interface AgentLabelsProps {
  officeState: OfficeState;
  agents: number[];
  agentStatuses: Record<number, string>;
  agentIntents: Record<number, string>;
  sessionMeta: Record<number, SessionMeta>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
  subagentCharacters: SubagentCharacter[];
}

function formatDuration(startTimeIso: string): string {
  const elapsed = Date.now() - new Date(startTimeIso).getTime();
  if (elapsed < 0) return '';
  const hours = Math.floor(elapsed / 3600000);
  const mins = Math.floor((elapsed % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m`;
  return '<1m';
}

export function AgentLabels({
  officeState,
  agents,
  agentStatuses,
  agentIntents,
  sessionMeta,
  containerRef,
  zoom,
  panRef,
  subagentCharacters,
}: AgentLabelsProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      setTick((n) => n + 1);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const el = containerRef.current;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const canvasW = Math.round(rect.width * dpr);
  const canvasH = Math.round(rect.height * dpr);
  const layout = officeState.getLayout();
  const mapW = layout.cols * TILE_SIZE * zoom;
  const mapH = layout.rows * TILE_SIZE * zoom;
  const deviceOffsetX = Math.floor((canvasW - mapW) / 2) + Math.round(panRef.current.x);
  const deviceOffsetY = Math.floor((canvasH - mapH) / 2) + Math.round(panRef.current.y);

  const subLabelMap = new Map<number, string>();
  for (const sub of subagentCharacters) {
    subLabelMap.set(sub.id, sub.label);
  }

  const allIds = [...agents, ...subagentCharacters.map((s) => s.id)];

  return (
    <>
      {allIds.map((id) => {
        const ch = officeState.characters.get(id);
        if (!ch) return null;

        const sittingOffset = ch.state === CharacterState.TYPE ? 6 : 0;
        const screenX = (deviceOffsetX + ch.x * zoom) / dpr;
        const screenY = (deviceOffsetY + (ch.y + sittingOffset - 24) * zoom) / dpr;

        const status = agentStatuses[id];
        const isWaiting = status === 'waiting';
        const isActive = ch.isActive;
        const isSub = ch.isSubagent;

        let dotColor = 'transparent';
        if (isWaiting) {
          dotColor = 'var(--vscode-charts-yellow, #cca700)';
        } else if (isActive) {
          dotColor = 'var(--vscode-charts-blue, #3794ff)';
        }

        const subLabel = subLabelMap.get(id);
        const labelText = subLabel ?? `Agent #${id}`;

        // Sub-label: show repo or branch from session metadata
        const meta = sessionMeta[id];
        const subInfo = !isSub && meta
          ? (meta.repository ?? meta.branch ?? null)
          : null;

        const intent = !isSub ? (agentIntents[id] ?? null) : null;
        const duration = !isSub && meta?.startTime ? formatDuration(meta.startTime) : null;
        const checkpointCount = !isSub && meta?.checkpointCount ? meta.checkpointCount : null;
        const summaryTooltip = !isSub && meta?.summary ? meta.summary : undefined;

        return (
          <div
            key={id}
            style={{
              position: 'absolute',
              left: screenX,
              top: screenY - 16,
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              pointerEvents: 'none',
              zIndex: 40,
            }}
          >
            {dotColor !== 'transparent' && (
              <span
                className={isActive && !isWaiting ? 'pixel-agents-pulse' : undefined}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: dotColor,
                  marginBottom: 2,
                }}
              />
            )}
            {/* Intent badge — shown above the name when agent declares intent */}
            {intent && (
              <span
                style={{
                  fontSize: '13px',
                  color: 'var(--vscode-charts-blue, #3794ff)',
                  background: 'rgba(55,148,255,0.12)',
                  border: '1px solid rgba(55,148,255,0.35)',
                  padding: '1px 5px',
                  borderRadius: 3,
                  whiteSpace: 'nowrap',
                  maxWidth: 180,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  marginBottom: 2,
                }}
                title={intent}
              >
                ⚡ {intent}
              </span>
            )}
            <span
              style={{
                fontSize: isSub ? '16px' : '18px',
                fontStyle: isSub ? 'italic' : undefined,
                color: 'var(--vscode-foreground)',
                background: 'rgba(30,30,46,0.7)',
                padding: '1px 4px',
                borderRadius: 2,
                whiteSpace: 'nowrap',
                maxWidth: isSub ? 120 : undefined,
                overflow: isSub ? 'hidden' : undefined,
                textOverflow: isSub ? 'ellipsis' : undefined,
              }}
              title={summaryTooltip}
            >
              {labelText}
              {checkpointCount !== null && (
                <span
                  style={{
                    marginLeft: 4,
                    fontSize: '12px',
                    color: 'var(--vscode-charts-green, #4caf50)',
                    opacity: 0.85,
                  }}
                  title={`${checkpointCount} checkpoint${checkpointCount !== 1 ? 's' : ''}`}
                >
                  ✦{checkpointCount}
                </span>
              )}
              {duration && (
                <span
                  style={{
                    marginLeft: 4,
                    fontSize: '12px',
                    color: 'rgba(255,255,255,0.45)',
                  }}
                >
                  {duration}
                </span>
              )}
            </span>
            {subInfo && (
              <span
                style={{
                  fontSize: '14px',
                  color: 'rgba(255,255,255,0.55)',
                  background: 'rgba(30,30,46,0.6)',
                  padding: '0px 3px',
                  borderRadius: 2,
                  whiteSpace: 'nowrap',
                  maxWidth: 140,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  marginTop: 1,
                }}
              >
                {subInfo}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}
