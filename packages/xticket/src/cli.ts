#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

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

Options for create:
  --to <project>           Target project name
  --type <type>            api_request | bug | question (default: api_request)
  --title <title>          Ticket title
  --body <text>            Ticket body description
  --body-file <file>       Path to markdown file containing body
  --blocking               Block the calling task until this ticket is resolved
`);
    process.exit(0);
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

  const bridgeUrl = process.env.XTICKET_URL || 'http://127.0.0.1:4100';
  const token = process.env.XTICKET_TOKEN;
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

  // Attempt 1: Call Bridge HTTP API
  try {
    const res = await fetch(`${bridgeUrl}/api/agent/tickets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const data = await res.json();
      console.log(JSON.stringify(data));
      process.exit(0);
    } else {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      if (res.status === 400) {
        console.error(`Validation error: ${err.error || JSON.stringify(err)}`);
        process.exit(2);
      } else if (res.status === 429) {
        console.error(`Limit hit: ${err.error || 'Too many tickets'}`);
        process.exit(3);
      }
    }
  } catch (netErr: any) {
    // Attempt 2: Fallback to worktree .devflow/outbox file
    try {
      const outboxDir = path.resolve('.devflow', 'outbox');
      if (!fs.existsSync(outboxDir)) {
        fs.mkdirSync(outboxDir, { recursive: true });
      }
      const outboxFileName = `ticket-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`;
      const outboxFilePath = path.join(outboxDir, outboxFileName);
      fs.writeFileSync(outboxFilePath, JSON.stringify(payload, null, 2), 'utf-8');

      console.log(
        JSON.stringify({
          ticketId: 0,
          target: values.to,
          blocking: Boolean(values.blocking),
          status: 'queued_outbox',
        })
      );
      process.exit(0);
    } catch (fsErr: any) {
      console.error(`Bridge unreachable (${netErr.message}) and outbox failed: ${fsErr.message}`);
      process.exit(4);
    }
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
