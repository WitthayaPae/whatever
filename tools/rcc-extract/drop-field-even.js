'use strict';
//
// `drop-field-even.js` — set weapon and armor of every normal field table to
// the same drop per 100 kills (SET below), raised or lowered.
//
//   node drop-field-even.js <CLIENT/data dir> <report dir> <work dir> [--write]
//
// <report dir> is drop-report.js output for the same data (spec_groups.csv for
// what each spec holds, drops_by_mob.csv for which monsters use which table).
//
// Field table: lv*, osaka*, Infinitystairs*, gmd_* used by at least one monster,
// not a *_leader, *boss* or *treasure* table. Its level is the median level of
// the monsters using it.
//
// What a table gives per 100 kills, per category, is worked out the way the
// server does it (GLCrowDataLoad.cpp SGENITEM::LOADFILE, GLCrowData.cpp
// SELECTNUM / SELECTSPECID): GENNUM ranges stacked and rolled 0..100; ITEMSPEC
// lines sorted by rate, ascending; a line under 2% counts x
// fITEM_DROP_LOWER_SCALE; the stack is cut at 100%; times min(1, GENRATE/100).
//
// Weapon and armor: a table inside [LO, HI] per 100 kills is left as it is; one
// outside has its existing weapon (armor) lines scaled to the nearer edge,
// counting what the mixed groups (weapons and other items in one spec) give.
// No line is added: a table the game made without weapons or armor keeps none.
// Every other line keeps its rate. Lines whose spec holds no drop-enabled item are commented out: they
// drop nothing, and in a table over 100% they push real lines past the cut.
// Fitting in 100%: potions give way first (not below the lower of 52.49 and
// what they gave before); then GENRATE is raised as little as needed, with the
// other lines lowered so they drop as often as before (within 5%: a line at
// exactly 2% cannot go a little lower, the 0.7 scale starts there); at GENRATE
// 100 the change is scaled back. No table ends over 100% or over 30 lines.
//
// Without --write it only reports. With it, the changed tables are packed into
// <work dir>/GLogicServer.rcc; the archive in the data dir is not replaced.
//
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { RccArchive } = require('./rcc.js');
const gamecrypt = require('./gamecrypt.js');

// Weapon and armor: 5 per 100 kills (user, 2026-10-14: "about 5", which is what the
// EP1 and original EP9 normal tables give).
// A table already inside [LO, HI] is left as it is; one outside is moved to the
// nearer edge (user, 2026-10-14: "between 4.30 to 5.30").
const SET = { Weapon: true, Armor: true };
const LO = 4.3, HI = 5.3;
const CATS = ['Weapon', 'Armor', 'Acc', 'Stone', 'Potion', 'Book'];
const POTION_FLOOR = 52.49;
const STONE_SPEC = 191, MAX_LINES = 30, FULL = 99.99;

const args = process.argv.slice(2);
const write = args.includes('--write');
const [dataDir, repDir, workDir] = args.filter((a) => !a.startsWith('--'));
if (!dataDir || !repDir || !workDir) { console.error('usage: node drop-field-even.js <CLIENT/data> <report dir> <work dir> [--write]'); process.exit(2); }

const plain = (b) => (gamecrypt.isEncoded(b) ? gamecrypt.decode(b) : b);
const num = (v) => { const x = parseFloat(v); return isFinite(x) ? x : 0; };
const tokens = (line) => line.split('//')[0].trim().split(/[\s,{}\[\]()|]+/).filter((x) => x !== '');
const fmt = (v) => String(+v.toFixed(4));
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
const readCsv = (f) => { const L = fs.readFileSync(f, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map(csvLine); const h = L[0]; return L.slice(1).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]]))); };
function encode(text) {
  let b = Buffer.from(text, 'latin1');
  if (b.length % 16) b = Buffer.concat([b, Buffer.alloc(16 - b.length % 16, 0x20)]);
  const e = crypto.createCipheriv('aes-256-ecb', gamecrypt.V8_KEY, null);
  e.setAutoPadding(false);
  const head = Buffer.alloc(4); head.writeInt32LE(gamecrypt.VERSION, 0);
  return Buffer.concat([head, e.update(b), e.final()]);
}

