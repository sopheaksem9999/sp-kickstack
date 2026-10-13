import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { buildRunPrompt } from './prompt.js';
import { findXticketScript, writeXticketLauncher } from './xticketLauncher.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-prompt-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('run prompt', () => {
  const base = { bodyMd: '# REQ-008: Rides\n\nBuild it.', worktree: '/w/backend/task-8', branch: 'req/REQ-008/task-8', notesMd: '', continuation: false };

  it('adds how an unattended local run works', () => {
    const prompt = buildRunPrompt(base);
    expect(prompt.startsWith('# REQ-008: Rides\n\nBuild it.\n\n## Local run\n')).toBe(true);
    expect(prompt).toContain('You run unattended in `/w/backend/task-8`');
    expect(prompt).toContain('Commit your work on `req/REQ-008/task-8`');
    expect(prompt).toContain('Never push');
    expect(prompt).not.toContain('## Continue');
    expect(prompt).not.toContain('## Notes since your last run');
  });

  it('asks a resumed run to continue and delivers notes', () => {
    const prompt = buildRunPrompt({ ...base, continuation: true, notesMd: 'Answer: use Postgres' });
    expect(prompt).toContain('## Continue\nThis task was started before');
    expect(prompt.trimEnd().endsWith('## Notes since your last run\nAnswer: use Postgres')).toBe(true);
  });
});

describe('xticket launcher', () => {
  it('runs the xticket script with the arguments it was given', () => {
    const script = path.join(tmp, 'cli.js');
    fs.writeFileSync(script, "console.log(process.argv.slice(2).join(' '));\n");
    const bin = writeXticketLauncher(path.join(tmp, 'bin'), process.execPath, script);
    expect(execFileSync(path.join(bin, 'xticket'), ['ask', '--question', 'Postgres?'], { encoding: 'utf8' }).trim()).toBe('ask --question Postgres?');
    expect(fs.existsSync(path.join(bin, 'xticket.cmd'))).toBe(true);
  });

  it('explains what to build when the script is missing', () => {
    const bin = writeXticketLauncher(path.join(tmp, 'bin-missing'), process.execPath, null);
    const result = spawnSync(path.join(bin, 'xticket'), ['ask'], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('xticket is not available');
  });

  it('finds the first existing script', () => {
    const script = path.join(tmp, 'found.js');
    fs.writeFileSync(script, '');
    expect(findXticketScript([path.join(tmp, 'nope.js'), script])).toBe(script);
    expect(findXticketScript([path.join(tmp, 'nope.js')])).toBeNull();
  });
});
