//  node call.mjs <tool> [json-args | @file.json]
//  Calls one tool of server.mjs over stdio - the same code path Claude Code
//  uses through MCP, for when the server is not loaded in a session.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , name, raw = '{}'] = process.argv;
if (!name) { console.error('usage: node call.mjs <tool> [json | @file.json]'); process.exit(2); }
const args = JSON.parse(raw.startsWith('@') ? fs.readFileSync(raw.slice(1), 'utf8') : raw);

const here = path.dirname(fileURLToPath(import.meta.url));
const c = new Client({ name: 'call', version: '1' });
await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(here, 'server.mjs')] }));
const r = await c.callTool({ name, arguments: args }, undefined, { timeout: 20 * 60 * 1000 });
console.log(r.content.map(x => x.text).join('\n'));
await c.close();
process.exit(r.isError ? 1 : 0);
