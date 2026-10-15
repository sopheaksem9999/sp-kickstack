import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const serverSrc = path.join(rootDir, 'packages', 'server', 'src', 'index.ts');
const outDir = path.join(rootDir, 'packages', 'desktop', 'src-tauri', 'resources', 'server');

console.log('📦 Bundling standalone server for desktop distribution...');

fs.mkdirSync(outDir, { recursive: true });

// 1. Bundle TypeScript server into a single ESM file
await esbuild.build({
  entryPoints: [serverSrc],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: path.join(outDir, 'index.mjs'),
  external: ['better-sqlite3'],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  sourcemap: false,
  minify: false,
});

console.log('✅ Server JavaScript bundle created at resources/server/index.mjs');

// Local AI CLI agents call xticket; the server finds it next to index.mjs (see localEngine/xticketLauncher.ts).
await esbuild.build({
  entryPoints: [path.join(rootDir, 'packages', 'xticket', 'src', 'cli.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: path.join(outDir, 'xticket.mjs'),
  sourcemap: false,
  minify: false,
});

console.log('✅ xticket CLI bundle created at resources/server/xticket.mjs');

// 2. Prepare node_modules in resources/server with native better-sqlite3
const targetNodeModules = path.join(outDir, 'node_modules');
fs.mkdirSync(targetNodeModules, { recursive: true });

const modulesToCopy = ['better-sqlite3', 'bindings', 'file-uri-to-path'];

for (const mod of modulesToCopy) {
  // Check root node_modules or server node_modules
  const candidates = [
    path.join(rootDir, 'node_modules', mod),
    path.join(rootDir, 'packages', 'server', 'node_modules', mod),
  ];
  let srcMod = null;
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      srcMod = c;
      break;
    }
  }

  if (srcMod) {
    const destMod = path.join(targetNodeModules, mod);
    fs.cpSync(srcMod, destMod, { recursive: true, dereference: true });
    console.log(`✅ Copied module dependency: ${mod}`);
  } else {
    console.warn(`⚠️ Warning: Module ${mod} not found in node_modules`);
  }
}

// Clean unneeded C/C++ source, benchmark, and intermediate build files from better-sqlite3
const bsqDir = path.join(targetNodeModules, 'better-sqlite3');
if (fs.existsSync(bsqDir)) {
  const unneeded = ['deps', 'src', 'benchmark', 'test', 'docs'];
  for (const dir of unneeded) {
    const p = path.join(bsqDir, dir);
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  }
  const buildDir = path.join(bsqDir, 'build');
  if (fs.existsSync(buildDir)) {
    const releaseDir = path.join(buildDir, 'Release');
    if (fs.existsSync(releaseDir)) {
      for (const e of fs.readdirSync(releaseDir)) {
        if (e !== 'better_sqlite3.node') {
          fs.rmSync(path.join(releaseDir, e), { recursive: true, force: true });
        }
      }
    }
    for (const e of fs.readdirSync(buildDir)) {
      if (e !== 'Release') {
        fs.rmSync(path.join(buildDir, e), { recursive: true, force: true });
      }
    }
  }
}
const futpDir = path.join(targetNodeModules, 'file-uri-to-path');
if (fs.existsSync(futpDir)) {
  const testDir = path.join(futpDir, 'test');
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
}

// 3. Write package.json
fs.writeFileSync(
  path.join(outDir, 'package.json'),
  JSON.stringify({ name: 'sp-kickstack-desktop-server', type: 'module', main: 'index.mjs' }, null, 2)
);

// 4. Bundle standalone Node binary into resources/bin for full self-contained standalone desktop distribution
const binDir = path.join(rootDir, 'packages', 'desktop', 'src-tauri', 'resources', 'bin');
fs.mkdirSync(binDir, { recursive: true });

const nodeTargetName = process.platform === 'win32' ? 'node.exe' : 'node';
const destNode = path.join(binDir, nodeTargetName);

try {
  fs.copyFileSync(process.execPath, destNode);
  if (process.platform !== 'win32') {
    fs.chmodSync(destNode, 0o755);
  }
  console.log(`✅ Bundled standalone Node binary (${process.version}) to resources/bin/${nodeTargetName}`);
} catch (err) {
  console.warn(`⚠️ Warning: Could not copy standalone Node binary: ${err.message}`);
}

console.log('🚀 Desktop standalone server bundle complete!');

