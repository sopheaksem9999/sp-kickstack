import fs from 'node:fs';
import { parseArgs } from 'node:util';

/** Parse `xticket ask` options into the bridge payload, or explain what is wrong. */
export function parseAskArgs(argv: string[], env: NodeJS.ProcessEnv): { payload: Record<string, unknown> } | { error: string } {
  let values: { question?: string; option?: string[]; body?: string; 'body-file'?: string };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        question: { type: 'string' },
        option: { type: 'string', multiple: true },
        body: { type: 'string' },
        'body-file': { type: 'string' },
      },
    }));
  } catch (err: any) {
    return { error: err.message };
  }

  const question = (values.question || '').trim();
  if (question.length < 3) return { error: '--question is required (at least 3 characters)' };
  const options = (values.option || []).map((o) => o.trim()).filter(Boolean);
  if (options.length > 6) return { error: 'At most 6 --option values' };

  let body = values.body || '';
  if (values['body-file']) {
    try {
      body = fs.readFileSync(values['body-file'], 'utf-8');
    } catch (err: any) {
      return { error: `Error reading --body-file: ${err.message}` };
    }
  }

  return {
    payload: { kind: 'question', question, options, body, project: env.XTICKET_PROJECT || 'unknown', engineTaskId: env.XTICKET_TASK },
  };
}
