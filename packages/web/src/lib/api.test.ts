import { describe, it, expect, vi, afterEach } from 'vitest';
import * as api from './api';

function respondWith(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    )
  );
}

describe('api wrappers surface server errors', () => {
  afterEach(() => vi.unstubAllGlobals());

  const calls: Array<[string, () => Promise<unknown>]> = [
    ['startRequirementFanOut', () => api.startRequirementFanOut('REQ-001')],
    ['cancelRequirement', () => api.cancelRequirement('REQ-001')],
    ['fetchRequirementGraph', () => api.fetchRequirementGraph('REQ-001')],
    ['markTaskDone', () => api.markTaskDone(1)],
    ['releaseLink', () => api.releaseLink(1)],
    ['updateRequirementStatus', () => api.updateRequirementStatus('REQ-001', 'done')],
    ['mergeRequirementToMain', () => api.mergeRequirementToMain('REQ-001')],
    ['runTaskCli', () => api.runTaskCli(1)],
  ];

  it.each(calls)('%s rejects with the server message', async (_name, call) => {
    respondWith(409, { error: 'Requirement is cancelled' });
    await expect(call()).rejects.toThrow('Requirement is cancelled');
  });

  it('falls back to the HTTP status when the body has no error field', async () => {
    respondWith(500, {});
    await expect(api.markTaskDone(1)).rejects.toThrow(/500/);
  });

  it('resolves with the JSON body on success', async () => {
    respondWith(200, { ok: true });
    await expect(api.markTaskDone(1)).resolves.toEqual({ ok: true });
  });
});
