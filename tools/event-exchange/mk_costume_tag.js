// "[ทับ]" in front of every costume name (2026-11-02, the user: "some items
// already have the [ทับ] in the name which is the costume ... do that all the
// existing costume ... including the item box if all the items in the box are
// costume"). English gets "[Costume]" in the same place.
//
//   node mk_costume_tag.js <rcc-extract dir> <GLogic.rcc in> <out dir>
//
// Costume = SITEMBASIC dwFlags & ITEM_DISGUISE (0x10). A box (ITEM_BOX 12 by
// sITEMS, ITEM_RANDOMITEM 22 by vecBOX with a rate) is tagged when every item
// in it is a costume. Skipped: names already carrying the tag, and the
// placeholder / staff items (Blank, GM, BETA, Temp, test).
//
// Writes <out dir>/ItemStrTable.txt, ItemStrTable_en.txt, GLogic.rcc and
// changed.tsv. The tag bytes are put in front of the name's own bytes; every
// other byte of both tables is checked unchanged after re-encoding.
const [, , T, RCC, OUT] = process.argv;
const fs = require('fs');
const path = require('path');
const itemdb = require(T + '/itemdb.js');
const { RccArchive } = require(T + '/rcc.js');
const g = require(T + '/gamecrypt.js');
const { pack } = require(T + '/rcc-pack.js');
const { enc874, encodeV8 } = require(__dirname + '/strtab.js');

fs.mkdirSync(OUT, { recursive: true });
const arc = new RccArchive(RCC);
const entry = (n) => { const e = arc.list().find((x) => x.toLowerCase() === n.toLowerCase()); if (!e) throw new Error('not in GLogic.rcc: ' + n); return e; };
const plain = (b) => (g.isEncoded(b) ? g.decode(b) : b);
const dec874 = new TextDecoder('windows-874');

const MARK_TH = '[ทับ]', MARK_EN = '[Costume]';
const SKIP = /^Blank|GM|BETA|Temp|temp|TEST|test/;

//	Items.
const items = new Map();
for (const it of itemdb.parse(arc.read(entry('item.isf'))).items) {
  if (!it.basic) continue;
  items.set((it.basic.nativeId & 0xffff) + '/' + (it.basic.nativeId >>> 16), it.basic);
}
const isCost = (b) => (b.flags & 0x10) !== 0;

//	Box contents (item.csv).
const csv = plain(arc.read(entry('item.csv'))).toString('latin1').split(/\r?\n/);
const H = csv[0].split(',');
const col = (n) => H.indexOf(n);
const colsOf = (p, rate) => { const r = []; for (let i = 0; i < 40; i++) { const a = col(`${p} ${i} nidITEM wMainID`), b = col(`${p} ${i} nidITEM wSubID`), f = rate ? col(`${p} ${i} fRATE`) : -1; if (a >= 0 && b >= 0) r.push([a, b, f]); } return r; };
const c12 = colsOf('sITEMS', false), c22 = colsOf('vecBOX', true), TI = col('emItemType');
if (!c12.length || !c22.length || TI < 0) throw new Error('csv columns missing');
const contents = new Map();
for (const l of csv.slice(1)) {
  const c = l.split(','); if (c.length < 10) continue;
  const list = [];
  for (const [a, b, f] of (c[TI] === '22' ? c22 : c12)) {
    if (f >= 0 && !(+c[f] > 0)) continue;
    const m = +c[a], s = +c[b];
    if (!isNaN(m) && !isNaN(s) && m !== 65535 && s !== 65535) list.push(m + '/' + s);
  }
  contents.set(c[0] + '/' + c[1], list);
}

//	Name tables as raw lines (bytes kept as latin1 so nothing is re-encoded).
const readTable = (name) => plain(arc.read(entry(name))).toString('latin1');
const rawTH = readTable('ItemStrTable.txt'), rawEN = readTable('ItemStrTable_en.txt');
const valueMap = (raw, cp) => { const m = new Map(); for (const l of raw.split('\r\n')) { const i = l.indexOf('\t'); if (i > 0 && !m.has(l.slice(0, i))) m.set(l.slice(0, i), cp ? dec874.decode(Buffer.from(l.slice(i + 1), 'latin1')) : l.slice(i + 1)); } return m; };
const nTH = valueMap(rawTH, true), nEN = valueMap(rawEN, false);

