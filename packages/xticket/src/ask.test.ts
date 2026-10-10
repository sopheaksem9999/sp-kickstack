import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseAskArgs } from './ask.js';

const env = { XTICKET_PROJECT: 'mobile', XTICKET_TASK: 'el-42' } as NodeJS.ProcessEnv;

describe('xticket ask arguments', () => {
  it('builds a question payload with options and the task from the environment', () => {
    const r = parseAskArgs(['--question', 'Redis or Postgres?', '--option', 'redis', '--option', 'postgres', '--body', 'Both work.'], env);
    expect(r).toEqual({
      payload: { kind: 'question', question: 'Redis or Postgres?', options: ['redis', 'postgres'], body: 'Both work.', project: 'mobile', engineTaskId: 'el-42' },
    });
  });

  it('reads the context from --body-file', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xticket-ask-')), 'ctx.md');
    fs.writeFileSync(file, '# Context\nDetails');
    const r = parseAskArgs(['--question', 'Which one?', '--body-file', file], env) as any;
    expect(r.payload.body).toBe('# Context\nDetails');
    expect(r.payload.options).toEqual([]);
  });

  it('explains what is wrong', () => {
    expect(parseAskArgs([], env)).toEqual({ error: '--question is required (at least 3 characters)' });
    const seven = Array.from({ length: 7 }, (_, i) => ['--option', `o${i}`]).flat();
    expect(parseAskArgs(['--question', 'Which one?', ...seven], env)).toEqual({ error: 'At most 6 --option values' });
    expect((parseAskArgs(['--question', 'Which one?', '--nope'], env) as any).error).toMatch(/nope/);
    expect((parseAskArgs(['--question', 'Which?', '--body-file', '/no/such/file'], env) as any).error).toMatch(/--body-file/);
  });
});
