import { useState } from 'react';

import { ScenePicker } from './ScenePicker.js';
import type { SceneThemeKey } from './ScenePicker.js';
import { SettingsModal } from './SettingsModal.js';

interface BottomToolbarProps {
  isEditMode: boolean;
  onRescanSessions: () => void;
  showAllSessions: boolean;
  onToggleShowAll: (showAll: boolean) => void;
  onToggleEditMode: () => void;
  isDebugMode: boolean;
  onToggleDebugMode: () => void;
  alwaysShowOverlay: boolean;
  onToggleAlwaysShowOverlay: () => void;
  sceneTheme: SceneThemeKey;
  onSceneChange: (t: SceneThemeKey) => void;
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 10,
  left: 10,
  zIndex: 'var(--pixel-controls-z)',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  background: 'var(--pixel-bg)',
  border: '2px solid var(--pixel-border)',
  borderRadius: 0,
  padding: '4px 6px',
  boxShadow: 'var(--pixel-shadow)',
};

const btnBase: React.CSSProperties = {
  padding: '5px 10px',
  fontSize: '24px',
  color: 'var(--pixel-text)',
  background: 'var(--pixel-btn-bg)',
  border: '2px solid transparent',
  borderRadius: 0,
  cursor: 'pointer',
};

const btnActive: React.CSSProperties = {
  ...btnBase,
  background: 'var(--pixel-active-bg)',
  border: '2px solid var(--pixel-accent)',
};

export function BottomToolbar({
  isEditMode,
  onRescanSessions,
  showAllSessions,
  onToggleShowAll,
  onToggleEditMode,
  isDebugMode,
  onToggleDebugMode,
  alwaysShowOverlay,
  onToggleAlwaysShowOverlay,
  sceneTheme,
  onSceneChange,
}: BottomToolbarProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSceneOpen, setIsSceneOpen] = useState(false);

  return (
    <div style={panelStyle}>
      <button
        onClick={onRescanSessions}
        onMouseEnter={() => setHovered('rescan')}
        onMouseLeave={() => setHovered(null)}
        style={{
          ...btnBase,
          padding: '5px 12px',
          background:
            hovered === 'rescan'
              ? 'var(--pixel-agent-hover-bg)'
              : 'var(--pixel-agent-bg)',
          border: '2px solid var(--pixel-agent-border)',
          color: 'var(--pixel-agent-text)',
        }}
        title="Rescan Copilot CLI sessions"
      >
        ↻ Rescan
      </button>
      <button
        onClick={() => onToggleShowAll(!showAllSessions)}
        onMouseEnter={() => setHovered('showall')}
        onMouseLeave={() => setHovered(null)}
        style={{
          ...btnBase,
          padding: '5px 10px',
          background: showAllSessions
            ? 'var(--pixel-active-bg)'
            : hovered === 'showall'
            ? 'var(--pixel-btn-hover-bg)'
            : btnBase.background,
          border: showAllSessions
            ? '2px solid var(--pixel-accent)'
            : '2px solid transparent',
        }}
        title={showAllSessions ? 'Showing all sessions — click to filter by workspace' : 'Showing workspace sessions — click to show all'}
      >
        {showAllSessions ? '🌐' : '📁'}
      </button>
      <button
        onClick={onToggleEditMode}
        onMouseEnter={() => setHovered('edit')}
        onMouseLeave={() => setHovered(null)}
        style={
          isEditMode
            ? { ...btnActive }
            : {
                ...btnBase,
                background: hovered === 'edit' ? 'var(--pixel-btn-hover-bg)' : btnBase.background,
              }
        }
        title="Edit office layout"
      >
        Layout
      </button>
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => { setIsSceneOpen((v) => !v); setIsSettingsOpen(false); }}
          onMouseEnter={() => setHovered('scene')}
          onMouseLeave={() => setHovered(null)}
          style={
            isSceneOpen
              ? { ...btnActive }
              : {
                  ...btnBase,
                  background: hovered === 'scene' ? 'var(--pixel-btn-hover-bg)' : btnBase.background,
                }
          }
          title="Change scene theme"
        >
          🎨
        </button>
        {isSceneOpen && (
          <ScenePicker
            currentTheme={sceneTheme}
            onSelect={onSceneChange}
            onClose={() => setIsSceneOpen(false)}
          />
        )}
      </div>
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setIsSettingsOpen((v) => !v)}
          onMouseEnter={() => setHovered('settings')}
          onMouseLeave={() => setHovered(null)}
          style={
            isSettingsOpen
              ? { ...btnActive }
              : {
                  ...btnBase,
                  background:
                    hovered === 'settings' ? 'var(--pixel-btn-hover-bg)' : btnBase.background,
                }
          }
          title="Settings"
        >
          Settings
        </button>
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          isDebugMode={isDebugMode}
          onToggleDebugMode={onToggleDebugMode}
          alwaysShowOverlay={alwaysShowOverlay}
          onToggleAlwaysShowOverlay={onToggleAlwaysShowOverlay}
        />
      </div>
    </div>
  );
}
