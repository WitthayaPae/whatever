// Add items 512/57 and 512/58 (event exchange items) to the loose item.isf, as
// copies of 972/47 "Tokens of Leprechaun" (an event token: type 55, drop model
// Drop_Normal_resistore01.egp). Per copy: native id, name/comment keys, icon
// (cell + atlas), stack size, spec id (drop group) and drop enabled.
//
//   node mk_items.js <tools dir> <item.isf in> <item.isf out>
const T = process.argv[2];
const fs = require('fs');
const B = require(T + '/bytecrypt.js');
const itemdb = require(T + '/itemdb.js');
const { Cursor } = require(T + '/itemdata.js');

const [, , , IN, OUT] = process.argv;
const raw = fs.readFileSync(IN);
const head = B.readHeader(raw);
if (head.type !== 'GLITEM') throw new Error('not GLITEM');
const body = B.decode(Buffer.from(raw), 'EMBYTECRYPT_ITEM', head.bodyOffset);

// record spans
const c = new Cursor(body, head.bodyOffset);
const count = c.u32();
const stats = { badBasic: 0, failedItems: 0, sentinelFalsePositives: 0, oldBasicVersions: new Map() };
const recs = [];
for (let i = 0; i < count; i++) {
  const st = c.p;
  const it = itemdb.readItem(c, stats);
  recs.push({ st, en: c.p, it });
}
if (c.p !== body.length) throw new Error('walk did not end at EOF: ' + c.p + ' / ' + body.length);
const idOf = (r) => r.it.basic && { m: r.it.basic.nativeId & 0xffff, s: r.it.basic.nativeId >>> 16 };
const find = (m, s) => recs.find((r) => { const x = idOf(r); return x && x.m === m && x.s === s; });
for (const [m, s] of [[512, 57], [512, 58]]) if (find(m, s)) throw new Error(`${m}/${s} already exists`);
const tpl = find(972, 47);
if (!tpl) throw new Error('template 972/47 not found');

// blocks of a record: [DWORD recordVersion] then [type][ver][size][data] ... up to a
// type 7+ (self-framed) or FILE_END_DATA
function blocks(rec) {
  const out = []; let p = rec.st + 4;
  for (;;) {
    const type = body.readUInt32LE(p);
    if (type === 0xEDEDEDED || type > 6) break;
    const ver = body.readUInt32LE(p + 4), size = body.readUInt32LE(p + 8);
    out.push({ type, ver, size, at: p, data: p + 12 });
    p += 12 + size;
  }
  return out;
}
const tb = blocks(tpl);
const blk = (t) => tb.find((b) => b.type === t);
const basic = blk(1), drug = blk(3), gen = blk(6);
if (!basic || !drug || !gen) throw new Error('template blocks missing: ' + tb.map((b) => b.type));

// a length-prefixed string inside a byte range: [DWORD len incl NUL][bytes][NUL]
function findStr(buf, from, to, s) {
  const want = Buffer.concat([Buffer.alloc(4), Buffer.from(s, 'latin1'), Buffer.alloc(1)]);
  want.writeUInt32LE(s.length + 1, 0);
  const i = buf.indexOf(want, from);
  if (i < 0 || i >= to) throw new Error('string not found: ' + s);
  if (buf.indexOf(want, i + 1) >= 0 && buf.indexOf(want, i + 1) < to) throw new Error('string twice: ' + s);
  return { i, len: want.length };
}
const lp = (s) => { const b = Buffer.concat([Buffer.alloc(4), Buffer.from(s, 'latin1'), Buffer.alloc(1)]); b.writeUInt32LE(s.length + 1, 0); return b; };

const tb0 = tpl.it.basic;
console.log('template', tb0.name, tb0.comment, 'inv', tb0.inventoryFile, 'icon', tb0.iconId.toString(16), 'pile', tpl.it.pile,
  'gen spec', body.readUInt32LE(gen.data), 'genEnable', body.readUInt32LE(gen.data + 12), 'gen ver', gen.ver.toString(16), 'gen size', gen.size);

const LAYOUT = require(T + '/../layout-probe/layout.json');
const WPILE = LAYOUT.structs.ITEM_SDRUG.fields.wPileNum.off;

function make(sub, specId, iconX, atlas, pile) {
  let rec = Buffer.from(body.slice(tpl.st, tpl.en));
  const base = tpl.st;
  // fixed fields first (offsets unchanged): native id, icon, pile, spec, gen enable
  const bd = basic.data - base;
  rec.writeUInt16LE(512, bd); rec.writeUInt16LE(sub, bd + 2);
  // sICONID: found after the strName string - search the template's own value
  const iconAt = rec.indexOf((() => { const b = Buffer.alloc(4); b.writeUInt32LE(tb0.iconId, 0); return b; })(), bd + 16);
  if (iconAt < 0 || iconAt > bd + basic.size) throw new Error('icon id not found');
  rec.writeUInt16LE(iconX, iconAt); rec.writeUInt16LE(0, iconAt + 2);
  rec.writeUInt16LE(pile, drug.data - base + WPILE);
  rec.writeUInt32LE(specId, gen.data - base);
  rec.writeUInt32LE(1, gen.data - base + 12);
  // strings in SBASIC (size changes): name key, comment key, icon atlas
  const subs = [[tb0.name, `IN_512_0${sub}`], [tb0.comment, `ID_512_0${sub}`], [tb0.inventoryFile, atlas]];
  let delta = 0;
  for (const [from, to] of subs) {
    const f = findStr(rec, bd, bd + basic.size + delta, from);
    rec = Buffer.concat([rec.slice(0, f.i), lp(to), rec.slice(f.i + f.len)]);
    delta += lp(to).length - f.len;
  }
  rec.writeUInt32LE(basic.size + delta, basic.at - base + 8);
  return rec;
}
const ATLAS = 'eventexchange01.dds';
const n57 = make(57, 991, 0, ATLAS, 999);
const n58 = make(58, 992, 1, ATLAS, 999);

const out = Buffer.concat([body.slice(0, body.length), n57, n58]);
out.writeUInt32LE(count + 2, head.bodyOffset);
const enc = B.encode(Buffer.from(out), 'EMBYTECRYPT_ITEM', head.bodyOffset);

// read back
const back = itemdb.parse(enc);
if (back.count !== count + 2 || back.bytesRead !== back.fileSize || back.stats.failedItems) throw new Error('read back failed ' + JSON.stringify(back.stats) + ' ' + back.bytesRead + '/' + back.fileSize);
for (let i = 0; i < count; i++) {
  const a = recs[i].it.basic, b = back.items[i].basic;
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('existing item changed at ' + i);
}
for (const it of back.items.slice(-2)) {
  const b = it.basic;
  console.log('new', (b.nativeId & 0xffff) + '/' + (b.nativeId >>> 16), b.name, b.comment, 'type', b.itemType, 'icon', (b.iconId & 0xffff) + '/' + (b.iconId >>> 16), b.inventoryFile, b.fieldFile, 'flags', b.flags, 'pile', it.pile);
}
fs.writeFileSync(OUT, enc);
console.log('wrote', OUT, enc.length, 'items', back.count);
