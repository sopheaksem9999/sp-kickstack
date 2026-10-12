import { ChildProcess, spawn, execFile, execFileSync } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DetectedIde, IdeServerStatus, IdeSettings, IdeSettingsSchema } from '@sp-kickstack/shared';
import { SettingsService } from './settingsService.js';
import { ProjectService } from './projectService.js';

export interface KnownIdeDef {
  id: string;
  name: string;
  macApps: string[];
  winPaths?: string[];
  linuxBins?: string[];
  commands: string[];
}

export const KNOWN_IDES: KnownIdeDef[] = [
  {
    id: 'antigravity',
    name: 'Antigravity IDE',
    macApps: ['Antigravity IDE.app', 'Antigravity.app'],
    commands: ['antigravity', 'agy'],
  },
  {
    id: 'vscode',
    name: 'VS Code',
    macApps: ['Visual Studio Code.app', 'Visual Studio Code - Insiders.app'],
    winPaths: [
      path.join(process.env.LOCALAPPDATA || '', 'Programs/Microsoft VS Code/Code.exe'),
      'C:\\Program Files\\Microsoft VS Code\\Code.exe',
    ],
    linuxBins: ['/usr/bin/code', '/snap/bin/code'],
    commands: ['code', 'code-insiders'],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    macApps: ['Cursor.app'],
    winPaths: [
      path.join(process.env.LOCALAPPDATA || '', 'Programs/Cursor/Cursor.exe'),
    ],
    linuxBins: ['/usr/bin/cursor', '/snap/bin/cursor'],
    commands: ['cursor'],
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    macApps: ['Windsurf.app'],
    winPaths: [
      path.join(process.env.LOCALAPPDATA || '', 'Programs/Windsurf/Windsurf.exe'),
    ],
    linuxBins: ['/usr/bin/windsurf'],
    commands: ['windsurf'],
  },
  {
    id: 'trae',
    name: 'Trae',
    macApps: ['Trae.app'],
    commands: ['trae'],
  },
  {
    id: 'zed',
    name: 'Zed',
    macApps: ['Zed.app', 'Zed Preview.app'],
    linuxBins: ['/usr/bin/zed'],
    commands: ['zed'],
  },
  {
    id: 'android-studio',
    name: 'Android Studio',
    macApps: ['Android Studio.app'],
    commands: ['studio'],
  },
  {
    id: 'xcode',
    name: 'Xcode',
    macApps: ['Xcode.app'],
    commands: ['xcode'],
  },
  {
    id: 'intellij',
    name: 'IntelliJ IDEA',
    macApps: [
      'IntelliJ IDEA.app',
      'IntelliJ IDEA Ultimate.app',
      'IntelliJ IDEA Community Edition.app',
      'IntelliJ IDEA CE.app',
    ],
    commands: ['idea'],
  },
  {
    id: 'webstorm',
    name: 'WebStorm',
    macApps: ['WebStorm.app'],
    commands: ['webstorm'],
  },
  {
    id: 'pycharm',
    name: 'PyCharm',
    macApps: ['PyCharm.app', 'PyCharm CE.app', 'PyCharm Community Edition.app'],
    commands: ['pycharm'],
  },
  {
    id: 'sublime',
    name: 'Sublime Text',
    macApps: ['Sublime Text.app', 'Sublime Text 3.app', 'Sublime Text 4.app'],
    commands: ['subl'],
  },
];

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
          const res = execFileSync('which', [bin], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
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

  /**
   * Detect installed IDEs on the host PC
   */
  public detectInstalledIdes(): DetectedIde[] {
    const detected: DetectedIde[] = [];
    const settings = this.getSettings();
    const appDirs = process.platform === 'darwin'
      ? ['/Applications', '/System/Applications', path.join(os.homedir(), 'Applications')]
      : [];

    const checkCommand = (cmd: string): string | null => {
      try {
        const whichTool = process.platform === 'win32' ? 'where' : 'which';
        const res = execFileSync(whichTool, [cmd], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim().split('\n')[0];
        if (res && fs.existsSync(res)) return res;
      } catch {}
      return null;
    };

    for (const cand of KNOWN_IDES) {
      let foundAppPath: string | undefined;
      let foundCommand: string | undefined;

      // 1. Check macOS application bundles
      if (process.platform === 'darwin') {
        for (const dir of appDirs) {
          for (const app of cand.macApps) {
            const full = path.join(dir, app);
            try {
              if (fs.existsSync(full)) {
                foundAppPath = full;
                break;
              }
            } catch {}
          }
          if (foundAppPath) break;
        }
      }

      // 2. Check Windows fixed paths
      if (process.platform === 'win32' && cand.winPaths) {
        for (const p of cand.winPaths) {
          if (p && fs.existsSync(p)) {
            foundAppPath = p;
            break;
          }
        }
      }

      // 3. Check Linux fixed binaries
      if (process.platform === 'linux' && cand.linuxBins) {
        for (const bin of cand.linuxBins) {
          if (fs.existsSync(bin)) {
            foundCommand = bin;
            break;
          }
        }
      }

      // 4. Check CLI commands
      for (const cmd of cand.commands) {
        const cmdPath = checkCommand(cmd);
        if (cmdPath) {
          foundCommand = cmdPath;
          break;
        }
      }

      if (foundAppPath || foundCommand) {
        detected.push({
          id: cand.id,
          name: cand.name,
          appPath: foundAppPath,
          command: foundCommand || cand.commands[0],
        });
      }
    }

    // Set isDefault flag
    const preferredId = settings.preferredIde;
    let hasDefault = false;

    for (const ide of detected) {
      if (preferredId && ide.id === preferredId) {
        ide.isDefault = true;
        hasDefault = true;
      }
    }

    if (!hasDefault && detected.length > 0) {
      detected[0].isDefault = true;
    }

    return detected;
  }

  /**
   * Launch a project folder in an installed IDE on the host PC
   */
  public async openProjectInIde(
    projectNameOrPath: string,
    ideId?: string
  ): Promise<{ ok: boolean; ide: DetectedIde; path: string }> {
    let targetPath = projectNameOrPath;
    const proj = this.projectService.getProject(projectNameOrPath);
    if (proj && proj.repo_path) {
      targetPath = proj.repo_path;
    }

    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) {
      throw new Error(`Directory path does not exist: ${targetPath}`);
    }

    const detected = this.detectInstalledIdes();
    const settings = this.getSettings();

    let targetIde: DetectedIde | undefined;
    if (ideId) {
      targetIde = detected.find((d) => d.id === ideId);
      if (!targetIde) {
        const known = KNOWN_IDES.find((k) => k.id === ideId);
        if (known) {
          targetIde = {
            id: known.id,
            name: known.name,
            command: known.commands[0],
          };
        }
      }
    } else if (settings.preferredIde) {
      targetIde = detected.find((d) => d.id === settings.preferredIde);
    }

    if (!targetIde && detected.length > 0) {
      targetIde = detected[0];
    }

    if (!targetIde) {
      targetIde = {
        id: 'vscode',
        name: 'VS Code',
        command: 'code',
      };
    }

    await new Promise<void>((resolve, reject) => {
      if (process.platform === 'darwin') {
        if (targetIde?.appPath) {
          execFile('open', ['-a', targetIde.appPath, targetPath], (err) => {
            if (err) return reject(err);
            resolve();
          });
        } else {
          execFile(targetIde?.command || 'code', [targetPath], (err) => {
            if (err) {
              execFile('open', ['-a', targetIde?.name || 'Visual Studio Code', targetPath], (openErr) => {
                if (openErr) return reject(openErr);
                resolve();
              });
            } else {
              resolve();
            }
          });
        }
      } else if (process.platform === 'win32') {
        const cmd = targetIde?.appPath || targetIde?.command || 'code';
        execFile(cmd, [targetPath], { shell: true }, (err) => {
          if (err) return reject(err);
          resolve();
        });
      } else {
        const cmd = targetIde?.command || 'code';
        execFile(cmd, [targetPath], (err) => {
          if (err) return reject(err);
          resolve();
        });
      }
    });

    return {
      ok: true,
      ide: targetIde,
      path: targetPath,
    };
  }
}
