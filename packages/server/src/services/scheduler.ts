export type ScheduledJob = [name: string, run: () => Promise<unknown>];

/**
 * One periodic tick running each job in order. A tick is skipped while the previous one is
 * still running, and a failing job is logged without stopping the others.
 * Returns a function that stops the schedule.
 */
export function startScheduler(jobs: ScheduledJob[], intervalMs: number): () => void {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      for (const [name, run] of jobs) {
        try {
          await run();
        } catch (err: any) {
          console.warn(`[scheduler] ${name} failed: ${err?.message || err}`);
        }
      }
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  return () => clearInterval(timer);
}
