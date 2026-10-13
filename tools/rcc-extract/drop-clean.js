'use strict';
//
// `drop-clean.js` — comment out the drop-table lines that can never drop.
//
//   node drop-clean.js <CLIENT/data dir> <work dir> [--write]
//
// A line is dead when
//   ITEMSPEC id %       no drop-enabled item carries that spec id
//   ITEMID  mid sid %   the item does not exist
//   QTITEM  mid sid %   the item does not exist
// Nothing else is touched: no rate, no item, no mob. The line is kept, with
// `//` in front (gltexfile cuts a line at "//"), so it can be put back.
//
// Taking a dead line out must not change what the live lines do. Entries are
// stacked into 0..100 (SGENITEM::LOADFILE), so that is true exactly when the
// table's entries fit in 100: a dead one then only ever stood for "nothing".
// A table that runs OVER 100 is different - its dead lines push live ones out
// of reach, and removing them would make those start dropping. Such tables are
// left alone and listed. Same for a question table over 100, which the loader
// rejects whole (SQTGENITEM::LOADFILE).
//
// Without --write it only reports. With it, the changed files are packed into
// <work dir>/GLogicServer.rcc; the archive in the data dir is not replaced.
//
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { RccArchive } = require('./rcc.js');
const gamecrypt = require('./gamecrypt.js');

const args = process.argv.slice(2);
const write = args.includes('--write');
const [dataDir, workDir] = args.filter((a) => !a.startsWith('--'));
if (!dataDir || !workDir) { console.error('usage: node drop-clean.js <CLIENT/data> <work dir> [--write]'); process.exit(2); }

const plain = (b) => (gamecrypt.isEncoded(b) ? gamecrypt.decode(b) : b);
const num = (v) => { const x = parseFloat(v); return isFinite(x) ? x : 0; };
const tokens = (line) => line.split('//')[0].trim().split(/[\s,{}\[\]()|]+/).filter((x) => x !== '');

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

// items: which exist, and which spec ids have something to give
const glogic = new RccArchive(path.join(dataDir, 'glogic', 'GLogic.rcc'));
const itemIds = new Set(), liveSpec = new Set();
let lowerScale = 1;
{
  const name = glogic.list().find((n) => n.toLowerCase() === 'item.csv');
  const lines = plain(glogic.read(name)).toString('latin1').split(/\r?\n/);
  const h = csvLine(lines[0]);
  const iS = h.indexOf('dwSpecID'), iG = h.indexOf('bGenEnable');
  if (iS < 0 || iG < 0) throw new Error('item.csv: no dwSpecID / bGenEnable column');
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = csvLine(lines[i]);
    itemIds.add(`${+f[0]}/${+f[1]}`);
    if (+f[iS] < 999 && +f[iG] !== 0) liveSpec.add(+f[iS]);
  }
  const cc = glogic.list().find((n) => n.toLowerCase() === 'default.charclass');
  for (const line of plain(glogic.read(cc)).toString('latin1').split(/\r?\n/)) {
    const t = tokens(line);
    if (t[0] === 'fITEM_DROP_LOWER_SCALE' && isFinite(parseFloat(t[1]))) lowerScale = parseFloat(t[1]);
  }
}

const srcRcc = path.join(dataDir, 'glogicserver', 'GLogicServer.rcc');
const server = new RccArchive(srcRcc);
const report = [], skipped = [], changed = [];
fs.mkdirSync(path.join(workDir, 'files'), { recursive: true });

for (const name of server.list()) {
  if (!/\.genitem$/i.test(name)) continue;
  const raw = server.read(name);
  if (!gamecrypt.isEncoded(raw)) { skipped.push([name, 'not in the v8 text cipher: left alone']); continue; }
  const text = plain(raw).toString('latin1').replace(/\0+$/, '');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);

  let entrySum = 0, qtSum = 0; const dead = [];
  lines.forEach((line, i) => {
    const f = tokens(line);
    if (!f.length) return;
    const tag = f[0].toUpperCase();
    if (tag === 'ITEMSPEC') {
      const id = num(f[1]) >= 999 ? 0 : num(f[1]) | 0, pct = num(f[2]);
      entrySum += (lowerScale !== 1 && pct < 2) ? pct * lowerScale : pct;
      if (!liveSpec.has(id)) dead.push([i, `spec ${id}`, pct]);
    } else if (tag === 'ITEMID') {
      const pct = num(f[3]);
      entrySum += (lowerScale !== 1 && pct < 2) ? pct * lowerScale : pct;
      if (!itemIds.has(`${num(f[1]) | 0}/${num(f[2]) | 0}`)) dead.push([i, `item ${f[1]}/${f[2]}`, pct]);
    } else if (tag === 'QTITEM') {
      qtSum += num(f[3]);
      if (!itemIds.has(`${num(f[1]) | 0}/${num(f[2]) | 0}`)) dead.push([i, `question ${f[1]}/${f[2]}`, num(f[3])]);
    }
  });
  if (!dead.length) continue;
  if (entrySum > 100.0001 || qtSum > 100.0001) {
    skipped.push([name, `${dead.length} dead line(s) left in place: the table runs over 100% (${+Math.max(entrySum, qtSum).toFixed(2)}), removing them would change what drops`]);
    continue;
  }
  for (const [i, what, pct] of dead) { lines[i] = '//' + lines[i]; report.push([name, i + 1, what, pct]); }
  const out = encode(lines.join(eol) + eol);
  // read it back the way the game does before trusting it
  const back = plain(out).toString('latin1');
  if (back.replace(/ +$/, '') !== lines.join(eol) + eol) throw new Error('round trip failed: ' + name);
  const file = path.join(workDir, 'files', name);
  fs.writeFileSync(file, out);
  changed.push([name, file]);
}

const esc = (v) => { const s = String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = (rows) => rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
fs.writeFileSync(path.join(workDir, 'commented_lines.csv'), csv([['file', 'line', 'entry', 'rate %'], ...report]));
fs.writeFileSync(path.join(workDir, 'left_alone.csv'), csv([['file', 'why'], ...skipped]));
console.log(`files changed ${changed.length}, lines commented ${report.length}, files left alone ${skipped.length}, low-rate scale ${lowerScale}`);

if (write && changed.length) {
  const out = path.join(workDir, 'GLogicServer.rcc');
  const log = console.log; console.log = () => {};      // one line per entry otherwise
  try { require('./rcc-pack.js').pack(srcRcc, out, changed); } finally { console.log = log; }
  console.log('packed', out);
}
