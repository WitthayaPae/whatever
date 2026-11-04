// Descriptions for the pet skill books (2026-10-31, the user: "some item that
// really need the description like pet skill book"). Every ITEM_PET_SKILL (40)
// item already points at an ID_ key; the string tables had no line for it, so
// the tooltip showed nothing. Each line says which pet skill the book teaches
// (the skill's own SN_/SD_ text, SkillStrTable) and how to use it.
//
//   node mk_petbook_desc.js <rcc-extract dir> <GLogic.rcc in> <out dir>
//
// Writes <out dir>/ItemStrTable.txt, ItemStrTable_en.txt and GLogic.rcc (both
// replaced). A key that already has a line is left alone (strtab refuses it).
const T = process.argv[2];
const fs = require('fs');
const path = require('path');
const itemdb = require(T + '/itemdb.js');
const B = require(T + '/bytecrypt.js');
const { RccArchive } = require(T + '/rcc.js');
const gamecrypt = require(T + '/gamecrypt.js');
const { pack } = require(T + '/rcc-pack.js');
const { addLines } = require(__dirname + '/strtab.js');

const [, , , RCC, OUTDIR] = process.argv;
fs.mkdirSync(OUTDIR, { recursive: true });
const arc = new RccArchive(RCC);
const entry = (n) => { const e = arc.list().find((x) => x.toLowerCase() === n.toLowerCase()); if (!e) throw new Error('not in GLogic.rcc: ' + n); return e; };
const plain = (b) => (gamecrypt.isEncoded(b) ? gamecrypt.decode(b) : b);
const table = (name, cp) => {
  const t = cp === 874 ? new TextDecoder('windows-874').decode(plain(arc.read(entry(name)))) : plain(arc.read(entry(name))).toString('latin1');
  const m = new Map();
  for (const l of t.split(/\r?\n/)) { const i = l.indexOf('\t'); if (i > 0) m.set(l.slice(0, i), l.slice(i + 1)); }
  return m;
};

//	The books and the skill each teaches (SITEM::sSkillBookOp.sSkill_ID).
const raw = arc.read(entry('item.isf'));
const isf = itemdb.parse(raw);
const csv = plain(arc.read(entry('item.csv'))).toString('latin1').split(/\r?\n/);
const H = csv[0].split(',');
const ti = H.indexOf('emItemType'), si = H.indexOf('sSkill_ID wMainID');
if (ti < 0 || si < 0) throw new Error('csv columns missing');
const skillOf = new Map();
for (const l of csv.slice(1)) { const c = l.split(','); if (c[ti] === '40') skillOf.set(c[0] + '/' + c[1], [+c[si], +c[si + 1]]); }

const skTH = table('SkillStrTable.txt', 874), skEN = table('SkillStrTable_en.txt', 1252);
const itTH = table('ItemStrTable.txt', 874), itEN = table('ItemStrTable_en.txt', 1252);
const pad = (n) => String(n).padStart(3, '0');

const th = [], en = [];
for (const it of isf.items) {
  if (!it.basic || it.basic.itemType !== 40) continue;
  const id = (it.basic.nativeId & 0xffff) + '/' + (it.basic.nativeId >>> 16);
  const key = it.basic.comment;
  const sk = skillOf.get(id);
  if (!key || !sk) { console.log('skip', id, 'no key or no skill'); continue; }
  const sKey = pad(sk[0]) + '_' + pad(sk[1]);
  const nTH = skTH.get('SN_' + sKey), dTH = skTH.get('SD_' + sKey);
  const nEN = skEN.get('SN_' + sKey), dEN = skEN.get('SD_' + sKey);
  if (!nTH || !dTH) { console.log('skip', id, 'skill text missing', sKey); continue; }
  const lineTH = `คัมภีร์สกิลสัตว์เลี้ยง: สอนสกิล ${nTH} - ${dTH} วิธีใช้: เรียกสัตว์เลี้ยงออกมา แล้วกดใช้คัมภีร์นี้ในกระเป๋า (สัตว์เลี้ยงที่เรียนสกิลนี้แล้ว ใช้ซ้ำไม่ได้)`;
  const lineEN = `Pet skill book: teaches ${nEN || nTH} - ${dEN || ''} How to use: summon your pet, then use this book from your bag (a pet that already knows the skill cannot learn it again)`;
  //  After the item's own name line, or at the end of a table that has none.
  const lastTH = [...itTH.keys()].pop(), lastEN = [...itEN.keys()].pop();
  if (!itTH.has(key)) th.push([key, lineTH, itTH.has(it.basic.name) ? it.basic.name : lastTH]);
  if (!itEN.has(key)) en.push([key, lineEN, itEN.has(it.basic.name) ? it.basic.name : lastEN]);
  console.log(id, key, '->', nTH, `(${sKey})`);
}

//	Each line right after its item's own name line (IN_), one insertion at a time.
function apply(file, list, outName) {
  let cur = path.join(OUTDIR, outName + '.0');
  fs.writeFileSync(cur, arc.read(entry(file)));
  let n = 0;
  for (const [key, line, after] of list) {
    const next = path.join(OUTDIR, outName + '.' + (++n));
    addLines(T, cur, next, after, [[key, line]]);
    fs.unlinkSync(cur);
    cur = next;
  }
  fs.renameSync(cur, path.join(OUTDIR, outName));
  console.log(file, '+', n, 'lines');
}
apply('ItemStrTable.txt', th, 'ItemStrTable.txt');
apply('ItemStrTable_en.txt', en, 'ItemStrTable_en.txt');

pack(RCC, path.join(OUTDIR, 'GLogic.rcc'), [
  [entry('ItemStrTable.txt'), path.join(OUTDIR, 'ItemStrTable.txt')],
  [entry('ItemStrTable_en.txt'), path.join(OUTDIR, 'ItemStrTable_en.txt')],
]);
console.log('GLogic.rcc written to', OUTDIR);
