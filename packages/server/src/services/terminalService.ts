import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ProjectTerminalStatus } from '@sp-kickstack/shared';
import { ProjectService } from './projectService.js';

interface TerminalSessionInternal {
  projectName: string;
  repoPath: string;
  child: ChildProcess | null;
  pid?: number;
  buffer: string;
  startedAt?: string;
  lastCommand?: string;
  subscribers: Set<(chunk: string) => void>;
}

const MAX_BUFFER_CHARS = 200000; // ~4000 lines of scrollback

export class TerminalService {
  private sessions = new Map<string, TerminalSessionInternal>();

  constructor(private projectService: ProjectService) {
    // Graceful process cleanup on server exit
    const cleanup = () => {
      for (const [name, session] of this.sessions.entries()) {
        if (session.child && !session.child.killed) {
          try {
            session.child.kill('SIGTERM');
          } catch {
            // ignore
          }
        }
      }
    };
    process.once('exit', cleanup);
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
  }

  private resolveRepo(projectName: string): string {
    const project = this.projectService.getProject(projectName);
    if (!project || !project.repo_path) {
      throw new Error(`Project "${projectName}" not found or has no repo path`);
    }
    if (!fs.existsSync(project.repo_path)) {
      throw new Error(`Repository path does not exist: ${project.repo_path}`);
    }
    return project.repo_path;
  }

  private appendBuffer(session: TerminalSessionInternal, text: string) {
    session.buffer += text;
    if (session.buffer.length > MAX_BUFFER_CHARS) {
      // Retain last ~150k characters
      session.buffer = session.buffer.slice(session.buffer.length - 150000);
    }
    // Broadcast to live subscribers
    for (const sub of session.subscribers) {
      try {
        sub(text);
      } catch {
        // ignore subscriber errors
      }
    }
  }

  public getSession(projectName: string): ProjectTerminalStatus {
    const session = this.sessions.get(projectName);
    if (!session) {
      const repoPath = this.resolveRepo(projectName);
      return {
        projectName,
        repoPath,
        running: false,
        buffer: '',
      };
    }

    const running = Boolean(session.child && !session.child.killed);
    return {
      projectName: session.projectName,
      repoPath: session.repoPath,
      running,
      pid: session.pid,
      buffer: session.buffer,
      startedAt: session.startedAt,
      lastCommand: session.lastCommand,
    };
  }

  public ensureShell(projectName: string): TerminalSessionInternal {
    let session = this.sessions.get(projectName);
    const repoPath = this.resolveRepo(projectName);

    if (!session) {
      session = {
        projectName,
        repoPath,
        child: null,
        buffer: '',
        subscribers: new Set(),
      };
      this.sessions.set(projectName, session);
    }

    if (!session.child || session.child.killed) {
      const shell = process.env.SHELL || (os.platform() === 'win32' ? 'cmd.exe' : '/bin/zsh');
      const args = os.platform() === 'win32' ? [] : ['-l'];

      this.appendBuffer(
        session,
        `\r\n\x1b[35m[Terminal session initialized for ${projectName} in ${repoPath}]\x1b[0m\r\n`
      );

      try {
        const child = spawn(shell, args, {
          cwd: repoPath,
          env: {
            ...process.env,
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor',
            PWD: repoPath,
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        session.child = child;
        session.pid = child.pid;
        session.startedAt = new Date().toISOString();

        child.stdout?.on('data', (data: Buffer) => {
          this.appendBuffer(session!, data.toString('utf8'));
        });

        child.stderr?.on('data', (data: Buffer) => {
          this.appendBuffer(session!, data.toString('utf8'));
        });

        child.on('error', (err) => {
          this.appendBuffer(
            session!,
            `\r\n\x1b[31m[Process error: ${err.message}]\x1b[0m\r\n`
          );
          session!.child = null;
          session!.pid = undefined;
        });

        child.on('exit', (code, signal) => {
          this.appendBuffer(
            session!,
            `\r\n\x1b[33m[Process exited with code ${code ?? signal ?? 0}]\x1b[0m\r\n`
          );
          session!.child = null;
          session!.pid = undefined;
        });
      } catch (err: any) {
        this.appendBuffer(
          session,
          `\r\n\x1b[31m[Failed to spawn shell: ${err.message}]\x1b[0m\r\n`
        );
      }
    }

    return session;
  }

  public sendInput(projectName: string, input: string): ProjectTerminalStatus {
    const session = this.ensureShell(projectName);
    session.lastCommand = input.trim();

    if (session.child && session.child.stdin && !session.child.stdin.destroyed) {
      // Echo command visually with timestamp
      this.appendBuffer(session, `\r\n\x1b[36m$ ${input}\x1b[0m\r\n`);
      session.child.stdin.write(`${input}\n`);
    } else {
      this.appendBuffer(
        session,
        `\r\n\x1b[31m[Cannot send command: Terminal shell is not active]\x1b[0m\r\n`
      );
    }

    return this.getSession(projectName);
  }

  public interrupt(projectName: string): boolean {
    const session = this.sessions.get(projectName);
    if (!session || !session.child || session.child.killed) return false;

    try {
      // Send SIGINT / ASCII Ctrl+C
      this.appendBuffer(session, `^C\r\n`);
      if (session.child.stdin && !session.child.stdin.destroyed) {
        session.child.stdin.write('\x03');
      }
      session.child.kill('SIGINT');
      return true;
    } catch {
      return false;
    }
  }

  public restart(projectName: string): ProjectTerminalStatus {
    const session = this.sessions.get(projectName);
    if (session?.child && !session.child.killed) {
      try {
        session.child.kill('SIGKILL');
      } catch {
        // ignore
      }
      session.child = null;
      session.pid = undefined;
    }

    this.ensureShell(projectName);
    return this.getSession(projectName);
  }

  public clear(projectName: string): boolean {
    const session = this.sessions.get(projectName);
    if (session) {
      session.buffer = '';
    }
    return true;
  }

  public subscribe(projectName: string, callback: (chunk: string) => void): () => void {
    const session = this.ensureShell(projectName);
    session.subscribers.add(callback);
    return () => {
      session.subscribers.delete(callback);
    };
  }

  public getActiveProjects(): string[] {
    const active: string[] = [];
    for (const [name, session] of this.sessions.entries()) {
      if (session.child && !session.child.killed) {
        active.push(name);
      }
    }
    return active;
  }
}
