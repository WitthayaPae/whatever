// Append exchange lines to a v8 .npcex (2026-10-26).
//   node add_npcex_lines.js <rcc-extract dir> <file.npcex> "<line>" ["<line>" ...]
// Each line is a full NPC_EXCHANGE_ITEM=... entry. Its [id] must be new. Every existing
// line is kept byte for byte; the result is read back before it is written.
const fs = require('fs');
const [, , T, F, ...ADD] = process.argv;
const g = require(T + '/gamecrypt.js');
const { enc874, encodeV8 } = require('./strtab.js');
const th = new TextDecoder('windows-874');

const raw = fs.readFileSync(F);
let txt = th.decode(g.decode(raw)).replace(/[ \0]+$/, '');
if (!txt.endsWith('\r\n')) txt += '\r\n';
const idOf = (l) => (l.match(/^NPC_EXCHANGE_ITEM=\[(\d+)\]/) || [])[1];
const have = new Set(txt.split('\r\n').map(idOf).filter(Boolean));
for (const l of ADD) {
  const id = idOf(l);
  if (!id) throw new Error('not an exchange line: ' + l);
  if (have.has(id)) throw new Error('id exists: ' + id);
  have.add(id);
}
const out = txt + ADD.join('\r\n') + '\r\n';
const buf = encodeV8(g, enc874(out));
const back = th.decode(g.decode(buf)).replace(/ +$/, '');
if (back !== out) throw new Error('round trip');
if (!back.startsWith(txt)) throw new Error('existing lines changed');
fs.writeFileSync(F, buf);
console.log(F, 'lines now:', back.split('\r\n').filter(idOf).length);
