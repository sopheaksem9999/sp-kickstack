import os from 'node:os';
import path from 'node:path';

/** The bridge server's own settings: an agent's project (its dev server, its tests) must not read them. */
const SERVER_ONLY = new Set([
  'PORT', 'HOST', 'WORKSPACE_DIR', 'AGENT_TOKEN', 'GITHUB_WEBHOOK_SECRET', 'DEMO_MODE', 'WATCH_INTERVAL_MS',
  'ENGINE_TIMEOUT_MS', 'WEB_ORIGINS', 'ALLOWED_HOSTS', 'XTICKET_CLI',
]);

export interface AgentEnvOptions {
  /** Folder with the xticket launcher; first on PATH. */
  launcherDir: string;
  /** The CLI binary: its folder usually holds the tools it was installed with. */
  cliBin: string;
  homeDir?: string;
  /** XTICKET_* and other variables for this run. */
  extra: Record<string, string>;
}

/**
 * Environment for an agent: the server's environment without its own settings or npm's run
 * variables, with the usual tool folders on PATH (a desktop app starts with a short PATH).
 */
export function agentEnvironment(base: NodeJS.ProcessEnv, opts: AgentEnvOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined || SERVER_ONLY.has(key) || key.startsWith('npm_')) continue;
    env[key] = value;
  }
  const home = opts.homeDir ?? os.homedir();
  const toolDirs = process.platform === 'win32' ? [] : [path.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
  const dirs = [opts.launcherDir, path.dirname(opts.cliBin), path.dirname(process.execPath), ...toolDirs, ...(base.PATH ?? '').split(path.delimiter)];
  env.PATH = [...new Set(dirs.filter(Boolean))].join(path.delimiter);
  return { ...env, ...opts.extra };
}