// low-rate scale
let LOWER = 1;
{
  const g = new RccArchive(path.join(dataDir, 'glogic', 'GLogic.rcc'));
  const cc = g.list().find((n) => n.toLowerCase() === 'default.charclass');
  for (const line of plain(g.read(cc)).toString('latin1').split(/\r?\n/)) { const t = tokens(line); if (t[0] === 'fITEM_DROP_LOWER_SCALE') LOWER = parseFloat(t[1]); }
  if (!(LOWER > 0)) throw new Error('fITEM_DROP_LOWER_SCALE not found');
}
const eff = (v) => (LOWER !== 1 && v < 2 ? v * LOWER : v);

// what each spec holds
const typeCat = (t) => {
  if (/^Weapon/.test(t)) return 'Weapon';
  if (/^Armor: Head/.test(t)) return 'Head';
  if (/^Armor/.test(t)) return 'Armor';
  if (/^Accessory/.test(t)) return 'Acc';
  if (/^Potion/.test(t)) return 'Potion';
  if (/^Skill book/.test(t)) return 'Book';
  return 'Other';
};
const specCat = new Map(), specInfo = new Map();
for (const r of readCsv(path.join(repDir, 'spec_groups.csv'))) {
  const id = +r['spec id'];
  specInfo.set(id, { items: +r.items, max: +r['req level max'] });
  if (id === STONE_SPEC) { specCat.set(id, 'Stone'); continue; }
  const cs = new Set(r.types.split(' | ').map(typeCat));
  const c = cs.size === 1 ? [...cs][0] : 'Mixed';
  specCat.set(id, c === 'Head' ? 'Other' : c);
}
const live = (id) => specInfo.has(id) && specInfo.get(id).items > 0;

// share of each category inside a spec (an item is taken evenly from the spec,
// GLItemMan::RendomGenSpecID), from the report's own item list
const specShare = new Map();
{
  const seen = new Map();
  for (const r of readCsv(path.join(repDir, 'drops_detail.csv'))) {
    const m = /^spec (\d+)/.exec(r.note || ''); if (!m) continue;
    const id = +m[1]; if (!seen.has(id)) seen.set(id, new Map());
    seen.get(id).set(r['item id'], typeCat(r.type));
  }
  for (const [id, items] of seen) {
    const sh = {}; for (const c of items.values()) sh[c] = (sh[c] || 0) + 1 / items.size;
    specShare.set(id, sh);
  }
}
const shareOf = (l, c) => (l.cat === c ? 1 : l.cat === 'Mixed' ? ((specShare.get(l.id) || {})[c] || 0) : 0);

// which tables are field tables, and their level
const FIELD = /^(lv\d|osaka|infinitystairs|gmd_)/i;
const users = new Map();
for (const m of readCsv(path.join(repDir, 'drops_by_mob.csv'))) {
  if (m.kind !== 'MOB' || !/^\d+$/.test(m.level)) continue;
  for (const f of (m['drop files'] || '').split(';').map((x) => x.trim()).filter(Boolean)) {
    if (!FIELD.test(f) || /_leader|boss|treasure/i.test(f)) continue;
    const k = f.toLowerCase(); if (!users.has(k)) users.set(k, []); users.get(k).push(+m.level);
  }
}
const levelOf = (k) => { const a = users.get(k).slice().sort((x, y) => x - y); return a[a.length >> 1]; };