//	Targets.
const targets = new Map();      // key -> [id, kind]
for (const [id, b] of items) {
  let kind = null;
  if (isCost(b)) kind = 'costume';
  else if (b.itemType === 12 || b.itemType === 22) {
    const list = (contents.get(id) || []).filter((x) => items.has(x));
    if (list.length && list.every((x) => isCost(items.get(x)))) kind = 'box';
  }
  if (!kind || !b.name) continue;
  const th = nTH.get(b.name);
  if (th === undefined || SKIP.test(th)) continue;
  if (!targets.has(b.name)) targets.set(b.name, [id, kind]);
}

const tagTH = Buffer.from(enc874(MARK_TH)).toString('latin1');
const changed = [];
function retag(raw, isTH) {
  const body = raw.replace(/[\0 ]+$/, '');
  const lines = body.split('\r\n');
  const seen = new Set();
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].indexOf('\t'); if (t <= 0) continue;
    const key = lines[i].slice(0, t);
    //	A name that has the tag later on gets it moved to the front (the user,
    //	2026-11-02: "if some have [ทับ] in the back you can cut it and put in
    //	the front"). Names only (IN_); a description keeps its wording.
    if (isTH && key.startsWith('IN_')) {
      const v = lines[i].slice(t + 1), at = v.indexOf(tagTH);
      if (at > 0) {
        lines[i] = key + '\t' + tagTH + v.slice(0, at) + v.slice(at + tagTH.length);
        n++;
        changed.push(['TH', '', 'moved', key, dec874.decode(Buffer.from(v, 'latin1'))]);
        seen.add(key);
        continue;
      }
    }
    if (!targets.has(key) || seen.has(key)) continue;
    seen.add(key);
    const v = lines[i].slice(t + 1);
    const text = isTH ? dec874.decode(Buffer.from(v, 'latin1')) : v;
    if (isTH ? text.includes(MARK_TH) : text.startsWith(MARK_EN)) continue;
    lines[i] = key + '\t' + (isTH ? tagTH : MARK_EN) + v;
    n++;
    changed.push([isTH ? 'TH' : 'EN', ...targets.get(key), key, text]);
  }
  return { out: lines.join('\r\n'), n, body };
}

function write(name, raw, isTH) {
  const { out, n, body } = retag(raw, isTH);
  const enc = encodeV8(g, Buffer.from(out, 'latin1'));
  //	Read back: same line count, only the target lines differ, each by the tag alone.
  const back = g.decode(enc).toString('latin1').replace(/[\0 ]+$/, '').split('\r\n');
  const before = body.split('\r\n');
  if (back.length !== before.length) throw new Error(name + ': line count changed');
  const tag = isTH ? tagTH : MARK_EN;
  let diff = 0;
  for (let i = 0; i < before.length; i++) {
    if (back[i] === before[i]) continue;
    const t = before[i].indexOf('\t');
    const v = before[i].slice(t + 1), at = isTH ? v.indexOf(tag) : -1;
    const added = before[i].slice(0, t + 1) + tag + v;
    const moved = at > 0 ? before[i].slice(0, t + 1) + tag + v.slice(0, at) + v.slice(at + tag.length) : null;
    if (back[i] !== added && back[i] !== moved) throw new Error(name + ': unexpected change at line ' + (i + 1));
    diff++;
  }
  if (diff !== n) throw new Error(name + ': changed ' + diff + ' expected ' + n);
  fs.writeFileSync(path.join(OUT, name), enc);
  console.log(name, 'tagged', n, 'of', before.length, 'lines');
}
write('ItemStrTable.txt', rawTH, true);
write('ItemStrTable_en.txt', rawEN, false);

fs.writeFileSync(path.join(OUT, 'changed.tsv'), 'table\tid\tkind\tkey\told name\n' + changed.map((r) => r.join('\t')).join('\n') + '\n');
pack(RCC, path.join(OUT, 'GLogic.rcc'), [
  [entry('ItemStrTable.txt'), path.join(OUT, 'ItemStrTable.txt')],
  [entry('ItemStrTable_en.txt'), path.join(OUT, 'ItemStrTable_en.txt')],
]);
console.log('targets', targets.size, '| written to', OUT);
