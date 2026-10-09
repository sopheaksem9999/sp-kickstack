import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { submitTicket } from './submit.js';

const outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xticket-outbox-'));
const payload = { to: 'backend', type: 'api_request', title: 'GET /x', body: 'Provide it please', blocking: true, project: 'mobile' };
const respond = (status: number, body: unknown) => async () =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const outboxFiles = () => fs.readdirSync(outboxDir).filter((f) => f.endsWith('.json'));

describe('xticket submitTicket', () => {
  afterAll(() => fs.rmSync(outboxDir, { recursive: true, force: true }));

  it('prints the ticket and exits 0 on success', async () => {
    const r = await submitTicket(payload, { bridgeUrl: 'http://b', fetchImpl: respond(201, { ticketId: 7 }), outboxDir });
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout!).ticketId).toBe(7);
  });

  it('exits non-zero with the reason when the token is missing or wrong', async () => {
    const r = await submitTicket(payload, { bridgeUrl: 'http://b', fetchImpl: respond(401, { error: 'Invalid or missing agent token' }), outboxDir });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/XTICKET_TOKEN/);
  });

  it('falls back to the outbox when the bridge answers 5xx, so the bridge retries', async () => {
    const before = outboxFiles().length;
    const r = await submitTicket(payload, { bridgeUrl: 'http://b', fetchImpl: respond(502, { error: 'engine down' }), outboxDir });
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout!).status).toBe('queued_outbox');
    expect(outboxFiles().length).toBe(before + 1);
  });

  it('exits non-zero for any other error status', async () => {
    const r = await submitTicket(payload, { bridgeUrl: 'http://b', fetchImpl: respond(404, { error: 'nope' }), outboxDir });
    expect(r.exitCode).not.toBe(0);
  });

  it('keeps the validation and limit exit codes', async () => {
    expect((await submitTicket(payload, { bridgeUrl: 'http://b', fetchImpl: respond(400, { error: 'bad' }), outboxDir })).exitCode).toBe(2);
    expect((await submitTicket(payload, { bridgeUrl: 'http://b', fetchImpl: respond(429, { error: 'limit' }), outboxDir })).exitCode).toBe(3);
  });

  it('falls back to the outbox when the bridge is unreachable', async () => {
    const before = outboxFiles().length;
    const r = await submitTicket(payload, { bridgeUrl: 'http://b', fetchImpl: async () => { throw new Error('ECONNREFUSED'); }, outboxDir });
    expect(r.exitCode).toBe(0);
    expect(outboxFiles().length).toBe(before + 1);
  });
});
