// AI QA's model by size and risk: a tier per repository from the change it checks.
import type { AgentCliId, AiQaSettings, QaProfile, QaTier } from '@sp-kickstack/shared';

export interface QaChangedFile {
  path: string;
  additions: number;
  deletions: number;
  binary?: boolean;
}

export interface QaTierChoice {
  tier: QaTier;
  reason: string;
}

/** Paths AI QA always treats as risky, on top of a project's High-risk paths. */
export const BUILTIN_RISK_PATTERNS = [
  '**/migrations/**', '**/auth/**', '**/security/**', '**/payment*/**', '**/billing/**',
  '.github/workflows/**', '.gitlab-ci.yml', '**/Dockerfile', '**/docker-compose*.yml', '**/.env*', '**/*secret*',
];

/** Light also needs at most this many files; this many or more is deep. */
const LIGHT_MAX_FILES = 8;
const DEEP_MIN_FILES = 40;

const normalize = (p: string) => p.trim().replace(/\\/g, '/').replace(/^\.?\//, '');

/** A glob as a case-insensitive regex: `**` any number of folders, `*` within one path segment, a trailing `/` everything under it. */
function globRegex(pattern: string): RegExp {
  let p = normalize(pattern);
  if (p.endsWith('/')) p += '**';
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      if (p[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') {
      re += '[^/]*';
    } else {
      re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`, 'i');
}

export function matchesRiskPattern(file: string, pattern: string): boolean {
  if (!pattern.trim()) return false;
  const path = normalize(file);
  if (globRegex(pattern).test(path)) return true;
  // A plain path without wildcards also names everything under it (a folder written without a trailing /).
  return !pattern.includes('*') && globRegex(`${normalize(pattern).replace(/\/+$/, '')}/`).test(path);
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Deep for a risky path, many lines or many files; light for a small change in few files; else standard. */
export function classifyQaTier(files: QaChangedFile[], riskPatterns: string[], limits: { lightMaxLines: number; deepMinLines: number }): QaTierChoice {
  if (files.length === 0) return { tier: 'standard', reason: 'no change list' };
  const risky = files.find((file) => riskPatterns.some((p) => matchesRiskPattern(file.path, p)));
  if (risky) return { tier: 'deep', reason: `touches ${risky.path}` };
  const lines = files.reduce((n, file) => n + (file.binary ? 0 : file.additions + file.deletions), 0);
  const reason = `${count(lines, 'line')} in ${count(files.length, 'file')}`;
  if (lines >= limits.deepMinLines || files.length >= DEEP_MIN_FILES) return { tier: 'deep', reason };
  if (lines <= limits.lightMaxLines && files.length <= LIGHT_MAX_FILES) return { tier: 'light', reason };
  return { tier: 'standard', reason };
}

/** The model and effort of a QA run: the tier's for that CLI in Auto mode, else the fixed ones. */
export function qaProfileFor(settings: AiQaSettings, cli: AgentCliId | null, tier: QaTier | null): QaProfile {
  if (settings.modelMode === 'fixed' || !cli || !tier) return { model: settings.model, effort: settings.effort };
  return settings.tiers[cli][tier];
}
