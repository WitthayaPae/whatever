// Vulgar Leader's summon box (2026-10-31). Quest 701 asks for Vulgar Leader (0/22), a
// leader that only appears from a QUESTION_MOBGEN Q-box, and no box summoned it. Item
// 9/47 is a copy of 9/11 (Hime Leader's box: type 26 question item, MOBGEN 2/2) with
// its native id, name/comment keys and summoned mob (wParam1/2 -> 0/22) changed.
// Name: the same "Lucky Box" every leader box has.
//
//   node mk_vulgarbox.js <rcc-extract dir> <GLogic.rcc in> <out dir>
//
// Writes <out dir>/item.isf, item.csv, ItemStrTable.txt, ItemStrTable_en.txt (the
// GLogic.rcc entries, edited) and <out dir>/GLogic.rcc with the four replaced. Each is
// read back: every existing item record is unchanged, the new one parses.
const T = process.argv[2];
const fs = require('fs');
const path = require('path');
const B = require(T + '/bytecrypt.js');
const itemdb = require(T + '/itemdb.js');
const { Cursor } = require(T + '/itemdata.js');
const { RccArchive } = require(T + '/rcc.js');
const gamecrypt = require(T + '/gamecrypt.js');
const { pack } = require(T + '/rcc-pack.js');
const { addLines } = require(__dirname + '/strtab.js');

const [, , , RCC, OUTDIR] = process.argv;
const SRC = [9, 11], NEW = [9, 47], MOB = [0, 22];
const KEY_SRC = 'IN_009_011', KEY_NEW = 'IN_009_047', CKEY_SRC = 'ID_009_011', CKEY_NEW = 'ID_009_047';
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
const idOf = (r) => r.it.basic && [r.it.basic.nativeId & 0xffff, r.it.basic.nativeId >>> 16];
const find = (m, s) => recs.find((r) => { const x = idOf(r); return x && x[0] === m && x[1] === s; });
if (find(...NEW)) throw new Error(NEW.join('/') + ' already exists');
const tpl = find(...SRC);
if (!tpl) throw new Error('template not found');
if (tpl.it.basic.name !== KEY_SRC || tpl.it.basic.comment !== CKEY_SRC) throw new Error('template keys differ: ' + tpl.it.basic.name);

const lp = (s) => { const b = Buffer.concat([Buffer.alloc(4), Buffer.from(s, 'latin1'), Buffer.alloc(1)]); b.writeUInt32LE(s.length + 1, 0); return b; };
let rec = Buffer.from(body.slice(tpl.st, tpl.en));
const bd = 4;	//	after the record's version DWORD: [type][ver][size] of SBASIC
if (rec.readUInt32LE(bd) !== 1) throw new Error('first block is not SBASIC');
const basicSize = rec.readUInt32LE(bd + 8);
const bdata = bd + 12;
if (rec.readUInt16LE(bdata) !== SRC[0] || rec.readUInt16LE(bdata + 2) !== SRC[1]) throw new Error('native id not at the start of SBASIC');
rec.writeUInt16LE(NEW[0], bdata); rec.writeUInt16LE(NEW[1], bdata + 2);

//	The question block: [ver 0x0101][size 16][int emType 8][WORD p1][WORD p2][float][float]
const q = Buffer.from([0x01, 0x01, 0, 0, 16, 0, 0, 0, 8, 0, 0, 0, 2, 0, 2, 0]);
const qi = rec.indexOf(q);
if (qi < 0 || rec.indexOf(q, qi + 1) >= 0) throw new Error('question block (MOBGEN 2/2) not found exactly once');
rec.writeUInt16LE(MOB[0], qi + 12); rec.writeUInt16LE(MOB[1], qi + 14);

//	Name and comment keys inside SBASIC (the block grows by 0 here: same length).
let delta = 0;
for (const [from, to] of [[KEY_SRC, KEY_NEW], [CKEY_SRC, CKEY_NEW]]) {
  const f = lp(from), i = rec.indexOf(f, bdata);
  if (i < 0 || i > bdata + basicSize + delta || rec.indexOf(f, i + 1) >= 0 && rec.indexOf(f, i + 1) < bdata + basicSize + delta) throw new Error('key not found once: ' + from);
  rec = Buffer.concat([rec.slice(0, i), lp(to), rec.slice(i + f.length)]);
  delta += lp(to).length - f.length;
}
rec.writeUInt32LE(basicSize + delta, bd + 8);

