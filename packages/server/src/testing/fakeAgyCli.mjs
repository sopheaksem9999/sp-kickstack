#!/usr/bin/env node
// Test stand-in for `agy mcp list|add|remove`. The list lives in $FAKE_AGY_STATE (JSON); each call is
// appended to $FAKE_AGY_LOG. $FAKE_AGY_FAIL makes every call fail with that message.
import fs from 'node:fs';

const [cmd, sub, ...rest] = process.argv.slice(2);
const statePath = process.env.FAKE_AGY_STATE;
const state = statePath && fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : [];
if (process.env.FAKE_AGY_LOG) fs.appendFileSync(process.env.FAKE_AGY_LOG, `${JSON.stringify(process.argv.slice(2))}\n`);
if (process.env.FAKE_AGY_FAIL) {
  process.stderr.write(`${process.env.FAKE_AGY_FAIL}\n`);
  process.exit(1);
}
const save = (list) => fs.writeFileSync(statePath, JSON.stringify(list));
if (cmd !== 'mcp') process.exit(2);
if (sub === 'list') {
  console.log('NAME                        TYPE   STATUS   COMMAND/URL');
  for (const s of state) console.log(`${s.name.padEnd(28)}${s.type.padEnd(7)}enabled  ${s.target}`);
} else if (sub === 'add') {
  let i = 0;
  while (rest[i]?.startsWith('--') && rest[i] !== '--') i += 2;
  const name = rest[i];
  const after = rest.slice(i + 1).filter((a) => a !== '--');
  save(state.filter((s) => s.name !== name).concat([{ name, type: /^https?:/.test(after[0] ?? '') ? 'http' : 'stdio', target: after.join(' ') }]));
} else if (sub === 'remove') {
  save(state.filter((s) => s.name !== rest[0]));
} else {
  process.exit(2);
}
