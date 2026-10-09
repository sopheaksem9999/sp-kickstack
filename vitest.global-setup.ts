import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// better-sqlite3 is a native module compiled for the Node major in .nvmrc.
// Running tests on another major fails with an opaque NODE_MODULE_VERSION error,
// so fail fast with an actionable message instead.
export default function checkNodeVersion() {
  const nvmrcPath = fileURLToPath(new URL('./.nvmrc', import.meta.url));
  const expected = fs.readFileSync(nvmrcPath, 'utf-8').trim().replace(/^v/, '');
  const expectedMajor = expected.split('.')[0];
  const actualMajor = process.versions.node.split('.')[0];

  if (actualMajor !== expectedMajor) {
    throw new Error(
      `Node ${process.versions.node} detected, but this repo needs Node ${expected} (.nvmrc). ` +
        `better-sqlite3 is compiled for Node ${expectedMajor}. Run \`nvm use\` and retry.`
    );
  }
}