const out = Buffer.concat([body, rec]);
out.writeUInt32LE(count + 1, head.bodyOffset);
const isf = B.encode(Buffer.from(out), 'EMBYTECRYPT_ITEM', head.bodyOffset);
const back = itemdb.parse(isf);
if (back.count !== count + 1 || back.bytesRead !== back.fileSize || back.stats.failedItems) throw new Error('item.isf read back failed');
for (let i = 0; i < count; i++) if (JSON.stringify(recs[i].it.basic) !== JSON.stringify(back.items[i].basic)) throw new Error('existing item changed at ' + i);
const nb = back.items[count].basic;
if ((nb.nativeId & 0xffff) !== NEW[0] || nb.nativeId >>> 16 !== NEW[1] || nb.name !== KEY_NEW || nb.itemType !== tpl.it.basic.itemType) throw new Error('new item wrong');
//	the question block of the new record, read from the re-encoded file
{
  const ob = B.decode(Buffer.from(isf), 'EMBYTECRYPT_ITEM', head.bodyOffset);
  const nq = Buffer.from([0x01, 0x01, 0, 0, 16, 0, 0, 0, 8, 0, 0, 0, MOB[0], 0, MOB[1], 0]);
  const at = ob.indexOf(nq, ob.length - rec.length);
  if (at < 0) throw new Error('new question block not found in the output');
}
fs.writeFileSync(path.join(OUTDIR, 'item.isf'), isf);
console.log('item.isf', raw.length, '->', isf.length, 'items', back.count, 'new', NEW.join('/'), nb.name, 'type', nb.itemType, 'summons', MOB.join('/'));

/* ---------------------------------------------------------------- item.csv */
{
  const encode = (text) => {
    const crypto = require('crypto');
    let b = Buffer.from(text, 'latin1');
    if (b.length % 16) b = Buffer.concat([b, Buffer.alloc(16 - b.length % 16, 0x20)]);
    const e = crypto.createCipheriv('aes-256-ecb', gamecrypt.V8_KEY, null);
    e.setAutoPadding(false);
    const h = Buffer.alloc(4); h.writeInt32LE(gamecrypt.VERSION, 0);
    return Buffer.concat([h, e.update(b), e.final()]);
  };
  const csvRaw = arc.read(entry('item.csv'));
  const wasEnc = gamecrypt.isEncoded(csvRaw);
  const text = plain(csvRaw).toString('latin1').replace(/[\0 ]+$/, '');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(eol);
  const H = lines[0].split(','), ip = H.indexOf('wParam1');
  if (ip < 0 || H[ip + 1] !== 'wParam2') throw new Error('csv has no wParam1/2');
  if (lines.some((l) => l.startsWith(NEW.join(',') + ','))) throw new Error('csv row exists');
  const si = lines.findIndex((l) => l.startsWith(SRC.join(',') + ','));
  if (si < 0) throw new Error('csv template row missing');
  const cols = lines[si].split(',');
  if (cols[ip] !== '2' || cols[ip + 1] !== '2') throw new Error('csv template params are not 2/2');
  cols[0] = String(NEW[0]); cols[1] = String(NEW[1]); cols[ip] = String(MOB[0]); cols[ip + 1] = String(MOB[1]);
  for (let i = 0; i < cols.length; i++) { if (cols[i] === KEY_SRC) cols[i] = KEY_NEW; if (cols[i] === CKEY_SRC) cols[i] = CKEY_NEW; }
  let last = -1;
  lines.forEach((l, i) => { if (l.startsWith(NEW[0] + ',')) last = i; });
  lines.splice(last + 1, 0, cols.join(','));
  const outText = lines.join(eol) + (text.endsWith(eol) ? '' : '');
  const buf = wasEnc ? encode(outText) : Buffer.from(outText, 'latin1');
  if (plain(buf).toString('latin1').replace(/[\0 ]+$/, '') !== outText.replace(/[\0 ]+$/, '')) throw new Error('csv round trip');
  fs.writeFileSync(path.join(OUTDIR, 'item.csv'), buf);
  console.log('item.csv +1 row after', lines[last].split(',').slice(0, 2).join('/'), wasEnc ? '(v8)' : '(plain)');
}

/* ---------------------------------------------------------------- names */
for (const [f, name] of [['ItemStrTable.txt', 'กล่องเสี่ยงโชค'], ['ItemStrTable_en.txt', 'Lucky Box']]) {
  const tmpIn = path.join(OUTDIR, f + '.in');
  fs.writeFileSync(tmpIn, arc.read(entry(f)));
  addLines(T, tmpIn, path.join(OUTDIR, f), 'IN_009_046', [[KEY_NEW, name]]);
  fs.unlinkSync(tmpIn);
  console.log(f, '+', KEY_NEW);
}

/* ---------------------------------------------------------------- GLogic.rcc */
pack(RCC, path.join(OUTDIR, 'GLogic.rcc'), [
  [entry('item.isf'), path.join(OUTDIR, 'item.isf')],
  [entry('item.csv'), path.join(OUTDIR, 'item.csv')],
  [entry('ItemStrTable.txt'), path.join(OUTDIR, 'ItemStrTable.txt')],
  [entry('ItemStrTable_en.txt'), path.join(OUTDIR, 'ItemStrTable_en.txt')],
]);
console.log('GLogic.rcc written to', OUTDIR);
