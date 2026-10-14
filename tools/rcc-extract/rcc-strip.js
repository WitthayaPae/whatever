'use strict';
//
// RCC archive cleaner - rebuild an archive without the entries a folder-wide
// repack swept in by mistake: backups named *.bak_pre_<what>, *.bak-<what> and
// *.classic_<date>.
//
//   node rcc-strip.js <in.rcc> <out.rcc>
//
// Why it exists (2026-10-15): a pack made from the whole glogic/ folder took in
// the .bak files beside the sources - four whole old GLogic.rcc copies inside
// the new GLogic.rcc (12 MB -> 60 MB), three old NpcTalk.rcc inside NpcTalk.rcc
// - and the patch would have sent all of it to every player.
//
// Every kept entry is re-encrypted from its plain bytes the way rcc-pack.js
// does, and the result is read back and compared entry by entry before it is
// written. Nothing is written if anything differs.
//
const fs = require('fs');
const { RccArchive, encrypt } = require('./rcc.js');
const { buildZip } = require('./rcc-pack.js');

const JUNK = /\.(bak_pre_[\w-]+|bak-[\w-]+|classic_\d{4}-\d{2}-\d{2})$/i;

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: node rcc-strip.js <in.rcc> <out.rcc>');
  process.exit(2);
}

const src = new RccArchive(inPath);
const items = [];
const dropped = [];
for (const name of src.list()) {
  if (JUNK.test(name)) { dropped.push(name); continue; }
  const plain = src.read(name);
  items.push({ name, data: encrypt(Buffer.from(plain)), plain });
}

const out = buildZip(items);
const tmp = outPath + '.verify';
fs.writeFileSync(tmp, out);
let bad = 0;
try {
  const back = new RccArchive(tmp);
  if (back.list().length !== items.length) { console.error('entry count differs'); bad++; }
  for (const it of items) if (!back.read(it.name).equals(it.plain)) { console.error('MISMATCH ' + it.name); bad++; }
} finally {
  fs.unlinkSync(tmp);
}
if (bad) { console.error(bad + ' problem(s) - not written'); process.exit(1); }
fs.writeFileSync(outPath, out);
console.log(`${outPath}: kept ${items.length}, dropped ${dropped.length}${dropped.length ? ' (' + dropped.join(', ') + ')' : ''}, ` +
            `${(fs.statSync(inPath).size / 1048576).toFixed(1)} MB -> ${(out.length / 1048576).toFixed(1)} MB, verified`);
