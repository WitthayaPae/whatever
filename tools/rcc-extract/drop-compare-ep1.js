'use strict';
//
// `drop-compare-ep1.js` — the same drop sums as drop-report.js, run over the
// EP1 data kept beside this tree, so today's tables can be put next to the
// ones they came from.
//
//   node drop-compare-ep1.js <DEV EP1 dir> <DEV EP9/CLIENT/data dir> <out dir>
//
// EP1 inputs (all loose files):
//   CLIENT/data/glogic/mobEP1.csv, itemEp1.csv      mob and item exports
//   CLIENT/data/glogicserver/*.genitem               cipher v5  ("ep1")
//   FULLSOURCE/=Document/glogic/glogicserver/*.genitem   cipher v3  ("ref",
//                                                    the older reference set)
// Each genitem set is priced against the EP1 mobs and items, which is the only
// item table its spec ids were written for.
//
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { RccArchive } = require('./rcc.js');
const gamecrypt = require('./gamecrypt.js');

const [ep1Dir, ep9Data, outDir] = process.argv.slice(2);
if (!ep1Dir || !ep9Data || !outDir) { console.error('usage: node drop-compare-ep1.js <DEV EP1> <DEV EP9/CLIENT/data> <out>'); process.exit(2); }

// CRijndael::Initialize: version >= 5 runs the key through (b ^ 0x21) + 0x31.
const KEYS = {
  3: Buffer.from('skrkrhtlvdj!@#wpfrmfjgrpgo!@#$qk', 'latin1'),
  5: Buffer.from(Buffer.from('zFYf*5k!@#SkyN%t%$fhju!@3f*5z47#', 'latin1').map((b) => ((b ^ 0x21) + 0x31) & 0xff)),
  8: gamecrypt.V8_KEY,
};
function decodeText(buf) {
  const v = buf.length >= 20 ? buf.readInt32LE(0) : 0;
  if (!KEYS[v]) return null;
  const p = buf.subarray(4); const whole = p.length - p.length % 16;
  const d = crypto.createDecipheriv('aes-256-ecb', KEYS[v], null); d.setAutoPadding(false);
  return Buffer.concat([d.update(p.subarray(0, whole)), d.final()]).toString('latin1').replace(/\0+$/, '');
}

const num = (v) => { const x = parseFloat(v); return isFinite(x) ? x : 0; };
const tokens = (line) => line.split('//')[0].trim().split(/[\s,{}\[\]()|]+/).filter((x) => x !== '');
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
function readCsv(file) {
  const lines = fs.readFileSync(file).toString('latin1').split(/\r?\n/).filter(Boolean);
  const head = csvLine(lines[0]);
  const col = (name, nth = 0) => { let k = -1; for (let i = 0; i < head.length; i++) if (head[i].trim() === name && ++k === nth) return i; throw new Error(path.basename(file) + ': no column ' + name); };
  return { rows: lines.slice(1).map(csvLine), col };
}

const GROUPS = ['Weapon', 'Armor', 'Accessory', 'Upgrade stone', 'Potion', 'Skill book', 'Question box', 'Other'];
function group(type, suit) {
  if (type === 0) return suit === 5 ? 'Weapon' : suit <= 4 ? 'Armor' : suit <= 8 ? 'Accessory' : 'Other';
  return { 6: 'Upgrade stone', 2: 'Potion', 3: 'Skill book', 26: 'Question box' }[type] || 'Other';
}

function parseTable(text) {
  const t = { genRate: 0, nums: [], entries: [], qt: [], saw: false };
  for (const line of text.split(/\r?\n/)) {
    const f = tokens(line); if (!f.length) continue;
    const tag = f[0].toUpperCase();
    if (tag === 'GENRATE' && !t.saw) { t.genRate = num(f[1]); t.saw = true; }
    else if (tag === 'GENNUM' && t.nums.length < 5) t.nums.push({ n: num(f[1]) | 0, pct: num(f[2]) });
    else if (tag === 'ITEMSPEC') t.entries.push({ spec: num(f[1]) | 0, pct: num(f[2]) });
    else if (tag === 'ITEMID') t.entries.push({ mid: num(f[1]) | 0, sid: num(f[2]) | 0, pct: num(f[3]) });
    else if (tag === 'QTITEM' && t.qt.length < 20) t.qt.push({ mid: num(f[1]) | 0, sid: num(f[2]) | 0, pct: num(f[3]) });
  }
  const z = t.nums.findIndex((x) => x.n === 0); if (z >= 0) t.nums.length = z;
  t.rolls = t.nums.reduce((a, x) => a + x.n * x.pct / 100, 0);
  return t;
}

