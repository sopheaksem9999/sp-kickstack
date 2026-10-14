#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const rootPkgPath = path.join(rootDir, 'package.json');
const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
const currentVersion = rootPkg.version;

const arg = process.argv[2]?.trim();

function getNextVersion(current, typeOrVersion) {
  if (!typeOrVersion) return null;

  // Exact semver provided
  if (/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(typeOrVersion)) {
    return typeOrVersion;
  }

  const parts = current.split('.').map(Number);
  if (parts.length < 3 || parts.some(isNaN)) {
    throw new Error(`Current version "${current}" is not valid standard semver (major.minor.patch)`);
  }

  const [major, minor, patch] = parts;
  switch (typeOrVersion.toLowerCase()) {
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'major':
      return `${major + 1}.0.0`;
    default:
      return null;
  }
}

const targetVersion = getNextVersion(currentVersion, arg);

if (!targetVersion) {
  console.log(`\n📌 Current SP-Kickstack version: ${currentVersion}\n`);
  console.log('Usage:');
  console.log('  npm run version:bump <patch|minor|major|x.y.z>');
  console.log('  npm run bump <patch|minor|major|x.y.z>\n');
  console.log('Examples:');
  console.log('  npm run bump patch   (-> increments patch e.g. 0.2.1 -> 0.2.2)');
  console.log('  npm run bump minor   (-> increments minor e.g. 0.2.1 -> 0.3.0)');
  console.log('  npm run bump major   (-> increments major e.g. 0.2.1 -> 1.0.0)');
  console.log('  npm run bump 0.2.5   (-> sets exact version 0.2.5)\n');
  process.exit(1);
}

if (targetVersion === currentVersion) {
  console.log(`ℹ️ Version is already ${currentVersion}. Nothing to update.`);
  process.exit(0);
}

console.log(`\n🚀 Bumping SP-Kickstack version: ${currentVersion} → ${targetVersion}\n`);

// 1. JSON package files to update
const jsonFiles = [
  'package.json',
  'packages/shared/package.json',
  'packages/server/package.json',
  'packages/web/package.json',
  'packages/desktop/package.json',
  'packages/xticket/package.json',
  'packages/desktop/src-tauri/tauri.conf.json',
];

for (const rel of jsonFiles) {
  const filePath = path.join(rootDir, rel);
  if (!fs.existsSync(filePath)) continue;

  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  parsed.version = targetVersion;
  fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  console.log(`  ✓ Updated ${rel}`);
}

// 2. packages/desktop/src-tauri/Cargo.toml
const cargoPath = path.join(rootDir, 'packages', 'desktop', 'src-tauri', 'Cargo.toml');
if (fs.existsSync(cargoPath)) {
  let cargo = fs.readFileSync(cargoPath, 'utf8');
  cargo = cargo.replace(
    /^version\s*=\s*"[^"]+"/m,
    `version = "${targetVersion}"`
  );
  fs.writeFileSync(cargoPath, cargo, 'utf8');
  console.log('  ✓ Updated packages/desktop/src-tauri/Cargo.toml');
}

// 3. packages/shared/src/version.ts
const versionTsPath = path.join(rootDir, 'packages', 'shared', 'src', 'version.ts');
fs.writeFileSync(
  versionTsPath,
  `export const APP_VERSION = '${targetVersion}';\n`,
  'utf8'
);
console.log('  ✓ Updated packages/shared/src/version.ts');

console.log(`\n🎉 Successfully bumped all project files to version ${targetVersion}!\n`);
