// Agent processes: each CLI runs in its own process group so stopping it stops everything it
// started. A process is only ever stopped when it is provably ours: a child we hold, or a pid
// whose start time matches the one recorded when we spawned it.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import type { CliCommand } from './cliProfiles.js';

export interface AgentExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** Set when the process could not be started at all (missing binary, no permission). */
  spawnError: string | null;
}

export interface SpawnedAgent {
  child: ChildProcess;
  pid: number;
  /** Start time as `ps` prints it; with the pid it identifies this process after a restart. */
  startedAt: string | null;
  /** Resolves once the process ended and its output is read. */
  exited: Promise<AgentExit>;
}

const POSIX = process.platform !== 'win32';
/** How long to wait for the output to close after the CLI exited (a leftover process may hold it). */
const OUTPUT_DRAIN_MS = 2000;

export function spawnAgent(cmd: CliCommand, cwd: string, env: NodeJS.ProcessEnv): SpawnedAgent {
  const child = spawn(cmd.bin, cmd.args, { cwd, env, detached: POSIX, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const exited = new Promise<AgentExit>((resolve) => {
    let spawnError: string | null = null;
    let status: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    const done = () => resolve({ code: status?.code ?? null, signal: status?.signal ?? null, spawnError });
    child.once('error', (err) => {
      spawnError = err.message;
      setTimeout(done, 100);
    });
    child.once('exit', (code, signal) => {
      status = { code, signal };
      setTimeout(done, OUTPUT_DRAIN_MS);
    });
    child.once('close', (code, signal) => {
      status = status ?? { code, signal };
      done();
    });
  });
  child.stdin?.on('error', () => {}); // the CLI may exit before reading all of stdin
  child.stdin?.end(cmd.stdin ?? undefined);
  const pid = child.pid ?? -1;
  return { child, pid, startedAt: pid > 0 ? processStartTime(pid) : null, exited };
}

export function processStartTime(pid: number): string | null {
  if (!POSIX) return null;
  try {
    return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === 'EPERM';
  }
}

/** True only for the very process we started: same pid and same start time. */
export function isSameProcess(pid: number | null, startedAt: string | null): boolean {
  return Boolean(pid && pid > 0 && startedAt && isAlive(pid) && processStartTime(pid) === startedAt);
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  if (!POSIX) {
    try {
      execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // Already gone.
    }
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone.
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** SIGTERM the process group, then SIGKILL it if it is still there after `graceMs`. */
export async function stopGroup(pid: number, exited: Promise<unknown> | null, graceMs: number): Promise<void> {
  if (pid <= 0) return;
  signalGroup(pid, 'SIGTERM');
  if (exited) {
    const done = await Promise.race([exited.then(() => true), sleep(graceMs).then(() => false)]);
    if (!done) {
      signalGroup(pid, 'SIGKILL');
      await Promise.race([exited, sleep(graceMs)]);
    }
    return;
  }
  const deadline = Date.now() + graceMs;
  while (isAlive(pid) && Date.now() < deadline) await sleep(100);
  if (isAlive(pid)) signalGroup(pid, 'SIGKILL');
}

/** After the CLI exited: stop what it left running in its group (a dev server, a watcher). */
export function killGroupLeftovers(pid: number): void {
  if (!POSIX || pid <= 0) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // Nothing left.
  }
}
