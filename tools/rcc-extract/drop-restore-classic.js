'use strict';
//
// `drop-restore-classic.js` — put the developer's original drop tables back.
//
//   node drop-restore-classic.js <DEV EP1 dir> <DEV EP9/CLIENT/data dir> <work dir> [--write]
//
// Three copies of every table exist:
//   ref     DEV EP1/FULLSOURCE/=Document/glogic/glogicserver   cipher v3, the
//           developer's files (Korean comments, GENRATE 25-50)
//   ep1     DEV EP1/CLIENT/data/glogicserver                   cipher v5, the
//           same files with the rates raised
//   now     GLogicServer.rcc                                   cipher v8, what
//           the EP1 port copied from "ep1"
//
// A table is restored only when all of this holds:
//   - "ref" has it in cipher v3 (a file in another version was put in later)
//   - "now", before the 2026-10-13 dead-line pass, is the "ep1" copy unchanged.
//     A table edited in this tree since the port is left alone and listed,
//     because the edit may be a re-key to this tree's item groups.
//   - "ref" differs from it in more than comments
// The restored file is the "ref" text byte for byte, re-encrypted.
//
// Run drop-clean.js afterwards: the restored text has its dead lines back.
//
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { RccArchive } = require('./rcc.js');
const gamecrypt = require('./gamecrypt.js');

const args = process.argv.slice(2);
const write = args.includes('--write');
const [ep1Dir, dataDir, workDir] = args.filter((a) => !a.startsWith('--'));
if (!ep1Dir || !dataDir || !workDir) { console.error('usage: node drop-restore-classic.js <DEV EP1> <CLIENT/data> <work dir> [--write]'); process.exit(2); }

const KEYS = {
  3: Buffer.from('skrkrhtlvdj!@#wpfrmfjgrpgo!@#$qk', 'latin1'),
  5: Buffer.from(Buffer.from('zFYf*5k!@#SkyN%t%$fhju!@3f*5z47#', 'latin1').map((b) => ((b ^ 0x21) + 0x31) & 0xff)),
  8: gamecrypt.V8_KEY,
};
function decode(buf) {
  const v = buf.length >= 20 ? buf.readInt32LE(0) : 0;
  if (!KEYS[v]) return null;
  const p = buf.subarray(4); const whole = p.length - p.length % 16;
  const d = crypto.createDecipheriv('aes-256-ecb', KEYS[v], null); d.setAutoPadding(false);
  return { v, text: Buffer.concat([d.update(p.subarray(0, whole)), d.final()]).toString('latin1').replace(/[\0 ]+$/, '') };
}
function encode(text) {
  let b = Buffer.from(text, 'latin1');
  if (b.length % 16) b = Buffer.concat([b, Buffer.alloc(16 - b.length % 16, 0x20)]);
  const e = crypto.createCipheriv('aes-256-ecb', KEYS[8], null); e.setAutoPadding(false);
  const head = Buffer.alloc(4); head.writeInt32LE(8, 0);
  return Buffer.concat([head, e.update(b), e.final()]);
}
// what the loader sees: comments gone, separators collapsed
const norm = (t) => t.split(/\r?\n/).map((l) => l.split('//')[0].trim().split(/[\s,{}\[\]()|]+/).filter(Boolean).join(' ')).filter(Boolean).join('\n');
const dirSet = (dir) => { const m = new Map(); for (const n of fs.readdirSync(dir)) if (/\.genitem$/i.test(n)) m.set(n.toLowerCase(), path.join(dir, n)); return m; };

const ref = dirSet(path.join(ep1Dir, 'FULLSOURCE', '=Document', 'glogic', 'glogicserver'));
const ep1 = dirSet(path.join(ep1Dir, 'CLIENT', 'data', 'glogicserver'));
const srcRcc = path.join(dataDir, 'glogicserver', 'GLogicServer.rcc');
const before = new RccArchive(path.join(dataDir, 'glogicserver', 'GLogicServer.rcc.bak_pre_dropclean'));
const now = new RccArchive(srcRcc);

fs.mkdirSync(path.join(workDir, 'files'), { recursive: true });
const rows = [], changed = [];
const count = { restored: 0, 'already original': 0, 'no original': 0, 'original replaced later (not v3)': 0, 'edited in this tree: left alone': 0 };
const rate = (t) => (/^\s*GENRATE\s+([\d.]+)/mi.exec(t.split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join('\n')) || [0, ''])[1];

for (const name of now.list()) {
  if (!/\.genitem$/i.test(name)) continue;
  const k = name.toLowerCase();
  const cur = decode(before.read(name));
  if (!cur) { rows.push([name, 'unreadable', '', '']); continue; }
  if (!ref.has(k)) { count['no original']++; continue; }
  const r = decode(fs.readFileSync(ref.get(k)));
  if (!r || r.v !== 3) { count['original replaced later (not v3)']++; rows.push([name, 'original replaced later (not v3)', rate(cur.text), '']); continue; }
  if (norm(r.text) === norm(cur.text)) { count['already original']++; continue; }
  const e = ep1.has(k) ? decode(fs.readFileSync(ep1.get(k))) : null;
  if (!e || norm(e.text) !== norm(cur.text)) { count['edited in this tree: left alone']++; rows.push([name, 'edited in this tree: left alone', rate(cur.text), rate(r.text)]); continue; }

  const eol = r.text.includes('\r\n') ? '\r\n' : '\n';
  const out = encode(r.text + eol);
  if (norm(decode(out).text) !== norm(r.text)) throw new Error('round trip failed: ' + name);
  const file = path.join(workDir, 'files', name);
  fs.writeFileSync(file, out);
  changed.push([name, file]);
  count.restored++;
  rows.push([name, 'restored', rate(cur.text), rate(r.text)]);
}

const esc = (v) => { const s = String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
fs.writeFileSync(path.join(workDir, 'restore_report.csv'), [['file', 'result', 'fires % before', 'fires % original'], ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n');
console.log(JSON.stringify(count, null, 1));

if (write && changed.length) {
  const out = path.join(workDir, 'GLogicServer.rcc');
  const log = console.log; console.log = () => {};
  try { require('./rcc-pack.js').pack(srcRcc, out, changed); } finally { console.log = log; }
  console.log('packed', out);
}
