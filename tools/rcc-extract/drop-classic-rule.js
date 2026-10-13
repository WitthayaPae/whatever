'use strict';
//
// `drop-classic-rule.js` — bring the drop tables that have NO developer original
// down to the rates the originals use for a mob of the same level.
//
//   node drop-classic-rule.js <DEV EP1 dir> <DEV EP9/CLIENT/data dir> <work dir> [--write]
//
// drop-restore-classic.js put back every table whose original exists. What is
// left was written later, in the raised style (fires 75-100%, 3-4% a gear
// group), and the originals stop at level 190. Those are handled here, by the
// pattern of the originals (read from lv02..lv190.genitem, cipher v3):
//
//   mob level   fires   normal weapon / suit   rare weapon / suit   ring-necklace   stone   skill   rolls
//    1-10        50%      0.5  / 0.75            0.5 / 0.5             1              0.3     1      1:98 2:2
//    11-41       35%      0.5  / 0.75            0.5 / 0.5             1              0.3     1      1:98 2:2
//    42-77       30%      0.5  / 0.75            0.75/ 0.5             0.5            0.3     1      1:98 2:2
//    78+         25%      1    / 1               0.25/ 0.35            1              0.5     1      1:97 2:2 3:1
//
// Rules:
//   - NOTHING IS RAISED. Every number becomes min(what it is, the classic one).
//   - potions take what is left of the roll (the originals: 87-95%), shared in
//     the proportion they have now; a table with no potion line gets none added
//   - anything else (materials, boxes, cards, keys) is capped at 1%
//   - question-box lines (QTITEM) and commented lines are not touched
//   - only tables used by ordinary mobs: a table whose mobs have a median HP of
//     BOSS_HP or more is a boss table and is left alone and listed, as is a
//     table no mob uses
//   - the level is the median level of the mobs using the table
//
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { RccArchive } = require('./rcc.js');
const gamecrypt = require('./gamecrypt.js');
const crowdata = require('./crowdata.js');

const BOSS_HP = 250000;
const BOSS_ROLLS = 3;

const args = process.argv.slice(2);
const write = args.includes('--write');
const [ep1Dir, dataDir, workDir] = args.filter((a) => !a.startsWith('--'));
if (!ep1Dir || !dataDir || !workDir) { console.error('usage: node drop-classic-rule.js <DEV EP1> <CLIENT/data> <work dir> [--write]'); process.exit(2); }

const plain = (b) => (gamecrypt.isEncoded(b) ? gamecrypt.decode(b) : b);
const num = (v) => { const x = parseFloat(v); return isFinite(x) ? x : 0; };
const fmt = (x) => String(+x.toFixed(3));
function encode(text) {
  let b = Buffer.from(text, 'latin1');
  if (b.length % 16) b = Buffer.concat([b, Buffer.alloc(16 - b.length % 16, 0x20)]);
  const e = crypto.createCipheriv('aes-256-ecb', gamecrypt.V8_KEY, null); e.setAutoPadding(false);
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

function tier(level) {
  if (level <= 10) return { fire: 50, nW: 0.5, nA: 0.75, rW: 0.5, rA: 0.5, acc: 1, stone: 0.3, book: 1, nums: [[1, 98], [2, 2]] };
  if (level <= 41) return { fire: 35, nW: 0.5, nA: 0.75, rW: 0.5, rA: 0.5, acc: 1, stone: 0.3, book: 1, nums: [[1, 98], [2, 2]] };
  if (level <= 77) return { fire: 30, nW: 0.5, nA: 0.75, rW: 0.75, rA: 0.5, acc: 0.5, stone: 0.3, book: 1, nums: [[1, 98], [2, 2]] };
  return { fire: 25, nW: 1, nA: 1, rW: 0.25, rA: 0.35, acc: 1, stone: 0.5, book: 1, nums: [[1, 97], [2, 2], [3, 1]] };
}

// ---- items: what a spec group or an item id is
const glogic = new RccArchive(path.join(dataDir, 'glogic', 'GLogic.rcc'));
const gRead = (n) => glogic.read(glogic.list().find((x) => x.toLowerCase() === n));
const itemById = new Map(), specPool = new Map();
{
  const lines = plain(gRead('item.csv')).toString('latin1').split(/\r?\n/);
  const h = csvLine(lines[0]); const I = (n) => { const i = h.indexOf(n); if (i < 0) throw new Error('item.csv: no ' + n); return i; };
  const C = { type: I('emItemType'), suit: I('emSuit'), grade: I('emLevel'), spec: I('dwSpecID'), gen: I('bGenEnable') };
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = csvLine(lines[i]);
    const it = { type: +f[C.type], suit: +f[C.suit], grade: +f[C.grade] };
    itemById.set(`${+f[0]}/${+f[1]}`, it);
    if (+f[C.spec] < 999 && +f[C.gen] !== 0) { if (!specPool.has(+f[C.spec])) specPool.set(+f[C.spec], []); specPool.get(+f[C.spec]).push(it); }
  }
}
function kindOf(pool) {
  if (!pool.length) return 'dead';
  const c = {};
  for (const it of pool) {
    let k = 'other';
    if (it.type === 0) k = it.suit === 5 ? 'weapon' : it.suit <= 4 ? 'armor' : it.suit <= 8 ? 'acc' : 'other';
    else if (it.type === 2) k = 'potion'; else if (it.type === 6) k = 'stone'; else if (it.type === 3) k = 'book';
    c[k] = (c[k] || 0) + 1;
  }
  const k = Object.keys(c).sort((a, b) => c[b] - c[a])[0];
  const rare = pool.filter((it) => it.grade >= 1).length * 2 > pool.length;
  return (k === 'weapon' || k === 'armor') ? (rare ? 'rare ' : 'normal ') + k : k;
}