// parse every field table
const srcRcc = path.join(dataDir, 'glogicserver', 'GLogicServer.rcc');
const server = new RccArchive(srcRcc);
function parse(lines) {
  const t = { gen: 0, sawGen: false, nums: [], spec: [], nId: 0, idPct: 0 };
  lines.forEach((line, i) => {
    const f = tokens(line); if (!f.length) return;
    const tag = f[0].toUpperCase();
    if (tag === 'GENRATE' && !t.sawGen) { t.gen = num(f[1]); t.sawGen = true; }
    else if (tag === 'GENNUM' && t.nums.length < 5) t.nums.push({ n: num(f[1]) | 0, pct: num(f[2]) });
    else if (tag === 'ITEMSPEC') { const id = num(f[1]) >= 999 ? 0 : num(f[1]) | 0; t.spec.push({ i, id, pct: num(f[2]), cat: specCat.get(id) || 'Other', dead: !live(id) }); }
    else if (tag === 'ITEMID') { t.nId++; t.idPct += num(f[3]); }
  });
  const z = t.nums.findIndex((x) => x.n === 0); if (z >= 0) t.nums.length = z;
  // stacked ranges, rolled 0..100 (same as drop-report.js)
  { let lo = 0; t.rolls = 0; for (const x of t.nums) { const hi = lo + x.pct; t.rolls += x.n * Math.max(0, Math.min(hi, 100) - Math.min(lo, 100)) / 100; lo = hi; } }
  return t;
}
const T = [];
for (const name of server.list()) {
  const k = name.toLowerCase();
  if (!users.has(k)) continue;
  const raw = server.read(name);
  if (!gamecrypt.isEncoded(raw)) throw new Error(name + ': not v8');
  const text = plain(raw).toString('latin1').replace(/\0+$/, '');
  const lines = text.split(/\r?\n/);
  T.push({ name, k, level: levelOf(k), eol: text.includes('\r\n') ? '\r\n' : '\n', lines, ...parse(lines) });
}

// what a set of lines gives per 100 kills, per category, the way the loader stacks them
const Fof = (t, gen) => Math.min(1, gen / 100) * t.rolls;
function perCat(t, lines, gen) {
  const o = {}; for (const c of CATS) o[c] = 0;
  let cum = 0;
  for (const l of lines.slice().sort((a, b) => a.pct - b.pct)) {
    const w = eff(l.pct), reach = Math.max(0, Math.min(w, 100 - cum)); cum += w;
    if (!l.dead) for (const c of CATS) o[c] += Fof(t, gen) * reach * shareOf(l, c);
  }
  return o;
}
// k such that the effective sum of the lines scaled by k is e
function solveScale(vals, e) {
  if (e <= 0) return 0;
  let lo = 0, hi = 1;
  const f = (k) => vals.reduce((a, v) => a + eff(v * k), 0);
  while (f(hi) < e) hi *= 2;
  for (let n = 0; n < 80; n++) { const m = (lo + hi) / 2; if (f(m) < e) lo = m; else hi = m; }
  // a line crossing 2% jumps (the 0.7 scale stops there): take the closer side
  return Math.abs(f(lo) - e) < Math.abs(f(hi) - e) ? lo : hi;
}

// new rates for lines whose effective sum must be e, keeping their proportions.
// The effective rate of one line cannot fall in [2 x LOWER, 2): a line below 2%
// counts x LOWER, at 2% it counts whole. A line whose share lands in that gap is
// set to the nearer edge and the rest is spread over the other lines again.
function allocate(vals, e) {
  const out = vals.map(() => null), gapLo = 2 * LOWER;
  let rest = e;
  for (let pass = 0; pass < vals.length + 1; pass++) {
    const free = vals.map((v, i) => i).filter((i) => out[i] === null);
    if (!free.length) break;
    const w = free.reduce((a, i) => a + vals[i], 0);
    let fixed = false;
    for (const i of free) {
      const x = w > 0 ? rest * vals[i] / w : rest / free.length;
      if (LOWER !== 1 && x >= gapLo && x < 2) {
        const top = x - gapLo >= 2 - x;
        out[i] = top ? 2 : 1.9999; rest -= eff(out[i]); fixed = true;
      }
    }
    if (fixed) { rest = Math.max(0, rest); continue; }
    for (const i of free) { const x = w > 0 ? rest * vals[i] / w : rest / free.length; out[i] = x >= 2 || LOWER === 1 ? x : x / LOWER; }
    break;
  }
  return out;
}

