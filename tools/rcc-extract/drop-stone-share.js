'use strict';
//
// `drop-stone-share.js` — raise the upgrade-stone share of the normal level
// tables (lv*.genitem) and take the same amount from their potion line.
//
//   node drop-stone-share.js <CLIENT/data dir> <work dir> <share %> [--write]
//                            [--add=lv02.genitem,lv75S.genitem,...]
//
// The stone line is ITEMSPEC 191 (Rust Scrub Brush, Polish, Red Gem, Fine
// Polish). A table whose stone line is already at or above the share is left
// alone; so is a table with no stone line, unless it is named in --add: then
// the line is added (after the potion line) at the share. The potion line is the table's
// largest ITEMSPEC whose items are all potions (type CURE); the table's entry
// total does not change, so nothing else in it moves.
//
// Note (GLCrowData.cpp SGENITEM::SELECTSPECID): an entry under 2% is scaled by
// fITEM_DROP_LOWER_SCALE x the killer's drop rate; an entry of 2% or more is
// not. So a stone line at 2% is not cut by the 0.7 low-rate scale, and is also
// not raised by a player's drop-rate bonus.
//
// Without --write it only reports. With it, the changed tables are packed into
// <work dir>/GLogicServer.rcc; the archive in the data dir is not replaced.
//
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { RccArchive } = require('./rcc.js');
const gamecrypt = require('./gamecrypt.js');

const args = process.argv.slice(2);
const write = args.includes('--write');
const addArg = args.find((a) => a.startsWith('--add='));
const ADD = new Set(addArg ? addArg.slice(6).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean) : []);
const [dataDir, workDir, shareArg] = args.filter((a) => !a.startsWith('--'));
const SHARE = parseFloat(shareArg);
if (!dataDir || !workDir || !(SHARE > 0)) { console.error('usage: node drop-stone-share.js <CLIENT/data> <work dir> <share %> [--write]'); process.exit(2); }
const STONE = 191, CURE = 2;

const plain = (b) => (gamecrypt.isEncoded(b) ? gamecrypt.decode(b) : b);
const num = (v) => { const x = parseFloat(v); return isFinite(x) ? x : 0; };
const tokens = (line) => line.split('//')[0].trim().split(/[\s,{}\[\]()|]+/).filter((x) => x !== '');
const fmt = (v) => String(+v.toFixed(4));

function encode(text) {
  let b = Buffer.from(text, 'latin1');
  if (b.length % 16) b = Buffer.concat([b, Buffer.alloc(16 - b.length % 16, 0x20)]);
  const e = crypto.createCipheriv('aes-256-ecb', gamecrypt.V8_KEY, null);
  e.setAutoPadding(false);
  const head = Buffer.alloc(4); head.writeInt32LE(gamecrypt.VERSION, 0);
  return Buffer.concat([head, e.update(b), e.final()]);
}
function csvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// spec id -> types of its drop-enabled items
const glogic = new RccArchive(path.join(dataDir, 'glogic', 'GLogic.rcc'));
const specTypes = new Map();
{
  const name = glogic.list().find((n) => n.toLowerCase() === 'item.csv');
  const lines = plain(glogic.read(name)).toString('latin1').split(/\r?\n/);
  const h = csvLine(lines[0]);
  const iS = h.indexOf('dwSpecID'), iG = h.indexOf('bGenEnable'), iT = h.indexOf('emItemType');
  if (iS < 0 || iG < 0 || iT < 0) throw new Error('item.csv: missing column');
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = csvLine(lines[i]);
    if (+f[iS] >= 999 || +f[iG] === 0) continue;
    if (!specTypes.has(+f[iS])) specTypes.set(+f[iS], new Set());
    specTypes.get(+f[iS]).add(+f[iT]);
  }
}
const allPotion = (spec) => { const t = specTypes.get(spec); return !!t && t.size === 1 && t.has(CURE); };

const srcRcc = path.join(dataDir, 'glogicserver', 'GLogicServer.rcc');
const server = new RccArchive(srcRcc);
const report = [], skipped = [], changed = [];
fs.mkdirSync(path.join(workDir, 'files'), { recursive: true });