// ---- who uses each table
const crow = crowdata.parse(gRead('crow.mnsf'));
const users = new Map();
for (const c of crow.crows) {
  if (c.emCrow !== 2 || !c.gen) continue;
  for (const f of c.gen.genItem.split(';').map((x) => x.trim().toLowerCase()).filter(Boolean).slice(0, 10)) {
    if (!users.has(f)) users.set(f, []);
    users.get(f).push(c);
  }
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

// ---- which tables have an original
const refDir = path.join(ep1Dir, 'FULLSOURCE', '=Document', 'glogic', 'glogicserver');
const hasOriginal = new Set();
for (const n of fs.readdirSync(refDir)) {
  if (!/\.genitem$/i.test(n)) continue;
  const b = fs.readFileSync(path.join(refDir, n));
  if (b.length >= 20 && b.readInt32LE(0) === 3) hasOriginal.add(n.toLowerCase());
}

const srcRcc = path.join(dataDir, 'glogicserver', 'GLogicServer.rcc');
const server = new RccArchive(srcRcc);
fs.mkdirSync(path.join(workDir, 'files'), { recursive: true });
const report = [], lineReport = [], changed = [];
const count = {};
const tally = (k) => { count[k] = (count[k] || 0) + 1; };

for (const name of server.list()) {
  if (!/\.genitem$/i.test(name)) continue;
  const k = name.toLowerCase();
  if (hasOriginal.has(k)) { tally('has an original (handled by the restore)'); continue; }
  const us = users.get(k);
  if (!us) { tally('no mob uses it: left alone'); continue; }
  const level = median(us.map((c) => c.level)), hp = median(us.map((c) => c.hp));
  const raw = server.read(name);
  if (!gamecrypt.isEncoded(raw)) { tally('unreadable'); continue; }
  const text = plain(raw).toString('latin1').replace(/[\0 ]+$/, '');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const T = tier(level);

  // parse the live lines
  let iRate = -1, rate = 0; const iNums = [], nums = [], ent = [];
  lines.forEach((line, i) => {
    const code = line.split('//')[0];
    const f = code.trim().split(/[\s,{}\[\]()|]+/).filter(Boolean);
    if (!f.length) return;
    const tag = f[0].toUpperCase();
    if (tag === 'GENRATE' && iRate < 0) { iRate = i; rate = num(f[1]); }
    else if (tag === 'GENNUM') { iNums.push(i); nums.push([num(f[1]) | 0, num(f[2])]); }
    else if (tag === 'ITEMSPEC') ent.push({ i, id: 'spec ' + f[1], pct: num(f[2]), kind: kindOf(specPool.get(num(f[1]) >= 999 ? 0 : num(f[1]) | 0) || []) });
    else if (tag === 'ITEMID') { const it = itemById.get(`${num(f[1]) | 0}/${num(f[2]) | 0}`); ent.push({ i, id: `item ${f[1]}/${f[2]}`, pct: num(f[3]), kind: kindOf(it ? [it] : []) }); }
  });
  if (iRate < 0 && !ent.length) { tally('question table only: left alone'); continue; }
  // A boss table is one by its mobs (HP) or by its shape: the originals give
  // ordinary mobs 1.02-1.04 rolls and bosses 3 and more (boss.genitem, tboss).
  const rollsAll = nums.reduce((a, [n, p]) => a + n * p / 100, 0);
  if (hp >= BOSS_HP || rollsAll >= BOSS_ROLLS) {
    tally('boss table: left alone');
    report.push([name, us.length, level, hp, 'boss table: left alone', rate, rate, +rollsAll.toFixed(2), +rollsAll.toFixed(2)]);
    continue;
  }

  // classic value for each line; never above what it is now
  const CAP = { 'normal weapon': T.nW, 'normal armor': T.nA, 'rare weapon': T.rW, 'rare armor': T.rA, acc: T.acc, stone: T.stone, book: T.book, other: 1 };
  let others = 0;
  // A dead line (empty group, missing item) drops nothing and only takes room
  // in the roll: it is commented out, so it cannot push the potions out of reach
  // the way it does in the tables that ran over 100%.
  for (const e of ent) { if (e.kind === 'potion') continue; e.to = e.kind === 'dead' ? 0 : Math.min(e.pct, CAP[e.kind]); others += e.to; }
  const pots = ent.filter((e) => e.kind === 'potion'); const potNow = pots.reduce((a, e) => a + e.pct, 0);
  // the originals give potions 87-95% of a roll; never more than they have now
  const potTo = Math.min(potNow, Math.max(0, Math.min(95, 100 - others)));
  for (const e of pots) e.to = potNow > 0 ? e.pct * potTo / potNow : 0;

  const rollsNow = nums.reduce((a, [n, p]) => a + n * p / 100, 0);
  const rollsClassic = T.nums.reduce((a, [n, p]) => a + n * p / 100, 0);
  const newRate = Math.min(rate, T.fire);
  const newNums = rollsNow > rollsClassic + 1e-9 ? T.nums : nums;

  // rewrite, keeping every comment and the layout of untouched lines
  const setNum = (line, tokenIndex, value) => {
    const cut = line.indexOf('//'); const code = cut < 0 ? line : line.slice(0, cut), rest = cut < 0 ? '' : line.slice(cut);
    let n = -1;
    const out = code.replace(/[^\s,{}\[\]()|]+/g, (tok) => (++n === tokenIndex ? value : tok));
    return (rest && !/\s$/.test(out) ? out + ' ' : out) + rest;
  };
  const before = lines.slice();
  if (iRate >= 0 && newRate !== rate) lines[iRate] = setNum(lines[iRate], 1, fmt(newRate));
  for (const e of ent) if (e.kind === 'dead') lines[e.i] = '//' + lines[e.i];
  for (const e of ent) if (e.kind !== 'dead' && Math.abs(e.to - e.pct) > 1e-9) lines[e.i] = setNum(lines[e.i], e.id.startsWith('item') ? 3 : 2, fmt(e.to));
  if (newNums !== nums) {
    iNums.forEach((i, j) => { lines[i] = j < newNums.length ? `GENNUM\t${newNums[j][0]}\t${newNums[j][1]}` : '//' + lines[i]; });
    if (newNums.length > iNums.length) lines.splice(iNums[iNums.length - 1] + 1, 0, ...newNums.slice(iNums.length).map(([n, p]) => `GENNUM\t${n}\t${p}`));
  }
  const same = lines.length === before.length && lines.every((l, i) => l === before[i]);
  if (same) { tally('already at or under classic'); continue; }

  for (const e of ent) lineReport.push([name, e.id, e.kind, e.pct, +e.to.toFixed(3)]);
  report.push([name, us.length, level, hp, 'lowered to classic', rate, newRate, +rollsNow.toFixed(2), +(newNums === nums ? rollsNow : rollsClassic).toFixed(2)]);
  tally('lowered to classic');
  const out = encode(lines.join(eol) + eol);
  const file = path.join(workDir, 'files', name);
  fs.writeFileSync(file, out);
  changed.push([name, file]);
}

const esc = (v) => { const s = String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = (rows) => rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
fs.writeFileSync(path.join(workDir, 'rule_tables.csv'), csv([['file', 'mobs', 'median level', 'median HP', 'result', 'fires % before', 'fires % after', 'rolls before', 'rolls after'], ...report]));
fs.writeFileSync(path.join(workDir, 'rule_lines.csv'), csv([['file', 'entry', 'kind', '% before', '% after'], ...lineReport]));
console.log(JSON.stringify(count, null, 1));

if (write && changed.length) {
  const out = path.join(workDir, 'GLogicServer.rcc');
  const log = console.log; console.log = () => {};
  try { require('./rcc-pack.js').pack(srcRcc, out, changed); } finally { console.log = log; }
  console.log('packed', out);
}
