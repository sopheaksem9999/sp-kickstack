#!/usr/bin/env node
import { spawn } from 'node:child_process';

const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  dim: '\x1b[2m',
};

function startProcess(name, command, args, color) {
  const prefix = `${color}[${name}]${colors.reset} `;
  console.log(`${prefix}Starting ${command} ${args.join(' ')}...`);

  const proc = spawn(command, args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true,
  });

  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        console.log(`${prefix}${line}`);
      }
    }
  });

  proc.stderr.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        console.error(`${prefix}${line}`);
      }
    }
  });

  proc.on('close', (code) => {
    if (code !== 0 && code !== null) {
      console.log(`${prefix}${colors.red}Process exited with code ${code}${colors.reset}`);
    }
  });

  return proc;
}

console.log(`${colors.yellow}====================================================${colors.reset}`);
console.log(`${colors.yellow}  🚀 Starting SP Kickstack DevFlow (Server + Web)    ${colors.reset}`);
console.log(`${colors.yellow}====================================================${colors.reset}`);

const serverProc = startProcess(
  'server',
  'npm',
  ['run', '--workspace=@sp-kickstack/server', 'dev'],
  colors.magenta
);

const webProc = startProcess(
  'web',
  'npm',
  ['run', '--workspace=@sp-kickstack/web', 'dev'],
  colors.cyan
);

function cleanup() {
  console.log(`\n${colors.yellow}Shutting down dev processes...${colors.reset}`);
  serverProc.kill('SIGTERM');
  webProc.kill('SIGTERM');
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
