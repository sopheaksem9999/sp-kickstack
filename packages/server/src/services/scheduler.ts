export type ScheduledJob = [name: string, run: () => Promise<unknown>];

/**
 * Start every job on each tick. A job is skipped while its previous run is still going,
 * so a slow job (e.g. a hung engine) never delays the others, and a failing job is logged
 * without affecting the rest. Returns a function that stops the schedule.
 */
export function startScheduler(jobs: ScheduledJob[], intervalMs: number): () => void {
  const running = new Set<string>();

  const runJob = async (name: string, run: () => Promise<unknown>) => {
    if (running.has(name)) return;
    running.add(name);
    try {
      await run();
    } catch (err: any) {
      console.warn(`[scheduler] ${name} failed: ${err?.message || err}`);
    } finally {
      running.delete(name);
    }
  };

  const timer = setInterval(() => {
    for (const [name, run] of jobs) {
      void runJob(name, run);
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
