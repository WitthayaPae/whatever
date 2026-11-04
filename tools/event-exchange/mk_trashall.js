// Every item can go in the trash (2026-10-31, the user: "make every item can trash",
// in the item data, not the code). Sets TRADE_GARBAGE (0x80, GLItemDef.h) in
// SITEMBASIC::dwFlags of every record of item.isf, and in item.csv's dwFlags
// column, so the tooltip's "trash: allowed" line, the mobile item sheet's destroy
// row and the server agree. Nothing else in a record changes.
//
//   node mk_trashall.js <rcc-extract dir> <GLogic.rcc in> <out dir>
//
// Writes <out dir>/item.isf, item.csv and GLogic.rcc (the two replaced). Read back:
// same item count, every record's basic fields identical except flags | 0x80.
const T = process.argv[2];
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const B = require(T + '/bytecrypt.js');
const itemdb = require(T + '/itemdb.js');
const { Cursor } = require(T + '/itemdata.js');
const { RccArchive } = require(T + '/rcc.js');
const gamecrypt = require(T + '/gamecrypt.js');
const { pack } = require(T + '/rcc-pack.js');

const [, , , RCC, OUTDIR] = process.argv;
const GARBAGE = 0x80;
fs.mkdirSync(OUTDIR, { recursive: true });
const arc = new RccArchive(RCC);
const entry = (n) => { const e = arc.list().find((x) => x.toLowerCase() === n.toLowerCase()); if (!e) throw new Error('not in GLogic.rcc: ' + n); return e; };
const plain = (b) => (gamecrypt.isEncoded(b) ? gamecrypt.decode(b) : b);

/* ---------------------------------------------------------------- item.isf */
const raw = arc.read(entry('item.isf'));
const head = B.readHeader(raw);
if (head.type !== 'GLITEM') throw new Error('not GLITEM');
const body = B.decode(Buffer.from(raw), 'EMBYTECRYPT_ITEM', head.bodyOffset);
const c = new Cursor(body, head.bodyOffset);
const count = c.u32();
const stats = { badBasic: 0, failedItems: 0, sentinelFalsePositives: 0, oldBasicVersions: new Map() };
const recs = [];
for (let i = 0; i < count; i++) { const st = c.p; const it = itemdb.readItem(c, stats); recs.push({ st, en: c.p, it }); }
if (c.p !== body.length) throw new Error('walk did not end at EOF');

let had = 0, set = 0;
for (const r of recs) {
  if (!r.it.basic) throw new Error('record without SBASIC at ' + r.st);
  //  [DWORD record version][type 1][ver][size] then SBASIC: 4 DWORDs, strName
  //  ([DWORD len incl NUL][bytes]), fExpMultiple, two WORDs, dwFlags.
  const bd = r.st + 4;
  if (body.readUInt32LE(bd) !== 1) throw new Error('first block is not SBASIC at ' + r.st);
  const data = bd + 12;
  const nameLen = body.readUInt32LE(data + 16);
  const at = data + 16 + 4 + nameLen + 4 + 2 + 2;
  const flags = body.readUInt32LE(at);
  if (flags !== r.it.basic.flags) throw new Error(`flags not where expected at item ${r.it.basic.nativeId}: ${flags} vs ${r.it.basic.flags}`);
  if (flags & GARBAGE) { ++had; continue; }
  body.writeUInt32LE((flags | GARBAGE) >>> 0, at);
  ++set;
}
const isf = B.encode(Buffer.from(body), 'EMBYTECRYPT_ITEM', head.bodyOffset);
const back = itemdb.parse(isf);
if (back.count !== count || back.bytesRead !== back.fileSize || back.stats.failedItems) throw new Error('item.isf read back failed');
for (let i = 0; i < count; i++) {
  const a = { ...recs[i].it.basic, flags: (recs[i].it.basic.flags | GARBAGE) >>> 0 };
  if (JSON.stringify(a) !== JSON.stringify(back.items[i].basic)) throw new Error('item changed beyond the flag at ' + i);
}
fs.writeFileSync(path.join(OUTDIR, 'item.isf'), isf);
console.log(`item.isf: ${count} items, ${had} already trashable, ${set} set`);

/* ---------------------------------------------------------------- item.csv */
{
  const csvRaw = arc.read(entry('item.csv'));
  const wasEnc = gamecrypt.isEncoded(csvRaw);
  const text = plain(csvRaw).toString('latin1');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(eol);
  const H = lines[0].split(',');
  const fi = H.indexOf('dwFlags');
  if (fi < 0) throw new Error('csv has no dwFlags');
  let n = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length <= fi || !/^\d+$/.test(cols[fi])) continue;
    const v = parseInt(cols[fi], 10);
    if (v & GARBAGE) continue;
    cols[fi] = String((v | GARBAGE) >>> 0);
    lines[i] = cols.join(',');
    ++n;
  }
  const out = lines.join(eol);
  let buf = Buffer.from(out, 'latin1');
  if (wasEnc) {
    if (buf.length % 16) buf = Buffer.concat([buf, Buffer.alloc(16 - buf.length % 16, 0x20)]);
    const e = crypto.createCipheriv('aes-256-ecb', gamecrypt.V8_KEY, null);
    e.setAutoPadding(false);
    const h = Buffer.alloc(4); h.writeInt32LE(gamecrypt.VERSION, 0);
    buf = Buffer.concat([h, e.update(buf), e.final()]);
  }
  fs.writeFileSync(path.join(OUTDIR, 'item.csv'), buf);
  console.log(`item.csv: ${n} rows set ${wasEnc ? '(v8)' : '(plain)'}`);
}

pack(RCC, path.join(OUTDIR, 'GLogic.rcc'), [
  [entry('item.isf'), path.join(OUTDIR, 'item.isf')],
  [entry('item.csv'), path.join(OUTDIR, 'item.csv')],
]);
console.log('GLogic.rcc written to', OUTDIR);
