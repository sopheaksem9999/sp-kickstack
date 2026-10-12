import { ChildProcess, spawn, execSync } from 'child_process';
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
  shell?: string;
  buffer: string;
  startedAt?: string;
  lastCommand?: string;
  subscribers: Set<(chunk: string) => void>;
}

const MAX_BUFFER_CHARS = 200000; // ~4000 lines of scrollback

let cachedBaseInteractiveEnv: NodeJS.ProcessEnv | null = null;

export function detectDeviceShell(): string {
  const platform = os.platform();
  if (platform === 'win32') {
    return process.env.COMSPEC || 'powershell.exe';
  }

  if (platform === 'darwin') {
    // macOS default device terminal shell is zsh
    if (process.env.SHELL && process.env.SHELL.includes('zsh') && fs.existsSync(process.env.SHELL)) {
      return process.env.SHELL;
    }
    const candidateZshs = ['/bin/zsh', '/opt/homebrew/bin/zsh', '/usr/local/bin/zsh'];
    for (const cand of candidateZshs) {
      if (fs.existsSync(cand)) {
        return cand;
      }
    }
    return process.env.SHELL || '/bin/zsh';
  }

  // Linux and other Unix systems
  return process.env.SHELL || '/bin/bash';
}

export function resolveLocalPcEnvironment(shell: string, repoPath?: string): NodeJS.ProcessEnv {
  if (!cachedBaseInteractiveEnv) {
    const baseEnv: NodeJS.ProcessEnv = {
      ...process.env,
      SHELL: shell,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    };

    const home = os.homedir();
    if (!baseEnv.HOME) baseEnv.HOME = home;
    if (!baseEnv.USER) {
      try {
        baseEnv.USER = os.userInfo().username;
      } catch {
        // fallback
      }
    }

    // Common platform paths to ensure tools (brew, git, pnpm, nvm, cargo, node, etc.) are available
    const extraPaths: string[] = [];
    if (os.platform() === 'darwin') {
      extraPaths.push(
        '/opt/homebrew/bin',
        '/opt/homebrew/sbin',
        '/usr/local/bin',
        '/usr/local/sbin',
        path.join(home, 'Library/pnpm/bin'),
        path.join(home, '.cargo/bin'),
        path.join(home, '.local/bin'),
        path.join(home, '.bun/bin'),
        '/System/Cryptexes/App/usr/bin',
        '/usr/bin',
        '/bin',
        '/usr/sbin',
        '/sbin'
      );
    } else if (os.platform() === 'linux') {
      extraPaths.push(
        '/usr/local/bin',
        '/usr/local/sbin',
        '/usr/bin',
        '/bin',
        path.join(home, '.local/bin'),
        path.join(home, '.cargo/bin')
      );
    }

    // Active Node binary directory (ensures node matches local PC process environment)
    const activeNodeBinDir = path.dirname(process.execPath);

    // Detect NVM installed versions to prioritize ahead of system /usr/local/bin
    const nvmVersionsDir = path.join(home, '.nvm', 'versions', 'node');
    const nvmBinDirs: string[] = [];
    if (fs.existsSync(nvmVersionsDir)) {
      try {
        const vers = fs.readdirSync(nvmVersionsDir);
        for (const v of vers.sort().reverse()) {
          const b = path.join(nvmVersionsDir, v, 'bin');
          if (fs.existsSync(b)) {
            nvmBinDirs.push(b);
          }
        }
      } catch {
        // ignore
      }
    }

    // On Unix/macOS, resolve the actual user shell environment (sources ~/.zprofile & ~/.zshrc)
    if (os.platform() !== 'win32') {
      let resolved = false;
      try {
        const sourceScript = shell.includes('zsh')
          ? '[ -f "$HOME/.zprofile" ] && source "$HOME/.zprofile" 2>/dev/null; [ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc" 2>/dev/null; env'
          : '[ -f "$HOME/.bash_profile" ] && source "$HOME/.bash_profile" 2>/dev/null; [ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc" 2>/dev/null; env';

        const rawEnv = execSync(`${shell} -c '${sourceScript}'`, {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 3000,
        });

        const lines = rawEnv.split('\n');
        for (const line of lines) {
          const eqIdx = line.indexOf('=');
          if (eqIdx > 0) {
            const key = line.slice(0, eqIdx).trim();
            const val = line.slice(eqIdx + 1);
            if (key && !key.startsWith('_')) {
              baseEnv[key] = val;
            }
          }
        }
        resolved = true;
      } catch {
        // fallback
      }

      if (!resolved) {
        try {
          const rawEnv = execSync(`${shell} -i -c env`, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 2500,
          });

          const lines = rawEnv.split('\n');
          for (const line of lines) {
            const eqIdx = line.indexOf('=');
            if (eqIdx > 0) {
              const key = line.slice(0, eqIdx).trim();
              const val = line.slice(eqIdx + 1);
              if (key && !key.startsWith('_')) {
                baseEnv[key] = val;
              }
            }
          }
        } catch {
          // Fallback: continue with synthesized paths
        }
      }
    }

    // Prioritize active node and user tools ahead of system /usr/local/bin
    // (prevents macOS /etc/zprofile path_helper from shadowing the active node version with /usr/local/bin/node)
    const prioritizedBinDirs = [
      activeNodeBinDir,
      ...nvmBinDirs.slice(0, 1),
      path.join(home, 'Library/pnpm/bin'),
      path.join(home, '.cargo/bin'),
      path.join(home, '.local/bin'),
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
    ].filter((p) => p && fs.existsSync(p));

    const currentPathParts = (baseEnv.PATH || '')
      .split(path.delimiter)
      .filter((p) => Boolean(p) && !prioritizedBinDirs.includes(p));

    baseEnv.PATH = [...prioritizedBinDirs, ...currentPathParts].join(path.delimiter);

    cachedBaseInteractiveEnv = baseEnv;
  }

  // Clone base environment for this invocation
  const projectEnv: NodeJS.ProcessEnv = { ...cachedBaseInteractiveEnv };

  // If repo has .nvmrc or .node-version, automatically prioritize that Node version
  if (repoPath && fs.existsSync(repoPath)) {
    const home = os.homedir();
    const nvmrcPath = path.join(repoPath, '.nvmrc');
    const nodeVersionPath = path.join(repoPath, '.node-version');
    let targetVersion = '';

    if (fs.existsSync(nvmrcPath)) {
      try {
        targetVersion = fs.readFileSync(nvmrcPath, 'utf8').trim().replace(/^v/, '');
      } catch {
        // ignore
      }
    } else if (fs.existsSync(nodeVersionPath)) {
      try {
        targetVersion = fs.readFileSync(nodeVersionPath, 'utf8').trim().replace(/^v/, '');
      } catch {
        // ignore
      }
    }

    if (targetVersion) {
      const nvmNodeDir = path.join(home, '.nvm/versions/node');
      if (fs.existsSync(nvmNodeDir)) {
        try {
          const available = fs.readdirSync(nvmNodeDir);
          const match = available.find(
            (v) => v === `v${targetVersion}` || v === targetVersion || v.startsWith(`v${targetVersion}`)
          );
          if (match) {
            const matchedBin = path.join(nvmNodeDir, match, 'bin');
            if (fs.existsSync(matchedBin)) {
              const remaining = (projectEnv.PATH || '')
                .split(path.delimiter)
                .filter((p) => p !== matchedBin && !p.includes('/.nvm/versions/node/'));
              projectEnv.PATH = [matchedBin, ...remaining].join(path.delimiter);
            }
          }
        } catch {
          // ignore directory read error
        }
      }
    }
  }

  return projectEnv;
}

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
    const defaultShell = detectDeviceShell();
    if (!session) {
      const repoPath = this.resolveRepo(projectName);
      return {
        projectName,
        repoPath,
        running: false,
        shell: defaultShell,
        buffer: '',
      };
    }

    const running = Boolean(session.child && !session.child.killed);
    return {
      projectName: session.projectName,
      repoPath: session.repoPath,
      running,
      pid: session.pid,
      shell: session.shell || defaultShell,
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
      const shell = detectDeviceShell();
      // On Unix/macOS, avoid passing '-l' because macOS /etc/zprofile's path_helper
      // prepends system /usr/local/bin (old node) over the user's interactive NVM version.
      const args: string[] = [];
      const sessionEnv = {
        ...resolveLocalPcEnvironment(shell, repoPath),
        PWD: repoPath,
      };
      const shellName = path.basename(shell);

      this.appendBuffer(
        session,
        `\r\n\x1b[35m[Terminal session initialized for ${projectName} in ${repoPath}]\x1b[0m\r\n` +
        `\x1b[90m[Device shell: ${shellName} (${os.platform()}) with local PC environment]\x1b[0m\r\n`
      );

      try {
        const child = spawn(shell, args, {
          cwd: repoPath,
          env: sessionEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        session.child = child;
        session.pid = child.pid;
        session.shell = shell;
        session.startedAt = new Date().toISOString();

        // On Unix/macOS, source user's interactive & login profile on shell launch
        // so nvm, rvm, cargo, and aliases from ~/.zshrc are active in the live session
        if (os.platform() !== 'win32' && child.stdin) {
          const initScript =
            '[ -f "$HOME/.zprofile" ] && source "$HOME/.zprofile" 2>/dev/null; ' +
            '[ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc" 2>/dev/null; ' +
            '[ -f "$HOME/.bash_profile" ] && source "$HOME/.bash_profile" 2>/dev/null; ' +
            '[ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc" 2>/dev/null\n';
          child.stdin.write(initScript);
        }

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
