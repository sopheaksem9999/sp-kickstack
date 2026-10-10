import fs from 'node:fs';
import path from 'node:path';

export interface SubmitOptions {
  bridgeUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
  /** Worktree outbox the bridge scans when it could not be reached or failed. */
  outboxDir: string;
  /** Bridge path to post to (default /api/agent/tickets). */
  endpoint?: string;
}

export interface SubmitResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

function queueInOutbox(payload: Record<string, unknown>, outboxDir: string, reason: string): SubmitResult {
  const question = payload.kind === 'question';
  try {
    fs.mkdirSync(outboxDir, { recursive: true });
    const prefix = question ? 'question' : 'ticket';
    const file = path.join(outboxDir, `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`);
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8');
    const result = question
      ? {
          questionId: 0,
          status: 'queued_outbox',
          reason,
          message: 'The bridge files your question as soon as it can. Stop working now; the answer arrives as a note when your task resumes.',
        }
      : { ticketId: 0, target: payload.to, blocking: Boolean(payload.blocking), status: 'queued_outbox', reason };
    return { exitCode: 0, stdout: JSON.stringify(result) };
  } catch (fsErr: any) {
    return { exitCode: 4, stderr: `${reason} and outbox failed: ${fsErr.message}` };
  }
}

/**
 * Send a ticket (or, with `endpoint` and `kind: 'question'`, a question) to the bridge. Exit codes: 0 created (or queued in the outbox for the
 * bridge to retry), 2 validation, 3 limit, 4 outbox write failed, 5 unauthorized,
 * 1 any other rejection. Every failure explains itself on stderr.
 */
export async function submitTicket(payload: Record<string, unknown>, opts: SubmitOptions): Promise<SubmitResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const noun = payload.kind === 'question' ? 'question' : 'ticket';

  let res: Response;
  try {
    res = await fetchImpl(`${opts.bridgeUrl}${opts.endpoint ?? '/api/agent/tickets'}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch (netErr: any) {
    return queueInOutbox(payload, opts.outboxDir, `Bridge unreachable (${netErr.message})`);
  }

  if (res.ok) {
    return { exitCode: 0, stdout: JSON.stringify(await res.json()) };
  }

  const err = (await res.json().catch(() => ({}))) as { error?: string };
  const reason = err.error || res.statusText || `HTTP ${res.status}`;

  if (res.status === 400) return { exitCode: 2, stderr: `Validation error: ${reason}` };
  if (res.status === 429) return { exitCode: 3, stderr: `Limit hit: ${reason}` };
  if (res.status === 401 || res.status === 403) {
    return { exitCode: 5, stderr: `Unauthorized (${res.status}): ${reason}. Set XTICKET_TOKEN to the bridge's AGENT_TOKEN.` };
  }
  // Server-side failures (engine down, hold failed) are retried by the bridge from the outbox;
  // ticket and question creation are idempotent, so a duplicate submission is safe.
  if (res.status >= 500) {
    return queueInOutbox(payload, opts.outboxDir, `Bridge error ${res.status}: ${reason}`);
  }
  return { exitCode: 1, stderr: `Bridge rejected the ${noun} (${res.status}): ${reason}` };
}
