#!/usr/bin/env node
// Test stand-in for an MCP server over stdio (JSON-RPC, one message per line).
// Tools: echo(text), add(a, b). Flags: --crash (exit 3 at once), --hang (never answer),
// --tools=N (offer tool1…toolN instead), --require-env=NAME (exit 4 when that variable is missing).
import readline from 'node:readline';

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`${name}=`))?.split('=')[1];
if (args.includes('--crash')) process.exit(3);
const needed = flag('--require-env');
if (needed && !process.env[needed]) {
  process.stderr.write(`missing ${needed}\n`);
  process.exit(4);
}
const hang = args.includes('--hang');
const count = Number(flag('--tools') || 0);
const tools = count
  ? Array.from({ length: count }, (_, i) => ({ name: `tool${i + 1}`, description: `Tool ${i + 1}`, inputSchema: { type: 'object', properties: {} } }))
  : [
      { name: 'echo', description: 'Returns the text it gets', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
      { name: 'add', description: 'Adds two numbers', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } },
    ];
const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (hang) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id === undefined) return;
  if (msg.method === 'initialize') {
    return send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: msg.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake-mcp', version: '1.0.0' } } });
  }
  if (msg.method === 'tools/list') return send({ jsonrpc: '2.0', id: msg.id, result: { tools } });
  if (msg.method === 'tools/call') {
    const { name, arguments: a = {} } = msg.params ?? {};
    const text = name === 'echo' ? String(a.text ?? '') : name === 'add' ? String(Number(a.a) + Number(a.b)) : `called ${name}`;
    return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text }] } });
  }
  send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Unknown method ${msg.method}` } });
});
