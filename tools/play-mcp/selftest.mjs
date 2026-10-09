//  node selftest.mjs - starts server.mjs over stdio, lists its tools and calls
//  play_status (which reports a missing key or the app's state).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const t = new StdioClientTransport({ command: process.execPath, args: [path.join(here, 'server.mjs')] });
const c = new Client({ name: 'selftest', version: '1' });
await c.connect(t);
const { tools } = await c.listTools();
console.log(`${tools.length} tools: ${tools.map(x => x.name).join(' ')}`);
const r = await c.callTool({ name: 'play_status', arguments: {} });
console.log(r.isError ? 'play_status error:' : 'play_status:', r.content[0].text.slice(0, 2000));
await c.close();
