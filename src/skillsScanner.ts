import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  filePath: string;
  location: 'project' | 'user';
  disabled: boolean;
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
      result[key] = val;
    }
  }
  return result;
}

function scanDir(dir: string, location: 'project' | 'user'): SkillInfo[] {
  if (!fs.existsSync(dir)) return [];
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const results: SkillInfo[] = [];
  for (const file of files) {
    const disabled = file.endsWith('.md.disabled');
    if (!file.endsWith('.md') && !disabled) continue;
    const filePath = path.join(dir, file);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
      const content = fs.readFileSync(filePath, 'utf8');
      const fm = parseFrontmatter(content);
      const id = file.replace(/\.md\.disabled$/, '').replace(/\.md$/, '');
      results.push({
        id,
        name: fm.name || id,
        description: fm.description || '',
        filePath,
        location,
        disabled,
      });
    } catch {
      // skip unreadable files
    }
  }
  return results;
}

/** Scan .github/extensions/ in workspace folders and common user skill dirs */
export function scanSkills(workspaceFolders: string[]): SkillInfo[] {
  const results: SkillInfo[] = [];

  for (const folder of workspaceFolders) {
    results.push(...scanDir(path.join(folder, '.github', 'extensions'), 'project'));
  }

  const userDirs = [
    path.join(os.homedir(), '.github', 'extensions'),
    path.join(os.homedir(), '.copilot', 'extensions'),
  ];
  const seen = new Set<string>();
  for (const dir of userDirs) {
    for (const skill of scanDir(dir, 'user')) {
      if (!seen.has(skill.id)) {
        seen.add(skill.id);
        results.push(skill);
      }
    }
  }
  return results;
}

/** Rename skill file to toggle enabled/disabled state */
export function setSkillEnabled(filePath: string, enabled: boolean): void {
  if (enabled && filePath.endsWith('.md.disabled')) {
    fs.renameSync(filePath, filePath.replace(/\.md\.disabled$/, '.md'));
  } else if (!enabled && filePath.endsWith('.md')) {
    fs.renameSync(filePath, filePath + '.disabled');
  }
}

/** Create a new skill file in the given directory */
export function createSkill(
  dir: string,
  name: string,
  description: string,
  content: string,
): string {
  fs.mkdirSync(dir, { recursive: true });
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const filePath = path.join(dir, `${id}.md`);
  const fileContent = `---\nname: ${name}\ndescription: ${description}\n---\n\n${content}`;
  fs.writeFileSync(filePath, fileContent, 'utf8');
  return filePath;
}

/** Permanently delete a skill file */
export function deleteSkill(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
