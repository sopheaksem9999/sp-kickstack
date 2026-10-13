import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { agentEnvironment } from './agentEnv.js';

describe('agent environment', () => {
  const base = {
    HOME: '/Users/me', FOO: 'bar', PATH: '/usr/bin:/bin', PORT: '4100', HOST: '127.0.0.1', WORKSPACE_DIR: '/ws',
    AGENT_TOKEN: 'secret', GITHUB_WEBHOOK_SECRET: 'hook', DEMO_MODE: '1', npm_lifecycle_event: 'dev', npm_config_prefix: '/x',
  };

  it("leaves out the server's own settings and npm's variables, keeps the rest", () => {
    const env = agentEnvironment(base, { launcherDir: '/ws/agent-bin', cliBin: '/Users/me/.local/bin/agy', homeDir: '/Users/me', extra: { XTICKET_TASK: 'local-1' } });
    for (const key of ['PORT', 'HOST', 'WORKSPACE_DIR', 'AGENT_TOKEN', 'GITHUB_WEBHOOK_SECRET', 'DEMO_MODE', 'npm_lifecycle_event', 'npm_config_prefix']) {
      expect(env[key]).toBeUndefined();
    }
    expect(env).toMatchObject({ HOME: '/Users/me', FOO: 'bar', XTICKET_TASK: 'local-1' });
  });

  it('puts the launcher first and adds the usual tool folders a desktop app lacks, without duplicates', () => {
    const env = agentEnvironment(base, { launcherDir: '/ws/agent-bin', cliBin: '/Users/me/.local/bin/agy', homeDir: '/Users/me', extra: {} });
    const dirs = env.PATH!.split(path.delimiter);
    expect(dirs[0]).toBe('/ws/agent-bin');
    expect(dirs).toEqual(expect.arrayContaining(['/Users/me/.local/bin', path.dirname(process.execPath), '/usr/bin', '/bin']));
    expect(new Set(dirs).size).toBe(dirs.length);
  });
});
