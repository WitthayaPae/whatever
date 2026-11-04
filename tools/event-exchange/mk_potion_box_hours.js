// Clone the potion combo box 998/40 "กล่องรวมน้ำยา (1 วัน)" and its three potions
// (998/160 HP, 161 MP, 162 SP [ใหญ่] (1 วัน)) into 6-hour, 3-hour and 1-hour sets.
// User request 2026-11-04.
//
// The time is on the potions, not the box: each potion has ITEM_TIMELMT and
// tTIME_LMT = 86400 s. The box (ITEM_BOX) lists the three potions in sITEMS.
// Per clone: native id, name/comment keys, tTIME_LMT (potions only), and the
// box's three sITEMS ids. Everything else is the template's bytes.
//
//   node mk_potion_box_hours.js <tools dir> <glogic dir> <out dir>
const [, , T, G, O] = process.argv;
const fs = require('fs');
const path = require('path');
const B = require(T + '/bytecrypt.js');
const itemdb = require(T + '/itemdb.js');
const { Cursor } = require(T + '/itemdata.js');
const { addLines } = require('./strtab.js');

const SETS = [
  { hours: 6, box: 178, hp: 179, mp: 180, sp: 181 },
  { hours: 3, box: 182, hp: 183, mp: 184, sp: 185 },
  { hours: 1, box: 186, hp: 187, mp: 188, sp: 189 },
];
const MAIN = 998, TPL = { box: 40, hp: 160, mp: 161, sp: 162 };
const DAY = 86400;

const raw = fs.readFileSync(path.join(G, 'item.isf'));
const head = B.readHeader(raw);
if (head.type !== 'GLITEM') throw new Error('not GLITEM');
const body = B.decode(Buffer.from(raw), 'EMBYTECRYPT_ITEM', head.bodyOffset);
const c = new Cursor(body, head.bodyOffset);
const count = c.u32();
const stats = { badBasic: 0, failedItems: 0, sentinelFalsePositives: 0, oldBasicVersions: new Map() };
const recs = [];
for (let i = 0; i < count; i++) { const st = c.p; const it = itemdb.readItem(c, stats); recs.push({ st, en: c.p, it }); }
if (c.p !== body.length) throw new Error('walk did not end at EOF');
const find = (s) => recs.find((r) => r.it.basic && (r.it.basic.nativeId & 0xffff) === MAIN && (r.it.basic.nativeId >>> 16) === s);
for (const st of SETS) for (const k of ['box', 'hp', 'mp', 'sp']) if (find(st[k])) throw new Error(`${MAIN}/${st[k]} already exists`);

const u16pair = (m, s) => { const b = Buffer.alloc(4); b.writeUInt16LE(m, 0); b.writeUInt16LE(s, 2); return b; };
const i64 = (v) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v), 0); return b; };
function only(rec, pat, what) {
  const i = rec.indexOf(pat);
  if (i < 0) throw new Error(what + ' not found');
  if (rec.indexOf(pat, i + 1) >= 0) throw new Error(what + ' found twice');
  return i;
}
const key = (p, s) => `${p}_${MAIN}_${String(s).padStart(3, '0')}`;

function clone(tplSub, newSub, seconds, boxMap) {
  const t = find(tplSub);
  if (!t) throw new Error('template missing ' + tplSub);
  const rec = Buffer.from(body.slice(t.st, t.en));
  // native id = first two WORDs of the SBASIC data: [recver][type][ver][size] then sNativeID
  const idAt = only(rec, u16pair(MAIN, tplSub), 'native id ' + tplSub);
  if (idAt !== 16) throw new Error('native id not at the SBASIC start: ' + idAt);
  rec.writeUInt16LE(newSub, idAt + 2);
  // name / comment keys: same length, so no block size changes
  for (const p of ['IN', 'ID']) {
    const a = Buffer.from(key(p, tplSub) + '\0', 'latin1'), b = Buffer.from(key(p, newSub) + '\0', 'latin1');
    rec.set(b, only(rec, a, key(p, tplSub)));
  }
  if (!boxMap) rec.set(i64(seconds), only(rec, i64(DAY), 'tTIME_LMT in ' + tplSub));   // the box has no time of its own
  if (boxMap) for (const [from, to] of boxMap) {
    const at = only(rec, u16pair(MAIN, from), 'box entry ' + from);
    rec.writeUInt16LE(to, at + 2);
  }
  return rec;
}

const add = [];
const thLines = [], enLines = [];
for (const st of SETS) {
  const sec = st.hours * 3600;
  const th = `${st.hours} ชั่วโมง`, en = `${st.hours} Hour${st.hours > 1 ? 's' : ''}`;
  add.push(clone(TPL.hp, st.hp, sec), clone(TPL.mp, st.mp, sec), clone(TPL.sp, st.sp, sec));
  add.push(clone(TPL.box, st.box, sec, [[TPL.hp, st.hp], [TPL.mp, st.mp], [TPL.sp, st.sp]]));
  thLines.push([key('IN', st.box), `กล่องรวมน้ำยา (${th})`], [key('IN', st.hp), `น้ำยาเพิ่ม HP [ใหญ่] (${th})`],
    [key('IN', st.mp), `น้ำยาเพิ่ม MP [ใหญ่] (${th})`], [key('IN', st.sp), `น้ำยาเพิ่ม SP [ใหญ่] (${th})`]);
  enLines.push([key('IN', st.box), `Potion Combo Box (${en})`], [key('IN', st.hp), `HP Boost Potion [Large] (${en})`],
    [key('IN', st.mp), `MP Boost Potion [Large] (${en})`], [key('IN', st.sp), `SP Boost Potion [Large] (${en})`]);
}
thLines.sort((a, b) => a[0].localeCompare(b[0])); enLines.sort((a, b) => a[0].localeCompare(b[0]));

const out = Buffer.concat([body, ...add]);
out.writeUInt32LE(count + add.length, head.bodyOffset);
const enc = B.encode(Buffer.from(out), 'EMBYTECRYPT_ITEM', head.bodyOffset);

// read back: old items unchanged, new items as planned
const back = itemdb.parse(enc);
if (back.count !== count + add.length || back.bytesRead !== back.fileSize || back.stats.failedItems) throw new Error('read back failed');
for (let i = 0; i < count; i++) if (JSON.stringify(recs[i].it) !== JSON.stringify(back.items[i])) throw new Error('existing item changed at ' + i);
for (const it of back.items.slice(count)) {
  const b = it.basic;
  console.log('new', (b.nativeId & 0xffff) + '/' + (b.nativeId >>> 16), b.name, b.comment, 'type', b.itemType, 'flags', b.flags, 'drug', it.drug, 'cure', it.cureVolume);
}
fs.mkdirSync(O, { recursive: true });
fs.writeFileSync(path.join(O, 'item.isf'), enc);
console.log('item.isf', enc.length, 'items', back.count);
console.log('th', addLines(T, path.join(G, 'ItemStrTable.txt'), path.join(O, 'ItemStrTable.txt'), 'IN_998_177', thLines));
console.log('en', addLines(T, path.join(G, 'ItemStrTable_en.txt'), path.join(O, 'ItemStrTable_en.txt'), 'IN_998_177', enLines));
