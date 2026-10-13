import fs from 'node:fs';
import { parseArgs } from 'node:util';

type Parsed = { payload: Record<string, unknown> } | { error: string };

const SEVERITIES = ['blocker', 'major', 'minor'];

function identity(env: NodeJS.ProcessEnv) {
  return { project: env.XTICKET_PROJECT || 'unknown', engineTaskId: env.XTICKET_TASK };
}

/** `xticket comment`: one AI QA finding (an open review comment marked AI QA). */
export function parseCommentArgs(argv: string[], env: NodeJS.ProcessEnv): Parsed {
  let values: { severity?: string; file?: string; line?: string; title?: string; body?: string; 'body-file'?: string };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        severity: { type: 'string' },
        file: { type: 'string' },
        line: { type: 'string' },
        title: { type: 'string' },
        body: { type: 'string' },
        'body-file': { type: 'string' },
      },
    }));
  } catch (err: any) {
    return { error: err.message };
  }

  const severity = (values.severity || '').trim();
  if (!SEVERITIES.includes(severity)) return { error: '--severity must be blocker, major or minor' };
  const title = (values.title || '').trim();
  if (title.length < 3) return { error: '--title is required (one line, at least 3 characters)' };
  if (/[\r\n]/.test(title)) return { error: '--title must be one line; put details in --body' };
  const file = (values.file || '').trim();
  let line: number | undefined;
  if (values.line !== undefined) {
    if (!file) return { error: '--line needs --file' };
    line = Number(values.line);
    if (!Number.isInteger(line) || line < 1) return { error: '--line must be a whole number from 1' };
  }

  let body = values.body || '';
  if (values['body-file']) {
    try {
      body = fs.readFileSync(values['body-file'], 'utf-8');
    } catch (err: any) {
      return { error: `Error reading --body-file: ${err.message}` };
    }
  }

  return {
    payload: {
      kind: 'qa-comment', severity, title, body,
      ...(file ? { file_path: file } : {}),
      ...(line ? { line } : {}),
      ...identity(env),
    },
  };
}

/** `xticket qa-result`: the QA run's verdict and summary. */
export function parseQaResultArgs(argv: string[], env: NodeJS.ProcessEnv): Parsed {
  let values: { passed?: boolean; failed?: boolean; summary?: string };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { passed: { type: 'boolean' }, failed: { type: 'boolean' }, summary: { type: 'string' } },
    }));
  } catch (err: any) {
    return { error: err.message };
  }
  if (Boolean(values.passed) === Boolean(values.failed)) return { error: 'Give exactly one of --passed or --failed' };
  const summary = (values.summary || '').trim();
  if (!summary) return { error: '--summary is required' };
  return { payload: { kind: 'qa-result', passed: Boolean(values.passed), summary, ...identity(env) } };
}