// the lines for one GENRATE and one set of wanted values; null if they do not fit
function build(t, gen, want, before, note) {
  const F = Fof(t, gen);
  const L = t.spec.filter((l) => !l.dead).map((l) => ({ ...l }));
  if (gen !== t.gen) {
    // keys, materials, mixed groups...: same drop per kill as before at the new GENRATE
    if (t.nId) return null;
    for (const l of L) if (!(l.cat in SET)) l.pct *= solveScale([l.pct], eff(l.pct) * Fof(t, t.gen) / F);
  }
  for (const c of Object.keys(SET)) {
    let mine = L.filter((l) => l.cat === c);
    // a table the game made without this kind of drop keeps it that way
    if (!mine.length) { note.add('no ' + c + ' line'); continue; }
    if (gen === t.gen && Math.abs(want[c] - before[c]) < 1e-9) continue;
    // what the mixed groups already give of this category counts toward the target
    const mixed = L.filter((l) => l.cat === 'Mixed').reduce((a, l) => a + F * eff(l.pct) * shareOf(l, c), 0);
    const v = allocate(mine.map((l) => l.pct), Math.max(0, want[c] - mixed) / F);
    mine.forEach((l, j) => { l.pct = v[j]; });
  }
  const total = () => L.reduce((a, l) => a + l.pct, 0) + t.idPct;
  if (total() > FULL) {
    const pot = L.filter((l) => l.cat === 'Potion');
    const floor = Math.min(POTION_FLOOR, before.Potion) / F;
    const now = pot.reduce((a, l) => a + eff(l.pct), 0);
    if (pot.length && now > floor) {
      const k = solveScale(pot.map((l) => l.pct), Math.max(floor, now - (total() - FULL)));
      for (const l of pot) l.pct *= k;
    }
  }
  for (const l of L) l.pct = Math.floor(l.pct * 10000) / 10000;
  return total() <= FULL + 1e-9 ? L : null;
}