// what one kill of a mob gives, per group, for a world = { items, specItems, tables(name) }
function mobDrops(world, mob, lowerScale) {
  const g = Object.fromEntries(GROUPS.map((k) => [k, 0])); let rare = 0, fits = 0, equip = 0;
  const add = (it, exp) => {
    if (!it) return;
    const k = group(it.type, it.suit); g[k] += exp;
    if (it.grade >= 1) rare += exp;
    if (k === 'Weapon' || k === 'Armor' || k === 'Accessory') { equip += exp; if (it.req <= mob.level + 10 && it.req >= mob.level - 30) fits += exp; }
  };
  if (mob.itemRate && mob.itemId) add(world.items.get(mob.itemId), Math.min(1, mob.itemRate / 100));
  for (const f of mob.files) {
    const t = world.table(f); if (!t) continue;
    const fire = Math.min(1, t.genRate / 100); let cum = 0;
    for (const e of [...t.entries].sort((a, b) => a.pct - b.pct)) {
      const w = (lowerScale !== 1 && e.pct < 2) ? e.pct * lowerScale : e.pct;
      const reach = Math.max(0, Math.min(w, 100 - cum)); cum += w;
      const exp = fire * t.rolls * reach / 100;
      if (e.spec !== undefined) { const pool = world.specItems.get(e.spec) || []; for (const it of pool) add(it, exp / pool.length); }
      else add(world.items.get(`${e.mid}/${e.sid}`), exp);
    }
  }
  if (mob.qt) { const t = world.table(mob.qt); if (t && t.qt.reduce((a, x) => a + x.pct, 0) <= 100) for (const e of t.qt) add(world.items.get(`${e.mid}/${e.sid}`), e.pct / 100); }
  return { g, rare, fits, equip };
}

function family(files) {
  if (!files.length) return 'other';
  const k = new Set();
  for (const f of files) {
    const x = /^lv\d+([A-Za-z_]*)\.genitem$/i.exec(f);
    if (!x) return 'other';
    const s = x[1].toLowerCase();
    k.add(s.includes('leader') ? 'leader' : (['', 'j', 'a', 'b', 'c'].includes(s) ? 'normal' : 'elite'));
  }
  return k.size === 1 ? [...k][0] : 'elite';
}

// ------------------------------------------------------------------ EP1 world
const gl = path.join(ep1Dir, 'CLIENT', 'data', 'glogic');
const items = new Map(), specItems = new Map();
{
  const { rows, col } = readCsv(path.join(gl, 'itemEp1.csv'));
  const C = { mid: col('sNativeID wMainID'), sid: col('sNativeID wSubID'), grade: col('emLevel'), type: col('emItemType'), req: col('wReqLevelDW'), suit: col('emSuit'), spec: col('dwSpecID'), gen: col('bGenEnable') };
  for (const f of rows) {
    const it = { id: `${+f[C.mid]}/${+f[C.sid]}`, grade: +f[C.grade], type: +f[C.type], req: +f[C.req], suit: +f[C.suit], spec: +f[C.spec], gen: +f[C.gen] !== 0 };
    items.set(it.id, it);
    if (it.gen) { if (!specItems.has(it.spec)) specItems.set(it.spec, []); specItems.get(it.spec).push(it); }
  }
}
const mobs = [];
{
  const { rows, col } = readCsv(path.join(gl, 'mobEP1.csv'));
  const C = { mid: col('sNativeID wMainID'), sid: col('sNativeID wSubID'), name: col('szName'), crow: col('emCrow'), level: col('wLevel'), hp: col('dwHP'),
    gi: col('strGenItem'), qt: col('strQtGenItem'), ir: col('wGenItem_Rate'), im: col('sGenItemID wMainID'), is: col('sGenItemID wSubID') };
  for (const f of rows) {
    if (+f[C.crow] !== 2) continue;
    const files = f[C.gi].split(';').map((x) => x.trim()).filter(Boolean).slice(0, 10);
    mobs.push({ id: `${+f[C.mid]}/${+f[C.sid]}`, name: f[C.name], level: +f[C.level], hp: +f[C.hp], files, qt: f[C.qt].trim(),
      itemRate: +f[C.ir], itemId: (+f[C.im] === 65535 ? '' : `${+f[C.im]}/${+f[C.is]}`) });
  }
}
function looseSet(dir) {
  const names = new Map(); for (const n of fs.readdirSync(dir)) if (/\.genitem$/i.test(n)) names.set(n.toLowerCase(), n);
  const cache = new Map(), text = new Map();
  const get = (n) => { const k = n.trim().toLowerCase(); if (!text.has(k)) text.set(k, names.has(k) ? decodeText(fs.readFileSync(path.join(dir, names.get(k)))) : null); return text.get(k); };
  return { names, text: get, table: (n) => { const k = n.trim().toLowerCase(); if (!cache.has(k)) { const t = get(k); cache.set(k, t ? parseTable(t) : null); } return cache.get(k); } };
}
const setEp1 = looseSet(path.join(ep1Dir, 'CLIENT', 'data', 'glogicserver'));
const setRef = looseSet(path.join(ep1Dir, 'FULLSOURCE', '=Document', 'glogic', 'glogicserver'));
const arc = new RccArchive(path.join(ep9Data, 'glogicserver', 'GLogicServer.rcc.bak_pre_dropclean'));
const ep9Names = new Map(); for (const n of arc.list()) if (/\.genitem$/i.test(n)) ep9Names.set(n.toLowerCase(), n);
const ep9Text = (k) => (ep9Names.has(k) ? decodeText(arc.read(ep9Names.get(k))) : null);

