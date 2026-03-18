import { useState } from 'react';

import { vscode } from '../vscodeApi.js';

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  filePath: string;
  location: 'project' | 'user';
  disabled: boolean;
}

interface SkillsPanelProps {
  skills: SkillInfo[];
  onClose: () => void;
}

const overlay: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 0,
  width: 340,
  height: '100%',
  background: 'var(--pixel-bg)',
  border: '2px solid var(--pixel-border)',
  borderRight: 'none',
  borderTop: 'none',
  borderBottom: 'none',
  boxShadow: '-4px 0 0 0 var(--pixel-shadow-color, rgba(0,0,0,0.4))',
  display: 'flex',
  flexDirection: 'column',
  zIndex: 120,
  fontFamily: '"Courier New", monospace',
};

const header: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 12px',
  borderBottom: '2px solid var(--pixel-border)',
  background: 'var(--pixel-agent-bg)',
  flexShrink: 0,
};

const headerTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--pixel-text)',
  letterSpacing: 1,
};

const closeBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--pixel-text)',
  cursor: 'pointer',
  fontSize: 16,
  padding: '2px 6px',
};

const scrollArea: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '8px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const sectionLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: 'var(--pixel-accent)',
  letterSpacing: 2,
  textTransform: 'uppercase',
  marginTop: 4,
  marginBottom: 2,
};

const cardBase: React.CSSProperties = {
  border: '1px solid var(--pixel-border)',
  padding: '6px 8px',
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
};

const skillName: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--pixel-text)',
  marginBottom: 2,
};

const skillDesc: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--pixel-text-muted, #888)',
  lineHeight: 1.4,
};

const toggleTrack = (enabled: boolean): React.CSSProperties => ({
  width: 32,
  height: 16,
  borderRadius: 0,
  background: enabled ? 'var(--pixel-accent)' : 'var(--pixel-btn-bg)',
  border: '1px solid var(--pixel-border)',
  cursor: 'pointer',
  position: 'relative',
  flexShrink: 0,
  marginTop: 2,
  transition: 'background 0.15s',
});

const toggleThumb = (enabled: boolean): React.CSSProperties => ({
  position: 'absolute',
  top: 2,
  left: enabled ? 16 : 2,
  width: 10,
  height: 10,
  background: 'var(--pixel-text)',
  transition: 'left 0.15s',
});

const deleteBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#c75',
  cursor: 'pointer',
  fontSize: 14,
  padding: '0 2px',
  marginLeft: 'auto',
  flexShrink: 0,
  lineHeight: 1,
};

const addBtn: React.CSSProperties = {
  margin: '8px 12px',
  padding: '8px',
  background: 'var(--pixel-agent-bg)',
  border: '2px solid var(--pixel-accent)',
  color: 'var(--pixel-accent)',
  cursor: 'pointer',
  fontSize: 12,
  fontFamily: '"Courier New", monospace',
  fontWeight: 700,
  letterSpacing: 1,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '4px 6px',
  background: 'var(--pixel-btn-bg)',
  border: '1px solid var(--pixel-border)',
  color: 'var(--pixel-text)',
  fontSize: 11,
  fontFamily: '"Courier New", monospace',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--pixel-text)',
  marginBottom: 2,
  display: 'block',
  fontWeight: 700,
  letterSpacing: 1,
};

const DEFAULT_CONTENT = `When invoked, follow these instructions:\n\n1. \n2. \n3. `;

