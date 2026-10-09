import { ChildProcess, spawn, execSync } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { IdeServerStatus, IdeSettings, IdeSettingsSchema } from '@sp-kickstack/shared';
import { SettingsService } from './settingsService.js';
import { ProjectService } from './projectService.js';

export class IdeService {
  private activeProcess: ChildProcess | null = null;
  private activePid?: number;
  private activeFolder?: string;
  private lastError?: string;

  constructor(
    private settingsService: SettingsService,
    private projectService: ProjectService
  ) {}

  public getSettings(): IdeSettings {
    return this.settingsService.getIdeSettings();
  }

  public updateSettings(updates: Partial<IdeSettings>): IdeSettings {
    return this.settingsService.updateIdeSettings(updates);
  }

  /**
   * Find available web IDE binary on the system
   */
  public findBinary(customPath?: string): string | null {
    if (customPath && customPath.trim()) {
      const expanded = customPath.replace(/^~(?=$|\/|\\)/, os.homedir());
      if (fs.existsSync(expanded)) return expanded;
    }

    const candidates = [
      'code-server',
      '/opt/homebrew/bin/code-server',
      '/usr/local/bin/code-server',
      path.join(os.homedir(), '.local/bin/code-server'),
      path.join(os.homedir(), '.npm-global/bin/code-server'),
      'openvscode-server',
      '/opt/homebrew/bin/openvscode-server',
      '/usr/local/bin/openvscode-server',
      path.join(os.homedir(), '.local/bin/openvscode-server'),
      'code',
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
    ];

    for (const bin of candidates) {
      if (bin.startsWith('/')) {
        if (fs.existsSync(bin)) return bin;
      } else {
        try {
          const res = execSync(`which ${bin} 2>/dev/null`, { encoding: 'utf8' }).trim();
          if (res && fs.existsSync(res)) return res;
        } catch {
          // not found
        }
      }
    }

    return null;
  }

  /**
   * Quick check if HTTP port is responding
   */
  public async isPortListening(host: string, port: number, timeoutMs = 800): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.request(
        {
          host,
          port,
          path: '/',
          method: 'GET',
          timeout: timeoutMs,
        },
        () => resolve(true)
      );

      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.on('error', () => resolve(false));
      req.end();
    });
  }

  /**
   * Get live status of the embedded IDE server
   */
  public async getStatus(): Promise<IdeServerStatus> {
    const settings = this.getSettings();
    const binary = this.findBinary(settings.binaryPath);
    const host = settings.host || '127.0.0.1';
    const port = settings.port || 8443;

    // Check if our own child process is running or if port is actively responding
    let isRunning = Boolean(this.activeProcess && !this.activeProcess.killed);
    if (!isRunning) {
      const listening = await this.isPortListening(host, port, 600);
      if (listening) {
        isRunning = true;
      }
    }

    const baseBaseUrl = settings.externalUrl || `http://${host}:${port}`;
    const url = isRunning
      ? this.activeFolder
        ? `${baseBaseUrl}/?folder=${encodeURIComponent(this.activeFolder)}`
        : baseBaseUrl
      : undefined;

    return {
      installed: Boolean(binary),
      running: isRunning,
      binaryPath: binary || undefined,
      port,
      host,
      url,
      pid: this.activePid,
      error: this.lastError,
    };
  }

  /**
   * Build an open-in-browser / iframe URL for a specific project
   */
  public getUrlForFolder(folderPath: string): string {
    const settings = this.getSettings();
    const host = settings.host || '127.0.0.1';
    const port = settings.port || 8443;
    const base = settings.externalUrl || `http://${host}:${port}`;
    return `${base}/?folder=${encodeURIComponent(folderPath)}`;
  }

  /**
   * Start IDE server for a specific project or folder
   */
  public async startServer(options?: { projectName?: string; folderPath?: string; port?: number }): Promise<IdeServerStatus> {
    const settings = this.getSettings();
    const binary = this.findBinary(settings.binaryPath);
    const host = settings.host || '127.0.0.1';
    const port = options?.port || settings.port || 8443;

    let targetFolder = options?.folderPath;
    if (!targetFolder && options?.projectName) {
      const proj = this.projectService.getProject(options.projectName);
      if (proj && proj.repo_path) {
        targetFolder = proj.repo_path;
      }
    }
    if (!targetFolder) {
      targetFolder = process.cwd();
    }
    this.activeFolder = targetFolder;

    // If port is already listening, we don't need to re-spawn
    const alreadyListening = await this.isPortListening(host, port, 600);
    if (alreadyListening) {
      return this.getStatus();
    }

    if (!binary) {
      this.lastError = 'Web IDE binary (code-server / openvscode-server) is not installed on this machine.';
      return this.getStatus();
    }

    // Determine CLI arguments based on binary name
    const binName = path.basename(binary).toLowerCase();
    let args: string[] = [];

    if (binName.includes('code-server')) {
      args = [
        '--bind-addr',
        `${host}:${port}`,
        '--auth',
        'none',
        '--disable-telemetry',
        targetFolder,
      ];
    } else if (binName.includes('openvscode')) {
      args = [
        '--host',
        host,
        '--port',
        String(port),
        '--without-connection-token',
        targetFolder,
      ];
    } else if (binName === 'code') {
      args = [
        'serve-web',
        '--host',
        host,
        '--port',
        String(port),
        '--without-connection-token',
      ];
    } else {
      args = ['--bind-addr', `${host}:${port}`, '--auth', 'none', targetFolder];
    }

    try {
      this.lastError = undefined;
      const child = spawn(binary, args, {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.activeProcess = child;
      this.activePid = child.pid;

      child.stderr?.on('data', (data) => {
        const msg = data.toString();
        // Ignore normal info logs in stderr
        if (msg.toLowerCase().includes('error') || msg.toLowerCase().includes('fatal')) {
          this.lastError = msg.trim();
        }
      });

      child.on('error', (err) => {
        this.lastError = err.message;
        this.activeProcess = null;
        this.activePid = undefined;
      });

      child.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          this.lastError = `IDE process exited with code ${code}`;
        }
        this.activeProcess = null;
        this.activePid = undefined;
      });

      // Poll until port opens (up to 4 seconds)
      const start = Date.now();
      while (Date.now() - start < 4000) {
        await new Promise((r) => setTimeout(r, 400));
        const listening = await this.isPortListening(host, port, 400);
        if (listening) break;
      }
    } catch (err: any) {
      this.lastError = err.message;
    }

    return this.getStatus();
  }

  /**
   * Stop active IDE server
   */
  public async stopServer(): Promise<IdeServerStatus> {
    if (this.activeProcess) {
      try {
        this.activeProcess.kill('SIGTERM');
      } catch {
        // ignore
      }
      this.activeProcess = null;
      this.activePid = undefined;
    }
    this.activeFolder = undefined;
    return this.getStatus();
  }
}
