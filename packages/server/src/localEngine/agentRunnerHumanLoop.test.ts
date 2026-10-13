import { describe, it, expect, afterAll } from 'vitest';
import { cleanLocalHarnesses, makeLocalHarness } from '../testing/localEngineFixture.js';

afterAll(() => cleanLocalHarnesses());

describe('AgentRunner: questions and notes', () => {
  it('pauses an agent that asked a question and continues with the answer', async () => {
    const h = makeLocalHarness(); // holdGraceMs 300
    const { run, task } = h.queueRun('FAKE: wait-for-note 20000\nFAKE: commit answer.txt');
    await h.runner.tick();
    h.runner.hold(run.id, 'Waiting for a person to answer question #5');
    expect(h.run(run.id).status).toBe('held');
    await h.runner.idle(); // stopped after the hold grace
    expect(h.run(run.id)).toMatchObject({ status: 'held', pid: null });
    expect(h.logText(task.id)).toContain('⏸ Waiting for a person to answer');

    h.runner.release(run.id, 'Answer to your question: use Postgres');
    await h.settle();
    expect(h.run(run.id).status).toBe('review');
    const second = h.prompts(run.id)[1];
    expect(second).toContain('## Continue');
    expect(second).toContain('## Notes since your last run\nAnswer to your question: use Postgres');
  }, 15_000);

  it('refuses to pause a finished run', async () => {
    const h = makeLocalHarness();
    const { run } = h.queueRun('FAKE: commit a.txt');
    await h.settle();
    expect(() => h.runner.hold(run.id, 'x')).toThrow(`Run ${run.id} is review; it cannot be paused`);
  });

  it('keeps a note for a running agent and gives it at the next run', async () => {
    const h = makeLocalHarness();
    const { run, task } = h.queueRun('FAKE: sleep 300\nFAKE: dirty wip.txt');
    await h.runner.tick();
    h.runner.note(run.id, '## Note from a person\nUse the v2 endpoint');
    await h.runner.idle();
    expect(h.logText(task.id)).toContain('✉ Note saved; the agent gets it at its next run');
    expect(h.run(run.id)).toMatchObject({ status: 'no_changes', notes_md: '## Note from a person\nUse the v2 endpoint' });

    const next = h.runner.runs.create({ bridgeTaskId: task.id, project: 'backend', title: 'T', bodyMd: 'FAKE: commit a.txt' });
    await h.settle();
    expect(h.prompts(next.id)[0]).toContain('## Notes since your last run\n## Note from a person\nUse the v2 endpoint');
  }, 15_000);
});

describe('AgentRunner: usage limits', () => {
  it('waits for the reset the CLI reported, pauses the CLI, then continues by itself', async () => {
    let clock = Date.now();
    const h = makeLocalHarness({ runner: { now: () => clock } });
    const resetsAt = Math.floor(clock / 1000) + 600;
    const limited = h.queueRun(`FAKE: limit-once ${resetsAt}\nFAKE: commit a.txt`);
    await h.settle();
    const resumeAt = new Date(resetsAt * 1000).toISOString();
    expect(h.run(limited.run.id)).toMatchObject({ status: 'rate_limited', resume_at: resumeAt, continuation: 1 });
    expect(h.logText(limited.task.id)).toContain(`⏸ Claude Code usage limit reached; this run continues at ${resumeAt}`);

    const waiting = h.queueRun('FAKE: commit b.txt');
    await h.settle();
    expect(h.run(waiting.run.id).status).toBe('queued'); // the CLI is paused

    clock = resetsAt * 1000 + 1000;
    await h.settle();
    expect(h.run(limited.run.id).status).toBe('review');
    expect(h.run(waiting.run.id).status).toBe('review');
    expect(h.logText(limited.task.id)).toContain('↻ Usage limit reset; continuing');
  }, 20_000);

  it('asks the CLI quota when the message has no reset time, else waits 15 minutes', async () => {
    const quota = new Date(Date.now() + 3_600_000).toISOString();
    const withQuota = makeLocalHarness({ cli: 'agy-cli', runner: { quotaResetAt: async () => quota } });
    const a = withQuota.queueRun('FAKE: limit 0');
    await withQuota.settle();
    expect(withQuota.run(a.run.id)).toMatchObject({ status: 'rate_limited', resume_at: quota });

    let clock = Date.now();
    const without = makeLocalHarness({ cli: 'agy-cli', runner: { now: () => clock } });
    const b = without.queueRun('FAKE: limit 0');
    await without.settle();
    expect(without.run(b.run.id).resume_at).toBe(new Date(clock + 15 * 60_000).toISOString());
  }, 15_000);

  it('treats a usage-limit message on the CLI stderr as a limit, not a failure', async () => {
    const h = makeLocalHarness();
    const { run } = h.queueRun('FAKE: stderr Error: 429 Too Many Requests\nFAKE: exit 1');
    await h.settle();
    expect(h.run(run.id).status).toBe('rate_limited');
  });
});
