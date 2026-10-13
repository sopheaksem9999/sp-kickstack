import { describe, it, expect } from 'vitest';
import { AiQaSettingsSchema, ProjectSchema, QaFindingInputSchema, QaResultInputSchema, UpdateAiQaSettingsInputSchema } from './schemas.js';

describe('AI QA schemas', () => {
  it('defaults the AI QA settings', () => {
    expect(AiQaSettingsSchema.parse({})).toEqual({
      runAutomatically: true, agentCli: 'default', model: null, effort: null, timeLimitMinutes: 30, maxFindings: 30,
    });
  });

  it('refuses out-of-range limits, unknown CLIs, bad model ids and unknown fields', () => {
    expect(() => UpdateAiQaSettingsInputSchema.parse({ timeLimitMinutes: 4 })).toThrow();
    expect(() => UpdateAiQaSettingsInputSchema.parse({ timeLimitMinutes: 241 })).toThrow();
    expect(() => UpdateAiQaSettingsInputSchema.parse({ maxFindings: 0 })).toThrow();
    expect(() => UpdateAiQaSettingsInputSchema.parse({ agentCli: 'ollama' })).toThrow();
    expect(() => UpdateAiQaSettingsInputSchema.parse({ model: 'opus; rm -rf /' })).toThrow();
    expect(() => UpdateAiQaSettingsInputSchema.parse({ other: 1 })).toThrow();
    expect(UpdateAiQaSettingsInputSchema.parse({ model: 'opus', effort: 'high' })).toEqual({ model: 'opus', effort: 'high' });
  });

  it('reads a finding: severity, one-line title, optional body, file and line', () => {
    expect(
      QaFindingInputSchema.parse({ severity: 'major', title: ' Missing check ', file_path: 'src/a.ts', line: 3, project: 'backend', engineTaskId: 'local-1' })
    ).toEqual({ severity: 'major', title: 'Missing check', body: '', file_path: 'src/a.ts', line: 3 });
    expect(() => QaFindingInputSchema.parse({ severity: 'critical', title: 'Missing check' })).toThrow();
    expect(() => QaFindingInputSchema.parse({ severity: 'minor', title: 'ab' })).toThrow();
    expect(() => QaFindingInputSchema.parse({ severity: 'minor', title: 'Two\nlines' })).toThrow();
  });

  it('reads a QA result', () => {
    expect(QaResultInputSchema.parse({ passed: false, summary: ' 1 blocker ' })).toEqual({ passed: false, summary: '1 blocker' });
    expect(() => QaResultInputSchema.parse({ passed: true, summary: '' })).toThrow();
  });

  it('keeps build and lint commands on a project', () => {
    const base = { name: 'backend', repo_path: '/r', engine_type: 'manual' };
    expect(ProjectSchema.parse({ ...base, build_command: 'npm run build', lint_command: 'npm run lint' })).toMatchObject({
      build_command: 'npm run build', lint_command: 'npm run lint',
    });
  });
});
