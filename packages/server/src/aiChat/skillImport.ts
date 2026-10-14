// SKILL.md folders (e.g. ~/.claude/skills): find them and read name, description and instructions.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SKIP = new Set(['node_modules', '.git']);
const MAX_DEPTH = 4;

export function expandHome(p: string): string {
  const trimmed = p.trim();
  if (trimmed === '~') return os.homedir();
  return trimmed.startsWith('~/') ? path.join(os.homedir(), trimmed.slice(2)) : trimmed;
}

/** Lowercase letters, digits and -, at most 40 characters. */
export function skillSlug(raw: string): string {
  const slug = raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '');
  return slug || 'skill';
}

export function parseSkillFile(text: string, folderName: string, sourcePath: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  const meta: Record<string, string> = {};
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
      if (pair) meta[pair[1]] = pair[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return { name: skillSlug(meta.name || folderName), description: meta.description ?? '', body: (match ? match[2] : text).trim(), sourcePath };
}

/** Every SKILL.md below `folder` (at most 4 levels), sorted by path. */
export function findSkillFiles(folder: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !SKIP.has(entry.name) && depth < MAX_DEPTH) walk(full, depth + 1);
      else if (entry.isFile() && entry.name === 'SKILL.md') found.push(full);
    }
  };
  walk(folder, 0);
  return found.sort((a, b) => path.relative(folder, a).localeCompare(path.relative(folder, b)));
}
