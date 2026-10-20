'use strict';
//
// `drop-delta.js` - take a fixed amount off every normal field table's weapon,
// armor and upgrade-stone drop, per 100 kills (user, 2026-10-20: "weapon and
// armor current - 0.4 and upgrade stone current - 0.2").
//
//   node drop-delta.js <CLIENT/data dir> <report dir> <work dir> [--write] [--nosplit]
//                      [--only=lv02.genitem,lv05.genitem,...] [--set-stone=0.75]
//                      [--match-resist] [--match-spec=991,992]
//
// --only: change just these tables. --set-stone: instead of the deltas, set the
// stone drop of each table to this many per 100 kills and leave weapon and armor
// alone (user, 2026-10-20: "for mob level 1-39 make the stone drop ~0.7 - 0.8").
// --match-resist: set the resistance stones (spec 196: Iron, Silver, Crystal,
// Bone Powder, Sodium and their Special forms) of each table to what its upgrade
// stones (spec 191) give, adding the line where a table has none (user,
// 2026-10-20: "they should have similar to the upgrade stone").
// --match-spec: add a line for each listed spec to every table that drops upgrade
// stones, each spec giving what the table's stones give (user, 2026-10-20: event
// items 512/57 spec 991 and 512/58 spec 992, "same drop rate as the stone
// upgrade"). The report dir must come from data whose item.csv lists the specs.
//
// Same tables, same server maths and same checks as drop-field-even.js (which
// this is copied from): field table = lv*, osaka*, Infinitystairs*, gmd_* used by
// a monster, not *_leader / *boss* / *treasure*; per 100 kills worked out the way
// GLCrowData.cpp SELECTSPECID does it. Each table's own value goes down by the
// delta (a table with none keeps none; never below 0). Only lowering, so no
// table can pass 100% and GENRATE never changes; every other line keeps its rate.
//
// The 0.7 rule: a line under 2% counts x fITEM_DROP_LOWER_SCALE (and is also
// multiplied by the killer's drop-rate bonus), a line at 2% or more counts whole.
// So one line cannot give an effective rate in [2 x 0.7, 2). A line whose target
// lands there is split into two equal lines of the same spec, each under 2%,
// which together give it exactly. --nosplit snaps to the nearer edge instead
// (and reports how far off that leaves the table).
//
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { RccArchive } = require('./rcc.js');
const gamecrypt = require('./gamecrypt.js');

// What comes off each table, per 100 kills.
const argv0 = process.argv.slice(2);
const onlyArg = argv0.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? new Set(onlyArg.slice(7).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)) : null;
const stoneArg = argv0.find((a) => a.startsWith('--set-stone='));
const SET_STONE = stoneArg ? parseFloat(stoneArg.slice(12)) : null;
if (stoneArg && !(SET_STONE >= 0)) throw new Error('--set-stone needs a number');
const MATCH_RESIST = argv0.includes('--match-resist');
const specArg = argv0.find((a) => a.startsWith('--match-spec='));
const MATCH_SPEC = specArg ? specArg.slice(13).split(',').map((x) => parseInt(x, 10)) : null;
if (MATCH_SPEC && MATCH_SPEC.some((x) => !(x > 0 && x < 999))) throw new Error('--match-spec needs spec ids');
const evCat = (id) => 'Spec' + id;
const SET = MATCH_SPEC ? Object.fromEntries(MATCH_SPEC.map((id) => [evCat(id), true]))
  : MATCH_RESIST ? { Resist: true } : SET_STONE !== null ? { Stone: true } : { Weapon: true, Armor: true, Stone: true };
const DELTA = { Weapon: 0.4, Armor: 0.4, Stone: 0.2 };
const CATS = ['Weapon', 'Armor', 'Acc', 'Stone', 'Resist', 'Potion', 'Book', ...(MATCH_SPEC || []).map(evCat)];
const RESIST_SPEC = 196;
const POTION_FLOOR = 52.49;
const STONE_SPEC = 191, MAX_LINES = 30, FULL = 99.99;

