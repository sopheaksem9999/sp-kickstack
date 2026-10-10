#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { submitTicket } from './submit.js';
import { parseAskArgs } from './ask.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(`
Usage: xticket <command> [options]

Commands:
  create     Create a cross-repo ticket
  status     Check status of a ticket
  list       List tickets
  ask        Ask a person a question; your task pauses until they answer

Options for create:
  --to <project>           Target project name
  --type <type>            api_request | bug | question (default: api_request)
  --title <title>          Ticket title
  --body <text>            Ticket body description
  --body-file <file>       Path to markdown file containing body
  --blocking               Block the calling task until this ticket is resolved

Options for ask:
  --question <text>        The question (required)
  --option <label>         A choice the person can pick (repeat, up to 6)
  --body <text>            Context that helps the person decide
  --body-file <file>       Path to a markdown file with that context
`);
    process.exit(0);
  }

  const bridgeUrl = process.env.XTICKET_URL || 'http://127.0.0.1:4100';
  const token = process.env.XTICKET_TOKEN;
  const outboxDir = path.resolve('.devflow', 'outbox');

  if (command === 'ask') {
    const parsed = parseAskArgs(args.slice(1), process.env);
    if ('error' in parsed) {
      console.error(`Error: ${parsed.error}`);
      process.exit(2);
    }
    const result = await submitTicket(parsed.payload, { bridgeUrl, token, outboxDir, endpoint: '/api/agent/questions' });
    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);
    process.exit(result.exitCode);
  }

  if (command !== 'create') {
    console.error(`Unsupported command: ${command}`);
    process.exit(2);
  }

  const { values } = parseArgs({
    args: args.slice(1),
    options: {
      to: { type: 'string' },
      type: { type: 'string', default: 'api_request' },
      title: { type: 'string' },
      body: { type: 'string' },
      'body-file': { type: 'string' },
      blocking: { type: 'boolean', default: false },
    },
  });

  if (!values.to || !values.title) {
    console.error('Error: --to and --title are required');
    process.exit(2);
  }

  let bodyContent = values.body || '';
  if (values['body-file']) {
    try {
      bodyContent = fs.readFileSync(values['body-file'], 'utf-8');
    } catch (err: any) {
      console.error(`Error reading --body-file: ${err.message}`);
      process.exit(2);
    }
  }

  if (!bodyContent) {
    console.error('Error: either --body or --body-file must provide content');
    process.exit(2);
  }

  const project = process.env.XTICKET_PROJECT || 'unknown';
  const engineTaskId = process.env.XTICKET_TASK;

  const payload = {
    to: values.to,
    type: values.type,
    title: values.title,
    body: bodyContent,
    blocking: Boolean(values.blocking),
    project,
    engineTaskId,
  };

  const result = await submitTicket(payload, {
    bridgeUrl,
    token,
    outboxDir,
  });
  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);
  process.exit(result.exitCode);
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