for (const name of server.list()) {
  if (!/^lv\d.*\.genitem$/i.test(name) && !ADD.has(name.toLowerCase())) continue;
  const raw = server.read(name);
  if (!gamecrypt.isEncoded(raw)) { skipped.push([name, 'not in the v8 text cipher']); continue; }
  const text = plain(raw).toString('latin1').replace(/\0+$/, '');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);

  let stone = -1, potion = -1, sum = 0;
  lines.forEach((line, i) => {
    const f = tokens(line);
    if (!f.length || f[0].toUpperCase() !== 'ITEMSPEC') return;
    const spec = num(f[1]) | 0, pct = num(f[2]);
    sum += pct;
    if (spec === STONE) { if (stone >= 0) throw new Error(name + ': two stone lines'); stone = i; }
    else if (allPotion(spec) && (potion < 0 || pct > num(tokens(lines[potion])[2]))) potion = i;
  });
  if (stone < 0 && ADD.has(name.toLowerCase())) {
    if (potion < 0) throw new Error(name + ': --add but no potion line to take from');
    let n = 0; for (const l of lines) { const f = tokens(l); if (f.length && /^(ITEMSPEC|ITEMID)$/i.test(f[0])) n++; }
    if (n + 1 > 30) throw new Error(name + ': --add would exceed 30 lines (EMGSPEC)');
    lines.splice(potion + 1, 0, `ITEMSPEC	${STONE}		0  //added: upgrade stones`);
    stone = potion + 1;
    ADD.delete(name.toLowerCase());
  }
  if (stone < 0) { skipped.push([name, 'no stone line']); continue; }
  const oldStone = num(tokens(lines[stone])[2]);
  if (oldStone >= SHARE) { skipped.push([name, `stone already ${oldStone}%`]); continue; }
  if (potion < 0) { skipped.push([name, 'no potion line to take from']); continue; }
  const diff = SHARE - oldStone, oldPot = num(tokens(lines[potion])[2]);
  if (oldPot - diff < 1) { skipped.push([name, `potion line only ${oldPot}%`]); continue; }

  const set = (i, v) => {
    const re = /^(\s*ITEMSPEC\s+\d+\s+)([0-9.]+)/i;
    if (!re.test(lines[i])) throw new Error(name + ': cannot rewrite line ' + (i + 1));
    lines[i] = lines[i].replace(re, (m, a) => a + fmt(v));
  };
  set(stone, SHARE); set(potion, oldPot - diff);

  // the new table, read the way the loader reads it
  let sum2 = 0; for (const l of lines) { const f = tokens(l); if (f.length && f[0].toUpperCase() === 'ITEMSPEC') sum2 += num(f[2]); }
  if (Math.abs(sum2 - sum) > 1e-6) throw new Error(name + ': entry total moved');
  if (num(tokens(lines[stone])[2]) !== SHARE) throw new Error(name + ': stone line not set');

  const out = encode(lines.join(eol) + eol);
  if (plain(out).toString('latin1').replace(/ +$/, '') !== lines.join(eol) + eol) throw new Error('round trip failed: ' + name);
  const file = path.join(workDir, 'files', name);
  fs.writeFileSync(file, out);
  changed.push([name, file]);
  report.push([name, oldStone, SHARE, 'spec ' + (num(tokens(lines[potion])[1]) | 0), oldPot, fmt(oldPot - diff), fmt(sum)]);
}

const esc = (v) => { const s = String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = (rows) => rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
fs.writeFileSync(path.join(workDir, 'changed_tables.csv'), '﻿' + csv([['file', 'stone % before', 'stone % after', 'potion line', 'potion % before', 'potion % after', 'entry total'], ...report]));
fs.writeFileSync(path.join(workDir, 'left_alone.csv'), '﻿' + csv([['file', 'why'], ...skipped]));
if (ADD.size) throw new Error('--add names not found: ' + [...ADD].join(', '));
console.log(`tables changed ${changed.length}, left alone ${skipped.length}`);

if (write && changed.length) {
  const out = path.join(workDir, 'GLogicServer.rcc');
  const log = console.log; console.log = () => {};
  try { require('./rcc-pack.js').pack(srcRcc, out, changed); } finally { console.log = log; }
  console.log('packed', out);
}
