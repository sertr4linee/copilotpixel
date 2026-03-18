import { useEffect, useRef, useState } from 'react';

const LS_KEY = 'copilot-pixel-scene';

export const SCENE_THEMES = {
  day: {
    label: '☀️ Day',
    filter: '',
    swatch: '#a8c4e0',
  },
  night: {
    label: '🌙 Night',
    filter: 'brightness(0.5) saturate(0.6) hue-rotate(200deg)',
    swatch: '#1a2a4a',
  },
  retro: {
    label: '📺 Retro',
    filter: 'sepia(0.65) brightness(0.88) contrast(1.1)',
    swatch: '#8b6940',
  },
  cyber: {
    label: '🌆 Cyber',
    filter: 'hue-rotate(270deg) saturate(2.2) brightness(0.62)',
    swatch: '#4a005a',
  },
  forest: {
    label: '🌿 Forest',
    filter: 'hue-rotate(95deg) saturate(1.6) brightness(0.78)',
    swatch: '#1a4a20',
  },
  sakura: {
    label: '🌸 Sakura',
    filter: 'hue-rotate(295deg) saturate(1.5) brightness(1.05)',
    swatch: '#e8a0c0',
  },
} as const;

export type SceneThemeKey = keyof typeof SCENE_THEMES;

export function useSceneTheme(): {
  theme: SceneThemeKey;
  filter: string;
  setTheme: (t: SceneThemeKey) => void;
} {
  const [theme, setThemeState] = useState<SceneThemeKey>(
    () => (localStorage.getItem(LS_KEY) as SceneThemeKey) ?? 'day',
  );

  const setTheme = (t: SceneThemeKey) => {
    setThemeState(t);
    localStorage.setItem(LS_KEY, t);
  };

  return { theme, filter: SCENE_THEMES[theme].filter, setTheme };
}

interface ScenePickerProps {
  currentTheme: SceneThemeKey;
  onSelect: (t: SceneThemeKey) => void;
  onClose: () => void;
}

export function ScenePicker({ currentTheme, onSelect, onClose }: ScenePickerProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        bottom: '100%',
        right: 0,
        marginBottom: 6,
        background: 'var(--pixel-bg)',
        border: '2px solid var(--pixel-border)',
        borderRadius: 0,
        boxShadow: 'var(--pixel-shadow)',
        padding: '8px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minWidth: 130,
        zIndex: 10,
      }}
    >
      <div
        style={{
          fontSize: '16px',
          color: 'var(--pixel-text-dim)',
          paddingBottom: 4,
          borderBottom: '1px solid var(--pixel-border)',
          marginBottom: 2,
        }}
      >
        Scene
      </div>
      {(Object.keys(SCENE_THEMES) as SceneThemeKey[]).map((key) => {
        const t = SCENE_THEMES[key];
        const isActive = key === currentTheme;
        return (
          <button
            key={key}
            onClick={() => {
              onSelect(key);
              onClose();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 8px',
              fontSize: '18px',
              background: isActive ? 'var(--pixel-active-bg)' : 'var(--pixel-btn-bg)',
              color: 'var(--pixel-text)',
              border: isActive ? '2px solid var(--pixel-accent)' : '2px solid transparent',
              cursor: 'pointer',
              textAlign: 'left',
              borderRadius: 0,
            }}
          >
            <span
              style={{
                width: 14,
                height: 14,
                background: t.swatch,
                border: '1px solid rgba(255,255,255,0.3)',
                flexShrink: 0,
              }}
            />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
