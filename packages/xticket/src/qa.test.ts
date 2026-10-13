import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCommentArgs, parseQaResultArgs } from './qa.js';
import { submitTicket } from './submit.js';

const env = { XTICKET_PROJECT: 'backend', XTICKET_TASK: 'local-1' } as NodeJS.ProcessEnv;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xticket-qa-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('xticket comment', () => {
  it('builds a finding with the run identity', () => {
    expect(
      parseCommentArgs(['--severity', 'blocker', '--file', 'src/rides.ts', '--line', '12', '--title', 'Rides are not saved', '--body', 'POST /rides answers 500'], env)
    ).toEqual({
      payload: {
        kind: 'qa-comment', severity: 'blocker', title: 'Rides are not saved', body: 'POST /rides answers 500',
        file_path: 'src/rides.ts', line: 12, project: 'backend', engineTaskId: 'local-1',
      },
    });
  });

  it('reads the body from a file and leaves out a missing file', () => {
    const file = path.join(tmp, 'body.md');
    fs.writeFileSync(file, 'Steps:\n1. POST /rides');
    const parsed = parseCommentArgs(['--severity', 'minor', '--title', 'Naming', '--body-file', file], env);
    expect(parsed).toMatchObject({ payload: { body: 'Steps:\n1. POST /rides' } });
    expect('payload' in parsed && 'file_path' in parsed.payload).toBe(false);
  });

  it('explains what is wrong', () => {
    expect(parseCommentArgs(['--title', 'Missing check'], env)).toEqual({ error: '--severity must be blocker, major or minor' });
    expect(parseCommentArgs(['--severity', 'huge', '--title', 'Missing check'], env)).toEqual({ error: '--severity must be blocker, major or minor' });
    expect(parseCommentArgs(['--severity', 'major'], env)).toEqual({ error: '--title is required (one line, at least 3 characters)' });
    expect(parseCommentArgs(['--severity', 'major', '--title', 'Two\nlines'], env)).toEqual({ error: '--title must be one line; put details in --body' });
    expect(parseCommentArgs(['--severity', 'major', '--title', 'Missing check', '--line', '4'], env)).toEqual({ error: '--line needs --file' });
    expect(parseCommentArgs(['--severity', 'major', '--title', 'Missing check', '--file', 'a.ts', '--line', 'x'], env)).toEqual({ error: '--line must be a whole number from 1' });
    expect(parseCommentArgs(['--severity', 'major', '--title', 'Missing check', '--body-file', path.join(tmp, 'nope.md')], env)).toEqual({
      error: expect.stringMatching(/^Error reading --body-file:/),
    });
    expect(parseCommentArgs(['--severity', 'major', '--title', 'Missing check', '--colour', 'red'], env)).toEqual({ error: expect.stringContaining('--colour') });
  });
});

describe('xticket qa-result', () => {
  it('builds the verdict with the run identity', () => {
    expect(parseQaResultArgs(['--failed', '--summary', '1 blocker'], env)).toEqual({
      payload: { kind: 'qa-result', passed: false, summary: '1 blocker', project: 'backend', engineTaskId: 'local-1' },
    });
    expect(parseQaResultArgs(['--passed', '--summary', 'All criteria met'], env)).toMatchObject({ payload: { passed: true } });
  });

  it('needs exactly one verdict and a summary', () => {
    expect(parseQaResultArgs(['--summary', 'x'], env)).toEqual({ error: 'Give exactly one of --passed or --failed' });
    expect(parseQaResultArgs(['--passed', '--failed', '--summary', 'x'], env)).toEqual({ error: 'Give exactly one of --passed or --failed' });
    expect(parseQaResultArgs(['--passed'], env)).toEqual({ error: '--summary is required' });
  });
});

describe('xticket QA reports through the outbox', () => {
  it('queues a finding as qa-comment-*.json when the bridge cannot be reached', async () => {
    const outboxDir = path.join(tmp, 'outbox');
    const parsed = parseCommentArgs(['--severity', 'minor', '--title', 'Naming'], env);
    if (!('payload' in parsed)) throw new Error(parsed.error);
    const r = await submitTicket(parsed.payload, {
      bridgeUrl: 'http://b', outboxDir, endpoint: '/api/agent/qa/comments',
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout!)).toMatchObject({ status: 'queued_outbox' });
    const [file] = fs.readdirSync(outboxDir);
    expect(file).toMatch(/^qa-comment-\d+-\w+\.json$/);
    expect(JSON.parse(fs.readFileSync(path.join(outboxDir, file), 'utf8'))).toMatchObject({ kind: 'qa-comment', title: 'Naming' });
  });

  it('names a refused finding as a finding', async () => {
    const r = await submitTicket({ kind: 'qa-comment', title: 'Naming' }, {
      bridgeUrl: 'http://b', outboxDir: path.join(tmp, 'unused'), endpoint: '/api/agent/qa/comments',
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: 'REQ-1 is no longer in QA; this finding was not saved' }), { status: 409, headers: { 'Content-Type': 'application/json' } }),
    });
    expect(r).toMatchObject({ exitCode: 1, stderr: 'Bridge rejected the finding (409): REQ-1 is no longer in QA; this finding was not saved' });
  });
});