const report = [], changed = [], skipped = [];
fs.mkdirSync(path.join(workDir, 'files'), { recursive: true });
for (const t of T) {
  if (!(t.rolls > 0) || !(t.gen > 0)) { skipped.push([t.name, t.level, 'never fires']); continue; }
  const before = perCat(t, t.spec, t.gen);
  const want = {}, base = {};
  for (const c of Object.keys(SET)) { base[c] = before[c]; want[c] = Math.min(HI, Math.max(LO, before[c])); }
  const note = new Set();

  let gen = t.gen, L = build(t, gen, want, before, note);
  if (!L) {
    if (build(t, 100, want, before, new Set())) {
      // the lowest GENRATE at which everything fits
      let lo = t.gen, hi = 100;
      for (let n = 0; n < 40; n++) { const m = (lo + hi) / 2; if (build(t, m, want, before, new Set())) hi = m; else lo = m; }
      gen = Math.min(100, Math.ceil(hi * 100) / 100);
      L = build(t, gen, want, before, note);
    } else {
      // full even at GENRATE 100: go as far toward the target as fits
      gen = 100;
      const part = (s) => { const w = {}; for (const c of Object.keys(SET)) w[c] = base[c] + (want[c] - base[c]) * s; return w; };
      let a = 0, b = 1;
      for (let n = 0; n < 40; n++) { const m = (a + b) / 2; if (build(t, 100, part(m), before, new Set())) a = m; else b = m; }
      L = build(t, 100, part(a), before, note);
      note.add('table full: moved ' + Math.round(a * 100) + '% of the way');
    }
  }
  if (!L) { skipped.push([t.name, t.level, 'cannot fit']); continue; }
  const added = L.filter((l) => l.i < 0 && l.pct > 0);
  const dead = t.spec.filter((l) => l.dead);

  // rewrite
  const lines = t.lines.slice();
  const re = /^(\s*ITEMSPEC\s+\d+\s+)([0-9.]+)/i;
  for (const l of L) {
    if (l.i < 0) continue;
    if (Math.abs(t.spec.find((s) => s.i === l.i).pct - l.pct) < 1e-9) continue;
    if (!re.test(lines[l.i])) throw new Error(t.name + ': cannot rewrite line ' + (l.i + 1));
    lines[l.i] = lines[l.i].replace(re, (m, a) => a + fmt(l.pct));
  }
  for (const l of dead) lines[l.i] = '//' + lines[l.i] + '  //no item in this spec';
  if (gen !== t.gen) {
    const gi = lines.findIndex((x) => /^\s*GENRATE\s/i.test(x));
    lines[gi] = lines[gi].replace(/^(\s*GENRATE\s+)([0-9.]+)/i, (m, a) => a + gen.toFixed(2));
  }
  if (added.length) {
    const last = Math.max(...t.spec.map((l) => l.i), t.lines.findIndex((x) => /^\s*GENNUM/i.test(x)));
    lines.splice(last + 1, 0, ...added.map((l) => `ITEMSPEC\t${l.id}\t\t${fmt(l.pct)}  //added ${l.cat} (${l.from})`));
  }
  if (lines.join('\n') === t.lines.join('\n')) { skipped.push([t.name, t.level, 'already at target']); continue; }

  // read the new text back the way the loader does, and check it
  const back = parse(lines);
  const sum = back.spec.reduce((a, l) => a + l.pct, 0) + back.idPct;
  if (sum > 100.0001) throw new Error(t.name + ': over 100');
  if (back.spec.length + back.nId > MAX_LINES) { skipped.push([t.name, t.level, 'would exceed 30 lines']); continue; }
  if (back.spec.some((l) => l.dead)) throw new Error(t.name + ': dead line left');
  const after = perCat(back, back.spec, back.gen);
  const otherOf = (x, gen) => { let cum = 0, o = 0; for (const l of x.spec.slice().sort((a, b) => a.pct - b.pct)) { const w = eff(l.pct), r = Math.max(0, Math.min(w, 100 - cum)); cum += w; if (!CATS.includes(l.cat) && !l.dead) o += Fof(x, gen) * r; } return o; };
  const o0 = otherOf(t, t.gen), o1 = otherOf(back, back.gen);
  if (o1 > o0 * 1.05 + 1e-6) throw new Error(`${t.name}: other items went up ${o0} -> ${o1}`);
  for (const c of CATS) if (!(c in SET) && c !== 'Potion' && after[c] < before[c] - 1e-3) throw new Error(`${t.name}: ${c} went down ${before[c]} -> ${after[c]}`);
  for (const c of Object.keys(SET)) if (back.spec.some((l) => l.cat === c) && ![...note].some((n) => /full/.test(n)) && (after[c] < LO - 0.05 || after[c] > HI + 0.05)) throw new Error(`${t.name}: ${c} ${after[c]} outside ${LO}-${HI}`);
  const out = encode(lines.join(t.eol) + t.eol);
  if (plain(out).toString('latin1').replace(/ +$/, '') !== lines.join(t.eol) + t.eol) throw new Error('round trip failed: ' + t.name);
  const file = path.join(workDir, 'files', t.name);
  fs.writeFileSync(file, out);
  changed.push([t.name, file]);
  report.push([t.name, t.level, users.get(t.k).length, `${t.gen} -> ${back.gen}`, ...CATS.map((c) => `${before[c].toFixed(2)} -> ${after[c].toFixed(2)}`), fmt(sum),
    [...added.map((l) => `+${l.cat} spec ${l.id} (${l.from})`), ...dead.map((l) => `-empty spec ${l.id} ${l.pct}%`), ...note].join(' ; ')]);
}

const esc = (v) => { const s = String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = (rows) => '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
fs.writeFileSync(path.join(workDir, 'changed_tables.csv'), csv([['file', 'level', 'monsters', 'GENRATE', ...CATS.map((c) => c + ' /100 kills'), 'entry total %', 'notes'], ...report.sort((a, b) => a[1] - b[1])]));
fs.writeFileSync(path.join(workDir, 'left_alone.csv'), csv([['file', 'level', 'why'], ...skipped]));
console.log(`field tables ${T.length}, changed ${changed.length}, left alone ${skipped.length}`);
if (write && changed.length) {
  const out = path.join(workDir, 'GLogicServer.rcc');
  const log = console.log; console.log = () => {};
  try { require('./rcc-pack.js').pack(srcRcc, out, changed); } finally { console.log = log; }
  console.log('packed', out);
}
