// SKILL.md folders (e.g. ~/.claude/skills): find them and read name, description and instructions.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AI_CHAT_SKILL_DESCRIPTION_MAX } from '@sp-kickstack/shared';

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
    const lines = match[1].split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]);
      if (!pair) continue;
      const value = pair[2].trim();
      if (/^[>|][+-]?$/.test(value)) {
        // A YAML block (`>` folds lines into one, `|` keeps them): the indented lines that follow.
        const block: string[] = [];
        while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || lines[i + 1].trim() === '')) block.push(lines[++i].trim());
        meta[pair[1]] = value.startsWith('>') ? block.join(' ').replace(/ {2,}/g, '\n').trim() : block.join('\n').trim();
      } else {
        meta[pair[1]] = value.replace(/^["']|["']$/g, '');
      }
    }
  }
  return {
    name: skillSlug(meta.name || folderName),
    description: (meta.description ?? '').slice(0, AI_CHAT_SKILL_DESCRIPTION_MAX),
    body: (match ? match[2] : text).trim(),
    sourcePath,
  };
}

/** Every SKILL.md below `folder` (at most 4 levels, following symlinks once), sorted by path. */
export function findSkillFiles(folder: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const walk = (dir: string, depth: number) => {
    const real = fs.realpathSync(dir);
    if (seen.has(real)) return;
    seen.add(real);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      let stat: fs.Stats;
      try {
        stat = entry.isSymbolicLink() ? fs.statSync(full) : (entry as unknown as fs.Stats);
      } catch {
        continue; // a broken link
      }
      if (stat.isDirectory() && !SKIP.has(entry.name) && depth < MAX_DEPTH) walk(full, depth + 1);
      else if (stat.isFile() && entry.name === 'SKILL.md') found.push(full);
    }
  };
  walk(folder, 0);
  return found.sort((a, b) => path.relative(folder, a).localeCompare(path.relative(folder, b)));
}