// ------------------------------------------------------------------ are the tables the same text?
const norm = (t) => (t === null ? null : t.split(/\r?\n/).map((l) => tokens(l).join(' ')).filter(Boolean).join('\n'));
const cmp = (a, b, keys) => { const r = { same: 0, differ: 0, onlyA: 0, differNames: [] }; for (const k of keys) { const x = norm(a(k)), y = norm(b(k)); if (x === null) continue; if (y === null) r.onlyA++; else if (x === y) r.same++; else { r.differ++; if (r.differNames.length < 400) r.differNames.push(k); } } return r; };
const c1 = cmp(ep9Text, setEp1.text, [...ep9Names.keys()]);
const c2 = cmp(setEp1.text, setRef.text, [...setEp1.names.keys()]);
const used = new Set(mobs.flatMap((m) => [...m.files, m.qt]).filter(Boolean).map((x) => x.toLowerCase()));
console.log('EP9 (before today) vs EP1 server set:', JSON.stringify({ same: c1.same, differ: c1.differ, ep9Only: c1.onlyA }));
console.log('EP1 server set vs EP1 reference set :', JSON.stringify({ same: c2.same, differ: c2.differ, serverOnly: c2.onlyA }), 'differing files used by EP1 mobs:', c2.differNames.filter((n) => used.has(n)).length);
console.log('EP1 mobs', mobs.length, 'items', items.size, 'spec groups', specItems.size, 'max mob level', Math.max(...mobs.map((m) => m.level)));

// ------------------------------------------------------------------ band tables
const bands = [[0, 20], [21, 50], [51, 100], [101, 150], [151, 200], [201, 260], [261, 99999]];
function bandTable(world, pick, lowerScale) {
  return bands.map(([lo, hi]) => {
    const ms = mobs.filter((m) => m.level >= lo && m.level <= hi && pick(m));
    const sum = Object.fromEntries(GROUPS.map((k) => [k, 0])); let rare = 0, fits = 0, equip = 0;
    for (const m of ms) { const d = mobDrops(world, m, lowerScale); for (const k of GROUPS) sum[k] += d.g[k]; rare += d.rare; fits += d.fits; equip += d.equip; }
    const n = ms.length || 1;
    return { band: hi > 9999 ? '261+' : `${lo}–${hi}`, mobs: ms.length, ...Object.fromEntries(GROUPS.map((k) => [k, sum[k] / n * 100])), rare: rare / n * 100, fit: equip ? fits / equip * 100 : NaN };
  });
}
function box(title, rows) {
  const heads = ['Mob level', 'Mobs', ...GROUPS.slice(0, 7), 'Rare or better', 'Gear fits level %'];
  const body = rows.map((r) => [r.band, String(r.mobs), ...GROUPS.slice(0, 7).map((k) => r[k].toFixed(2)), r.rare.toFixed(2), isNaN(r.fit) ? '-' : r.fit.toFixed(0)]);
  const w = heads.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)) + 2);
  const line = (l, m, r) => l + w.map((x) => '─'.repeat(x)).join(m) + r;
  const row = (c) => '│' + c.map((x, i) => ' ' + x.padEnd(w[i] - 1)).join('│') + '│';
  return [title, line('┌', '┬', '┐'), row(heads), ...body.flatMap((b) => [line('├', '┼', '┤'), row(b)]), line('└', '┴', '┘')].join('\n');
}
const world = (set) => ({ items, specItems, table: set.table });
const isNormal = (m) => family(m.files) === 'normal';
const out = [
  box('EP1 SERVER SET, all mobs (scale 1, low-rate scale 1)', bandTable(world(setEp1), () => true, 1)),
  box('EP1 SERVER SET, normal mobs only (lvNN tables)', bandTable(world(setEp1), isNormal, 1)),
  box('EP1 REFERENCE SET, all mobs', bandTable(world(setRef), () => true, 1)),
  box('EP1 REFERENCE SET, normal mobs only (lvNN tables)', bandTable(world(setRef), isNormal, 1)),
].join('\n\n');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'ep1_drop_tables.txt'), out + '\n', 'utf8');
fs.writeFileSync(path.join(outDir, 'ep1_tables_changed_vs_reference.txt'), c2.differNames.join('\r\n') + '\r\n');
process.stdout.write(Buffer.from(out + '\n', 'utf8'));