export function SkillsPanel({ skills, onClose }: SkillsPanelProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newContent, setNewContent] = useState(DEFAULT_CONTENT);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const projectSkills = skills.filter((s) => s.location === 'project');
  const userSkills = skills.filter((s) => s.location === 'user');

  function handleToggle(skill: SkillInfo) {
    vscode.postMessage({ type: 'setSkillEnabled', filePath: skill.filePath, enabled: skill.disabled });
  }

  function handleDelete(filePath: string) {
    if (confirmDelete === filePath) {
      vscode.postMessage({ type: 'deleteSkill', filePath });
      setConfirmDelete(null);
    } else {
      setConfirmDelete(filePath);
    }
  }

  function handleCreate() {
    if (!newName.trim()) return;
    vscode.postMessage({
      type: 'createSkill',
      name: newName.trim(),
      description: newDesc.trim(),
      content: newContent,
    });
    setNewName('');
    setNewDesc('');
    setNewContent(DEFAULT_CONTENT);
    setShowCreate(false);
  }

  function renderSkill(skill: SkillInfo) {
    const isProject = skill.location === 'project';
    return (
      <div key={skill.filePath} style={{ ...cardBase, opacity: skill.disabled ? 0.55 : 1 }}>
        {/* Toggle */}
        <div
          style={toggleTrack(!skill.disabled)}
          onClick={() => handleToggle(skill)}
          title={skill.disabled ? 'Enable skill' : 'Disable skill'}
        >
          <div style={toggleThumb(!skill.disabled)} />
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={skillName}>{skill.name}</div>
          {skill.description && (
            <div style={skillDesc}>{skill.description}</div>
          )}
          <div style={{ ...skillDesc, marginTop: 2, color: isProject ? '#7a9' : '#79a' }}>
            {isProject ? '🏠 project' : '👤 user'}
          </div>
        </div>

        {/* Delete (project only) */}
        {isProject && (
          <button
            style={{
              ...deleteBtn,
              color: confirmDelete === skill.filePath ? '#f55' : '#c75',
            }}
            onClick={() => handleDelete(skill.filePath)}
            title={confirmDelete === skill.filePath ? 'Click again to confirm delete' : 'Delete skill'}
          >
            {confirmDelete === skill.filePath ? '⚠' : '✕'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={overlay}>
      {/* Header */}
      <div style={header}>
        <span style={headerTitle}>⚡ SKILLS</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--pixel-text-muted, #888)' }}>
            {skills.filter((s) => !s.disabled).length}/{skills.length} active
          </span>
          <button style={closeBtn} onClick={onClose}>✕</button>
        </div>
      </div>

      {/* Scroll area */}
      <div style={scrollArea}>
        {/* Project skills */}
        {projectSkills.length > 0 && (
          <>
            <div style={sectionLabel}>📁 Project skills</div>
            {projectSkills.map(renderSkill)}
          </>
        )}

        {/* User skills */}
        {userSkills.length > 0 && (
          <>
            <div style={sectionLabel}>👤 User skills</div>
            {userSkills.map(renderSkill)}
          </>
        )}

        {skills.length === 0 && (
          <div style={{ color: 'var(--pixel-text-muted, #888)', fontSize: 11, textAlign: 'center', marginTop: 24 }}>
            No skills found.<br />
            <span style={{ fontSize: 10 }}>
              Add .md files to .github/extensions/
            </span>
          </div>
        )}

        {/* Create form */}
        {showCreate && (
          <div style={{ border: '1px solid var(--pixel-accent)', padding: 10, marginTop: 4 }}>
            <div style={{ ...sectionLabel, color: 'var(--pixel-text)', marginBottom: 8 }}>
              NEW SKILL
            </div>
            <label style={labelStyle}>NAME</label>
            <input
              style={{ ...inputStyle, marginBottom: 6 }}
              placeholder="my-skill"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <label style={labelStyle}>DESCRIPTION</label>
            <input
              style={{ ...inputStyle, marginBottom: 6 }}
              placeholder="Short description"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
            />
            <label style={labelStyle}>INSTRUCTIONS</label>
            <textarea
              style={{ ...inputStyle, height: 90, resize: 'vertical', display: 'block' }}
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button
                style={{ ...addBtn, flex: 1, borderColor: 'var(--pixel-accent)', color: 'var(--pixel-accent)' }}
                onClick={handleCreate}
                disabled={!newName.trim()}
              >
                ✓ CREATE
              </button>
              <button
                style={{ ...addBtn, flex: 1, borderColor: 'var(--pixel-border)', color: 'var(--pixel-text)' }}
                onClick={() => setShowCreate(false)}
              >
                CANCEL
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      {!showCreate && (
        <button style={addBtn} onClick={() => setShowCreate(true)}>
          ➕ NEW SKILL
        </button>
      )}
    </div>
  );
}