const args = process.argv.slice(2);
const write = args.includes('--write');
const NOSPLIT = args.includes('--nosplit');
const [dataDir, repDir, workDir] = args.filter((a) => !a.startsWith('--'));
if (!dataDir || !repDir || !workDir) { console.error('usage: node drop-delta.js <CLIENT/data> <report dir> <work dir> [--write] [--nosplit]'); process.exit(2); }

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
  if (id === RESIST_SPEC) { specCat.set(id, 'Resist'); continue; }
  if (MATCH_SPEC && MATCH_SPEC.includes(id)) { specCat.set(id, evCat(id)); continue; }
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
  if (ONLY && !ONLY.has(k)) continue;
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
  // rates as wanted, then each one landing in the 0.7 gap is either split (two
  // lines under 2% giving it exactly) or snapped to the nearer edge (--nosplit).
  // Returns [{ pct, split }].
  const gapLo = 2 * LOWER;
  const w = vals.reduce((a, v) => a + v, 0);
  const effw = vals.reduce((a, v) => a + eff(v), 0);
  return vals.map((v) => {
    // this line's share of the effective target, in proportion to what it gives now
    const x = effw > 0 ? e * eff(v) / effw : e / vals.length;
    if (LOWER === 1 || x >= 2) return { pct: x, split: false };
    if (x < gapLo) return { pct: x / LOWER, split: false };
    if (NOSPLIT) return { pct: (x - gapLo >= 2 - x) ? 2 : 1.9999, split: false };
    return { pct: x / LOWER / 2, split: true };
  });
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
    // resistance stones are added where a table has none; anything else a table
    // the game made without keeps it that way
    if (!mine.length && c === 'Resist' && want[c] > 0) {
      const nl = { i: -1, id: RESIST_SPEC, pct: 1, cat: 'Resist', dead: false, from: 'added resist stones' };
      L.push(nl); mine = [nl]; note.add('Resist line added');
    }
    // --match-spec: the listed specs are new (event items): added to every table that drops stones
    if (!mine.length && MATCH_SPEC && c.startsWith('Spec') && want[c] > 0) {
      const id = +c.slice(4);
      if (!live(id)) throw new Error('spec ' + id + ' has no drop-enabled item');
      const nl = { i: -1, id, pct: 1, cat: c, dead: false, from: 'at the upgrade-stone rate' };
      L.push(nl); mine = [nl]; note.add(c + ' line added');
    }
    if (!mine.length) { note.add('no ' + c + ' line'); continue; }
    if (gen === t.gen && Math.abs(want[c] - before[c]) < 1e-9) continue;
    // what the mixed groups already give of this category counts toward the target
    const mixed = L.filter((l) => l.cat === 'Mixed').reduce((a, l) => a + F * eff(l.pct) * shareOf(l, c), 0);
    const v = allocate(mine.map((l) => l.pct), Math.max(0, want[c] - mixed) / F);
    mine.forEach((l, j) => {
      l.pct = v[j].pct;
      if (v[j].split) { L.push({ ...l, i: -1, from: 'split of the ' + c + ' line' }); note.add(c + ' line split in two (0.7 rule)'); }
    });
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
  for (const c of Object.keys(SET)) { base[c] = before[c]; want[c] = MATCH_SPEC || MATCH_RESIST ? before.Stone : SET_STONE !== null ? SET_STONE : Math.max(0, before[c] - DELTA[c]); }
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
  const off = [];
  for (const c of Object.keys(SET)) if (back.spec.some((l) => l.cat === c)) {
    const d = after[c] - want[c];
    if (Math.abs(d) > 0.02) { if (!NOSPLIT) throw new Error(`${t.name}: ${c} ${after[c]} not ${want[c]}`); off.push(`${c} off by ${d.toFixed(2)}`); }
  }
  for (const o of off) note.add(o);
  if (SET_STONE === null && !MATCH_RESIST && !MATCH_SPEC) for (const c of Object.keys(SET)) if (after[c] > before[c] + 1e-6) throw new Error(`${t.name}: ${c} went up`);
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
