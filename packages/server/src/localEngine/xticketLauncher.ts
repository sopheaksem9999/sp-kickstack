// Agents call `xticket ask` / `xticket create` from their worktree. The runner puts this launcher
// first on their PATH; it runs the xticket CLI with the same Node that runs the server.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** XTICKET_CLI, then the desktop bundle (xticket.mjs next to the server), then the workspace build. */
export function xticketCandidates(): string[] {
  return [process.env.XTICKET_CLI ?? '', path.join(here, 'xticket.mjs'), path.resolve(here, '../../../xticket/dist/cli.js')].filter(Boolean);
}

export function findXticketScript(candidates: string[] = xticketCandidates()): string | null {
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

/** Write `xticket` (and `xticket.cmd` for Windows) into `binDir`; returns `binDir`. */
export function writeXticketLauncher(binDir: string, nodePath: string, script: string | null): string {
  fs.mkdirSync(binDir, { recursive: true });
  const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const missing = 'xticket is not available: run npm run build in SP-Kickstack';
  const shell = script
    ? `#!/bin/sh\nexec ${quote(nodePath)} ${quote(script)} "$@"\n`
    : `#!/bin/sh\necho "${missing}" >&2\nexit 1\n`;
  const launcher = path.join(binDir, 'xticket');
  fs.writeFileSync(launcher, shell);
  fs.chmodSync(launcher, 0o755);
  const cmd = script ? `@"${nodePath}" "${script}" %*\r\n` : `@echo ${missing} 1>&2\r\n@exit /b 1\r\n`;
  fs.writeFileSync(path.join(binDir, 'xticket.cmd'), cmd);
  return binDir;
}
