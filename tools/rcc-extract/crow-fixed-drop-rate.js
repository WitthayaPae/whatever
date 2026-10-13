'use strict';
//
// `crow-fixed-drop-rate.js` — lower the fixed upgrade-stone drop that 76 mobs
// carry on themselves (SCROWGEN::m_sGenItemID / m_wGenItem_Rate in crow.mnsf).
//
//   node crow-fixed-drop-rate.js <CLIENT/data dir> <work dir> [--write]
//
// The mobs (group 58 "Bandit Leader", "Notorious Junkie" ... and a few others)
// drop Red Gem (11/4) or Fine Polish (11/6) at 5, 10 or 20 % a kill, which next
// to the classic drop tables (a stone in about 500 kills) is the one farm spot
// left. The user asked for a tenth.
//
// m_wGenItem_Rate is a WORD of whole per cent (GLCrowGenerateReward.cpp:293),
// so a tenth of 5 cannot be written: 5 -> 1, 10 -> 1, 20 -> 2.
//
// Nothing is re-serialised. The record is located with crowdata.js and the two
// bytes of the WORD are replaced in place, in the file's own byte cipher, so
// every other byte of crow.mnsf stays what it was. The result is parsed again
// and compared field by field before anything is written.
//
const fs = require('fs');
const path = require('path');
const { RccArchive } = require('./rcc.js');
const bytecrypt = require('./bytecrypt.js');
const crowdata = require('./crowdata.js');

const args = process.argv.slice(2);
const write = args.includes('--write');
const [dataDir, workDir] = args.filter((a) => !a.startsWith('--'));
if (!dataDir || !workDir) { console.error('usage: node crow-fixed-drop-rate.js <CLIENT/data> <work dir> [--write]'); process.exit(2); }

const STONES = new Set([(4 << 16 | 11) >>> 0, (6 << 16 | 11) >>> 0]);   // dwID: sub in the high word
const NEW_RATE = { 5: 1, 10: 1, 20: 2 };

const rccPath = path.join(dataDir, 'glogic', 'GLogic.rcc');
const arc = new RccArchive(rccPath);
const entry = arc.list().find((n) => n.toLowerCase() === 'crow.mnsf');
const raw = arc.read(entry);
const before = crowdata.parse(raw);
if (!before.eofExact) throw new Error('crow.mnsf does not parse to its last byte');
if (before.fileVer < 0x0200) throw new Error('crow.mnsf is not in the byte cipher this tool writes');

const out = Buffer.from(raw);
const rows = [];
for (const c of before.crows) {
  const g = c.gen;
  if (!g || !STONES.has(g.itemId) || !(g.itemRate in NEW_RATE)) continue;
  const to = NEW_RATE[g.itemRate];
  // the WORD, little-endian, through the same substitution the file body uses
  const w = Buffer.alloc(2); w.writeUInt16LE(to, 0);
  bytecrypt.encode(w, crowdata.CROW_TABLE, 0, 2);
  w.copy(out, g.at);
  rows.push([`${c.main}/${c.sub}`, c.nameKey, c.level, c.hp, (g.itemId >>> 16) === 4 ? 'Red Gem' : 'Fine Polish', g.itemRate, to]);
}

// verify: same records, and only the rate differs, only where intended
const after = crowdata.parse(out);
if (!after.eofExact || after.count !== before.count) throw new Error('patched file does not parse the same');
let changed = 0;
for (let i = 0; i < before.count; i++) {
  const a = before.crows[i], b = after.crows[i];
  const strip = (x) => JSON.stringify({ ...x, gen: x.gen && { ...x.gen, itemRate: 0 } });
  if (strip(a) !== strip(b)) throw new Error(`record ${a.main}/${a.sub}: something other than the rate changed`);
  if ((a.gen && a.gen.itemRate) !== (b.gen && b.gen.itemRate)) changed++;
}
let diff = 0; for (let i = 0; i < raw.length; i++) if (raw[i] !== out[i]) diff++;
if (changed !== rows.length) throw new Error(`changed ${changed} records, meant ${rows.length}`);

fs.mkdirSync(workDir, { recursive: true });
fs.writeFileSync(path.join(workDir, 'fixed_drop_changes.csv'), [['mob', 'name key', 'level', 'HP', 'item', '% before', '% after'], ...rows].map((r) => r.join(',')).join('\r\n') + '\r\n');
console.log(`mobs changed ${rows.length}, bytes different ${diff} of ${raw.length}, records verified ${before.count}`);

if (write) {
  const file = path.join(workDir, 'crow.mnsf');
  fs.writeFileSync(file, out);
  const packed = path.join(workDir, 'GLogic.rcc');
  const log = console.log; console.log = () => {};
  try { require('./rcc-pack.js').pack(rccPath, packed, [[entry, file]]); } finally { console.log = log; }
  console.log('packed', packed);
}
