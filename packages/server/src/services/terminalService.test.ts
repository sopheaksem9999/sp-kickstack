import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { TerminalService } from './terminalService.js';
import { ProjectService } from './projectService.js';
import { initDatabase, AppDatabase } from '../db/index.js';

describe('TerminalService', () => {
  let tmpDir: string;
  let db: AppDatabase;
  let projectService: ProjectService;
  let terminalService: TerminalService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-test-'));
    db = initDatabase(':memory:');
    projectService = new ProjectService(db);
    projectService.registerProject({
      name: 'test-backend',
      workspace_id: 'default',
      repo_path: tmpDir,
      kind: 'backend',
      engine_type: 'manual',
    });
    terminalService = new TerminalService(projectService);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('initializes idle session for existing project', () => {
    const session = terminalService.getSession('test-backend');
    expect(session.projectName).toBe('test-backend');
    expect(session.repoPath).toBe(tmpDir);
    expect(session.running).toBe(false);
    expect(session.buffer).toBe('');
  });

  it('spawns shell and executes command persistently', async () => {
    terminalService.sendInput('test-backend', 'echo "HELLO_PERSISTENT_TERMINAL"');
    
    // Wait for stdout
    await new Promise((r) => setTimeout(r, 600));

    const session = terminalService.getSession('test-backend');
    expect(session.running).toBe(true);
    expect(session.pid).toBeTypeOf('number');
    expect(session.buffer).toContain('HELLO_PERSISTENT_TERMINAL');

    const active = terminalService.getActiveProjects();
    expect(active).toContain('test-backend');
  });

  it('retains buffer across navigation and clears buffer on request', async () => {
    terminalService.sendInput('test-backend', 'echo "OUTPUT_LINE_1"');
    await new Promise((r) => setTimeout(r, 400));

    // Simulate navigating away and coming back:
    const session1 = terminalService.getSession('test-backend');
    expect(session1.buffer).toContain('OUTPUT_LINE_1');

    terminalService.clear('test-backend');
    const session2 = terminalService.getSession('test-backend');
    expect(session2.buffer).toBe('');
  });

  it('interrupts running process gracefully', async () => {
    terminalService.sendInput('test-backend', 'sleep 5');
    await new Promise((r) => setTimeout(r, 200));

    const interrupted = terminalService.interrupt('test-backend');
    expect(interrupted).toBe(true);

    const session = terminalService.getSession('test-backend');
    expect(session.buffer).toContain('^C');
  });
});
