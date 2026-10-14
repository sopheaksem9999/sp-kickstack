import { describe, it, expect } from 'vitest';
import { AiQaSettingsSchema } from '@sp-kickstack/shared';
import { BUILTIN_RISK_PATTERNS, classifyQaTier, matchesRiskPattern, qaProfileFor, type QaChangedFile } from './qaTier.js';

const limits = { lightMaxLines: 150, deepMinLines: 1000 };
const f = (path: string, additions: number, deletions = 0, binary = false): QaChangedFile => ({ path, additions, deletions, binary });

describe('classifyQaTier', () => {
  it('is light for a small change in few files', () => {
    expect(classifyQaTier([f('src/a.ts', 30, 12), f('src/b.ts', 0, 0)], [], limits)).toEqual({ tier: 'light', reason: '42 lines in 2 files' });
    expect(classifyQaTier([f('src/a.ts', 1)], [], limits)).toEqual({ tier: 'light', reason: '1 line in 1 file' });
  });

  it('is standard in between, and deep for many lines or many files', () => {
    expect(classifyQaTier([f('src/a.ts', 500, 62)], [], limits)).toEqual({ tier: 'standard', reason: '562 lines in 1 file' });
    expect(classifyQaTier(Array.from({ length: 9 }, (_, i) => f(`src/${i}.ts`, 1)), [], limits).tier).toBe('standard');
    expect(classifyQaTier([f('src/a.ts', 900, 100)], [], limits)).toEqual({ tier: 'deep', reason: '1000 lines in 1 file' });
    expect(classifyQaTier(Array.from({ length: 40 }, (_, i) => f(`src/${i}.ts`, 1)), [], limits)).toEqual({ tier: 'deep', reason: '40 lines in 40 files' });
  });

  it('follows the line limits from settings and ignores binary lines', () => {
    expect(classifyQaTier([f('src/a.ts', 200)], [], { lightMaxLines: 300, deepMinLines: 2000 }).tier).toBe('light');
    expect(classifyQaTier([f('logo.png', 5000, 0, true)], [], limits)).toEqual({ tier: 'light', reason: '0 lines in 1 file' });
  });

  it('is deep when a file matches a project or built-in risky pattern', () => {
    expect(classifyQaTier([f('src/a.ts', 3), f('app/Http/Middleware/CompanyMiddleware.php', 2)], ['app/Http/Middleware/'], limits))
      .toEqual({ tier: 'deep', reason: 'touches app/Http/Middleware/CompanyMiddleware.php' });
    expect(classifyQaTier([f('database/migrations/2026_10_13_add_company.php', 4)], BUILTIN_RISK_PATTERNS, limits))
      .toEqual({ tier: 'deep', reason: 'touches database/migrations/2026_10_13_add_company.php' });
  });

  it('is standard with no change list', () => {
    expect(classifyQaTier([], BUILTIN_RISK_PATTERNS, limits)).toEqual({ tier: 'standard', reason: 'no change list' });
  });
});

describe('matchesRiskPattern', () => {
  it('matches the built-in patterns', () => {
    const risky = ['db/migrations/1.sql', 'src/auth/login.ts', 'lib/security/x.ts', 'app/payments/charge.ts', 'billing/invoice.ts',
      '.github/workflows/ci.yml', '.gitlab-ci.yml', 'Dockerfile', 'deploy/Dockerfile', 'docker-compose.prod.yml', '.env.example', 'config/my-secrets.json'];
    for (const path of risky) expect(BUILTIN_RISK_PATTERNS.some((p) => matchesRiskPattern(path, p))).toBe(true);
    for (const path of ['src/authorship.ts', 'README.md', 'src/components/Payment.tsx']) {
      expect(BUILTIN_RISK_PATTERNS.some((p) => matchesRiskPattern(path, p))).toBe(false);
    }
  });

  it('matches a folder written without a trailing slash or with a leading slash', () => {
    expect(matchesRiskPattern('app/Http/Middleware/CompanyMiddleware.php', 'app/Http/Middleware')).toBe(true);
    expect(matchesRiskPattern('app/Http/Middleware/CompanyMiddleware.php', '/app/Http/Middleware/')).toBe(true);
    expect(matchesRiskPattern('app/Http/Middleware.php', 'app/Http/Middleware')).toBe(false);
    expect(matchesRiskPattern('app/Models/User.php', '/app/Models/User.php')).toBe(true);
  });

  it('matches paths written with ./, backslashes or other case', () => {
    expect(matchesRiskPattern('APP\\Http\\Middleware\\Company.php', './app/http/middleware/')).toBe(true);
    expect(matchesRiskPattern('app/Models/User.php', 'app/models/user.php')).toBe(true);
    expect(matchesRiskPattern('app/Models/User.php', 'app/*/User.php')).toBe(true);
    expect(matchesRiskPattern('app/Models/Deep/User.php', 'app/*/User.php')).toBe(false);
    expect(matchesRiskPattern('app/Models/User.php', '  ')).toBe(false);
  });
});

describe('qaProfileFor', () => {
  const settings = AiQaSettingsSchema.parse({ model: 'opus', effort: 'max' });

  it('gives the tier of the CLI in Auto mode (Codex keeps its default model)', () => {
    expect(qaProfileFor(settings, 'claude-cli', 'light')).toEqual({ model: 'haiku', effort: 'low' });
    expect(qaProfileFor(settings, 'codex-cli', 'deep')).toEqual({ model: null, effort: 'high' });
  });

  it('gives the fixed model in Fixed mode, or without a tier or CLI', () => {
    expect(qaProfileFor({ ...settings, modelMode: 'fixed' }, 'claude-cli', 'light')).toEqual({ model: 'opus', effort: 'max' });
    expect(qaProfileFor(settings, null, 'light')).toEqual({ model: 'opus', effort: 'max' });
    expect(qaProfileFor(settings, 'claude-cli', null)).toEqual({ model: 'opus', effort: 'max' });
  });
});
