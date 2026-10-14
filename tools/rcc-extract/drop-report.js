'use strict';
//
// `drop-report.js` — what every mob drops, worked out from the shipped data the
// field server loads, with no server run.
//
//   node drop-report.js <CLIENT/data dir> <out dir>
//
// SOURCES
//   glogic/GLogic.rcc          crow.mnsf (mobs), item.csv (items), string tables,
//                              default.charclass (drop scales)
//   glogicserver/GLogicServer.rcc   the *.genitem drop tables
//
// HOW THE SERVER DROPS (GLCrowGenerateReward.cpp:290-406), per kill:
//   1. the single item `m_sGenItemID` at `m_wGenItem_Rate` %
//   2. up to 10 `.genitem` tables (`m_strGenItem`, ';' separated,
//      GLCrowData.cpp:634). For each (SGENITEM, GLCrowDataLoad.cpp:183):
//        GENRATE %            the table fires at all
//        GENNUM  n  %         how many rolls it makes (a gap in the % = 0 rolls)
//        ITEMSPEC id %        per roll: a "spec" group; one item is then taken
//                             from every drop-enabled item carrying that
//                             dwSpecID, evenly (GLItemMan::RendomGenSpecID walks
//                             a shuffled list)
//        ITEMID  mid sid %    per roll: that exact item
//      the % of the entries need not reach 100: the rest is "nothing".
//   3. one question item from the `q_*.genitem` file (QTITEM mid sid %)
//   4. money at `m_wGenMoney_Rate` %
//
// So the chance figures here are: expected NUMBER of that item per kill, at
// drop scale 1 and with no player/party/event bonus:
//      GENRATE/100 * E[rolls] * entry%/100 / (items in the spec)
//
const fs = require('fs');
const path = require('path');
const { RccArchive } = require('./rcc.js');
const gamecrypt = require('./gamecrypt.js');
const crowdata = require('./crowdata.js');

// refDir (optional): loose .genitem files in cipher v3. Where one has the same
// name as a table in the archive it is priced INSTEAD, so the older reference
// rates can be put through today's mobs and items.
const [dataDir, outDir, refDir] = process.argv.slice(2);
if (!dataDir || !outDir) { console.error('usage: node drop-report.js <CLIENT/data> <out dir>'); process.exit(2); }

const th = new TextDecoder('windows-874');
const plain = (b) => (gamecrypt.isEncoded(b) ? gamecrypt.decode(b) : b);

const ITEM_TYPE = ['SUIT', 'ARROW', 'CURE', 'SKILL', 'RECALL', 'KEY', 'GRINDING', 'CHARM', 'TICKET',
  'SKP_RESET', 'STAT_RESET', 'SKP_STAT_RESET', 'BOX', 'CLEANSER', 'LOUDSPEAKER', 'FIRECRACKER',
  'CHARACTER_CARD', 'INVEN_CARD', 'STORAGE_CARD', 'STORAGE_CONNECT', 'PREMIUMSET', 'PRIVATEMARKET',
  'RANDOMITEM', 'DISJUNCTION', 'HAIR', 'FACE', 'QITEM', 'CD', '2FRIEND', 'CLUBCALL', 'HAIRSHOP',
  'RENAME', 'HAIR_STYLE', 'HAIR_COLOR', 'REVIVE', 'PET_CARD', 'PET_FOOD', 'PET_RENAME', 'PET_COLOR',
  'PET_STYLE', 'PET_SKILL', 'SMS', 'PET_REVIVE', 'ANTI_DISAPPEAR', 'REMODEL', 'VEHICLE',
  'VEHICLE_OIL', 'VIETNAM_ITEMGET', 'VIETNAM_EXPGET', 'GENDER_CHANGE', 'GARBAGE_CARD',
  'TELEPORT_CARD', 'PET_SKIN_PACK', 'FACE_STYLE', 'TAXI_CARD', 'MATERIALS', 'NPC_RECALL', 'BULLET',
  'FOOD', 'CARD_DUALPETSKILL', 'BEADS_STRENGTHEN', 'BEADS_RELAXANT', 'CARD_BIKECOLOR',
  'CARD_BIKEBOOST', 'OBLIVION_NEW', 'COSTUME_COLOR', 'CARD_MAILBOX', 'CARD_FOODUNLOCK',
  'POINTCARD_A', 'POINTCARD_B', 'CRAFTING_BOOK', 'RANDOM_OPTION_CARD', 'NONDROP_CARD',
  'RESET_CRAFTING', 'PERSONAL_STORE_SEARCH', 'CHANGE_SCALE_CARD', 'WRAPPER', 'WRAPPER_BOX',
  'CHANGE_SCHOOL', 'EQUIPMENT_LOCK_ENABLE', 'EQUIPMENT_LOCK_RECOVER', 'TRANSFER_CARD',
  'CARD_CAR_COLOR', 'CARD_VEHICLE_BOOST', 'SEALED_CARD', 'COSTUME_BLESSED_PAPER', 'MYSTERY_BOX',
  'MYSTERY_KEY', 'RESET_BRIGHT_CARD', 'EPOINT_CARD', 'SKILL_REFORMCARD', 'STORAGE_LOCK_ENABLE',
  'STORAGE_LOCK_RECOVER', 'INVENTORY_LOCK_ENABLE', 'INVENTORY_LOCK_RECOVER', 'CONTRIBUTION_CARD',
  'BUFF_CARD', 'LEVELUP_CARD', 'KILLFEED_CARD', 'PRIVATEMARKET_BUY'];
const SUIT = ['Head', 'Upper', 'Lower', 'Hand', 'Foot', 'Handheld', 'Neck', 'Wrist', 'Finger',
  'Pet A', 'Pet B', 'Vehicle', 'Vehicle skin', 'Vehicle part A', 'Vehicle part B', 'Vehicle part C'];
const ATT = ['none', 'Sword', 'Blade', 'Dagger', 'Spear', 'Stick', 'Gauntlet', 'Bow', 'Throw', 'Gun',
  'Railgun', 'Portalgun', 'Scythe', 'Dual spear', 'Shuriken', 'Fist', 'Wand', 'Cube', 'Whip',
  'Shield', 'Hammer', 'Umbrella', 'Nocare', 'Shotgun'];
const GRADE = ['Normal', 'Rare', 'Unique', 'Infinity', 'Fervor', 'Legendary'];

// The reader-friendly bucket an item falls in.
function category(it) {
  if (it.type === 0) {
    if (it.suit === 5) return it.attack === 0 ? 'Equipment: handheld (no attack type)' : 'Weapon: ' + (ATT[it.attack] || it.attack);
    if (it.suit <= 4) return 'Armor: ' + SUIT[it.suit];
    if (it.suit <= 8) return 'Accessory: ' + SUIT[it.suit];
    return 'Equipment: ' + (SUIT[it.suit] || it.suit);
  }
  const map = { 1: 'Ammo: arrow', 7: 'Ammo: charm', 57: 'Ammo: bullet', 2: 'Potion / cure', 3: 'Skill book',
    6: 'Upgrade stone (grinding)', 55: 'Material', 12: 'Box', 22: 'Random box', 26: 'Question item',
    35: 'Pet card', 36: 'Pet food', 45: 'Vehicle', 46: 'Vehicle fuel', 58: 'Food buff' };
  return map[it.type] || 'Other: ' + (ITEM_TYPE[it.type] || it.type);
}

// ------------------------------------------------------------------ csv
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
const esc = (v) => { const s = String(v === undefined || v === null ? '' : v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
function writeCsv(file, head, rows) {
  // BOM so Excel reads the Thai as UTF-8.
  fs.writeFileSync(file, '﻿' + [head, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n', 'utf8');
}

function strTable(buf) {
  const m = new Map();
  if (!buf) return m;
  for (const line of th.decode(plain(buf)).split(/\r?\n/)) {
    const t = line.split('/')[0].split('\t').filter((x) => x !== '');
    if (t.length >= 2 && !m.has(t[0])) m.set(t[0], t[1].trim());
  }
  return m;
}

// ------------------------------------------------------------------ load
const glogic = new RccArchive(path.join(dataDir, 'glogic', 'GLogic.rcc'));
const server = new RccArchive(path.join(dataDir, 'glogicserver', 'GLogicServer.rcc'));
const lower = (arc) => { const m = new Map(); for (const n of arc.list()) m.set(n.toLowerCase(), n); return m; };
const gNames = lower(glogic), sNames = lower(server);
const gRead = (n) => (gNames.has(n.toLowerCase()) ? glogic.read(gNames.get(n.toLowerCase())) : null);

const itemTh = strTable(gRead('ItemStrTable.txt'));
const itemEn = strTable(gRead('ItemStrTable_en.txt'));
const crowTh = strTable(gRead('CrowStrTable.txt'));
const crowEn = strTable(gRead('CrowStrTable_en.txt'));

// items
const items = new Map();          // dwID -> item
const specItems = new Map();      // specId -> [item] (drop-enabled only, as GLItemMan::InsertItem)
{
  const lines = plain(gRead('item.csv')).toString('latin1').split(/\r?\n/);
  const head = csvLine(lines[0]);
  const col = (name, nth = 0) => { let k = -1; for (let i = 0; i < head.length; i++) if (head[i] === name && ++k === nth) return i; throw new Error('item.csv: no column ' + name); };
  const C = { mid: col('sNativeID wMainID'), sid: col('sNativeID wSubID'), key: col('strName', 0), level: col('emLevel'),
    type: col('emItemType'), reqDw: col('wReqLevelDW'), suit: col('emSuit'), attack: col('emAttack'),
    spec: col('dwSpecID'), gen: col('bGenEnable') };
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = csvLine(lines[i]);
    const mid = +f[C.mid], sid = +f[C.sid];
    const it = { mid, sid, key: f[C.key], grade: +f[C.level], type: +f[C.type], reqLevel: +f[C.reqDw],
      suit: +f[C.suit], attack: +f[C.attack], spec: +f[C.spec], gen: +f[C.gen] !== 0 };
    it.nameTh = itemTh.get(it.key) || '';
    it.nameEn = itemEn.get(it.key) || '';
    it.cat = category(it);
    items.set((sid << 16 | mid) >>> 0, it);
    if (it.spec < 999 && it.gen) { if (!specItems.has(it.spec)) specItems.set(it.spec, []); specItems.get(it.spec).push(it); }
  }
}

// drop scales (default.charclass is a gltexfile; only these three matter)
const scale = { fITEM_DROP_SCALE: 1, fMONEY_DROP_SCALE: 1, fITEM_DROP_LOWER_SCALE: 1 };
{
  const b = gRead('default.charclass');
  if (b) for (const line of plain(b).toString('latin1').split(/\r?\n/)) {
    const t = line.split('//')[0].trim().split(/[\s,{}\[\]()|]+/);
    if (t[0] in scale && t.length > 1 && isFinite(parseFloat(t[1]))) scale[t[0]] = parseFloat(t[1]);
  }
}

// genitem tables
const num = (v) => { const x = parseFloat(v); return isFinite(x) ? x : 0; };
const tokens = (line) => line.split('//')[0].trim().split(/[\s,{}\[\]()|]+/).filter((x) => x !== '');
const tableCache = new Map();
const refNames = new Map(); let refUsed = 0, refMissing = 0;
if (refDir) for (const n of fs.readdirSync(refDir)) if (/\.genitem$/i.test(n)) {
  // A file in another cipher version was put there later: not part of the set.
  const b = fs.readFileSync(path.join(refDir, n));
  if (b.length >= 20 && b.readInt32LE(0) === 3) refNames.set(n.toLowerCase(), n); else console.log('reference: skipped (not cipher v3)', n);
}
function refText(k) {
  const b = fs.readFileSync(path.join(refDir, refNames.get(k)));
  if (b.readInt32LE(0) !== 3) throw new Error('reference table is not cipher v3: ' + k);
  const p = b.subarray(4), whole = p.length - p.length % 16;
  const d = require('crypto').createDecipheriv('aes-256-ecb', Buffer.from('skrkrhtlvdj!@#wpfrmfjgrpgo!@#$qk', 'latin1'), null); d.setAutoPadding(false);
  return Buffer.concat([d.update(p.subarray(0, whole)), d.final()]).toString('latin1');
}
function table(name) {
  const k = name.trim().toLowerCase();
  if (tableCache.has(k)) return tableCache.get(k);
  let t = null;
  if (sNames.has(k)) {
    t = { name: sNames.get(k), genRate: 0, nums: [], entries: [], qt: [] };
    t.fromRef = !!(refDir && refNames.has(k));
    for (const line of (t.fromRef ? refText(k) : plain(server.read(sNames.get(k))).toString('latin1')).split(/\r?\n/)) {
      const f = tokens(line);
      if (!f.length) continue;
      const tag = f[0].toUpperCase();
      // getflag takes the FIRST line of a flag; getflag(i, ..) the i-th.
      if (tag === 'GENRATE' && !t.sawRate) { t.genRate = num(f[1]); t.sawRate = true; }
      else if (tag === 'GENNUM' && t.nums.length < 5) t.nums.push({ n: num(f[1]) | 0, pct: num(f[2]) });
      else if (tag === 'ITEMSPEC') t.entries.push({ spec: num(f[1]) >= 999 ? 0 : num(f[1]) | 0, pct: num(f[2]) });
      else if (tag === 'ITEMID') t.entries.push({ mid: num(f[1]) | 0, sid: num(f[2]) | 0, pct: num(f[3]) });
      else if (tag === 'QTITEM' && t.qt.length < 20) t.qt.push({ mid: num(f[1]) | 0, sid: num(f[2]) | 0, pct: num(f[3]) });
    }
    // SELECTNUM stops at the first wNum == 0.
    const z = t.nums.findIndex((x) => x.n === 0); if (z >= 0) t.nums.length = z;
    // GENNUM ranges are stacked [L, L+pct) one after another (GLCrowDataLoad.cpp
    // SGENITEM::LOADFILE) and SELECTNUM rolls 0..100: a part past 100 never happens.
    { let lo = 0; t.rolls = 0; for (const x of t.nums) { const hi = lo + x.pct; t.rolls += x.n * Math.max(0, Math.min(hi, 100) - Math.min(lo, 100)) / 100; lo = hi; } }
    t.entryPct = t.entries.reduce((a, x) => a + x.pct, 0);
  }
  tableCache.set(k, t);
  return t;
}

// ------------------------------------------------------------------ mobs
const crow = crowdata.parse(gRead('crow.mnsf'));
if (!crow.eofExact) throw new Error('crow.mnsf not consumed exactly: ' + crow.trailing + ' bytes left');

const EMCROW = ['PC', 'NPC', 'MOB', 'ITEM', 'MONEY', 'PET', 'SUMMON', 'MATERIAL', 'ZONE', 'GATE'];
const idOf = (it) => `${it.mid}/${it.sid}`;
const detail = [], summary = [], problems = [], tableUse = new Map();

for (const c of crow.crows) {
  const g = c.gen;
  if (!g) continue;
  const files = g.genItem.split(';').map((x) => x.trim()).filter(Boolean).slice(0, 10);
  const hasDrop = files.length || g.qtGenItem || (g.itemRate && g.itemId !== 0xffffffff) || (g.moneyRate && g.money);
  if (!hasDrop) continue;

  const mobId = `${c.main}/${c.sub}`;
  const nameTh = crowTh.get(c.nameKey) || '', nameEn = crowEn.get(c.nameKey) || crowTh.get(c.nameKey) || c.nameKey;
  const cats = new Map();     // category -> expected per kill
  const grades = new Map();
  let total = 0;
  const add = (source, it, rawId, exp, note) => {
    const cat = it ? it.cat : 'UNKNOWN ITEM';
    cats.set(cat, (cats.get(cat) || 0) + exp);
    if (it) grades.set(GRADE[it.grade] || it.grade, (grades.get(GRADE[it.grade] || it.grade) || 0) + exp);
    total += exp;
    detail.push([mobId, nameTh, nameEn, c.level, source, rawId, it ? it.nameTh : '', it ? it.nameEn : '', cat,
      it ? (GRADE[it.grade] || it.grade) : '', it ? it.reqLevel : '', +(exp * 100).toFixed(5), note || '']);
  };

  if (g.itemRate && g.itemId !== 0xffffffff) {
    const it = items.get(g.itemId);
    const id = `${g.itemId & 0xffff}/${g.itemId >>> 16}`;
    if (!it) problems.push([mobId, nameEn, 'single item', id, 'item id not in item.csv']);
    add('single item', it, id, Math.min(1, g.itemRate * scale.fITEM_DROP_SCALE / 100));
  }

  for (const f of files) {
    const t = table(f);
    if (!t) { problems.push([mobId, nameEn, f, '', 'drop file missing from GLogicServer.rcc: nothing drops from it']); continue; }
    tableUse.set(t.name, (tableUse.get(t.name) || 0) + 1);
    const fire = Math.min(1, t.genRate * scale.fITEM_DROP_SCALE / 100);
    if (t.entryPct > 100.001) problems.push([mobId, nameEn, t.name, '', `entry rates sum to ${t.entryPct}% (over 100: the last entries can never be picked)`]);
    let cum = 0;
    // The loader sorts the entries by rate, ascending (multimap), before stacking them.
    for (const e of [...t.entries].sort((a, b) => a.pct - b.pct)) {
      // SELECTSPECID: an entry under 2% is scaled by fITEM_DROP_LOWER_SCALE (and the
      // killer's own drop rate, taken as 1 here) when that product is not 1.
      const w = (scale.fITEM_DROP_LOWER_SCALE !== 1 && e.pct < 2) ? e.pct * scale.fITEM_DROP_LOWER_SCALE : e.pct;
      const reach = Math.max(0, Math.min(w, 100 - cum)); cum += w;
      const perRoll = reach / 100;
      const exp = fire * t.rolls * perRoll;
      if (e.spec === 0) problems.push([mobId, nameEn, t.name, 'spec 0', 'spec 0 is the default of every item: this share drops a random item out of ' + (specItems.get(0) || []).length]);
      if (e.spec !== undefined) {
        const pool = specItems.get(e.spec) || [];
        if (!pool.length) { problems.push([mobId, nameEn, t.name, 'spec ' + e.spec, 'no drop-enabled item has this spec id: this share drops nothing']); continue; }
        for (const it of pool) add(t.name, it, idOf(it), exp / pool.length, `spec ${e.spec} (${pool.length} items)`);
      } else {
        const it = items.get((e.sid << 16 | e.mid) >>> 0);
        if (!it) problems.push([mobId, nameEn, t.name, `${e.mid}/${e.sid}`, 'item id not in item.csv']);
        add(t.name, it, `${e.mid}/${e.sid}`, exp, 'exact item');
      }
    }
  }

  if (g.qtGenItem) {
    const t = table(g.qtGenItem);
    if (!t) problems.push([mobId, nameEn, g.qtGenItem, '', 'question-item file missing from GLogicServer.rcc']);
    else for (const e of t.qt) {
      const it = items.get((e.sid << 16 | e.mid) >>> 0);
      if (!it) problems.push([mobId, nameEn, t.name, `${e.mid}/${e.sid}`, 'item id not in item.csv']);
      add(t.name + ' (question)', it, `${e.mid}/${e.sid}`, e.pct / 100);
    }
  }

  if (refDir) { const ts = [...files, g.qtGenItem].filter(Boolean).map(table).filter(Boolean); if (ts.length && ts.every((t) => t.fromRef)) refUsed++; else if (ts.length) refMissing++; }
  const top = [...cats.entries()].sort((a, b) => b[1] - a[1]);
  summary.push({ c, mobId, nameTh, nameEn, files, cats, grades, total, top });
}

// ------------------------------------------------------------------ write
fs.mkdirSync(outDir, { recursive: true });
const allCats = [...new Set(summary.flatMap((s) => [...s.cats.keys()]))].sort();
const pct = (v) => (v ? +(v * 100).toFixed(3) : '');

writeCsv(path.join(outDir, 'drops_by_mob.csv'),
  ['mob id', 'name TH', 'name EN', 'kind', 'level', 'HP', 'drop files', 'question file', 'money', 'money %',
    'items per kill', 'main drop types', ...GRADE.map((g) => g + ' /100 kills'), ...allCats.map((c) => c + ' /100 kills')],
  summary.sort((a, b) => a.c.level - b.c.level || a.c.main - b.c.main || a.c.sub - b.c.sub).map((s) => [
    s.mobId, s.nameTh, s.nameEn, EMCROW[s.c.emCrow] || s.c.emCrow, s.c.level, s.c.hp, s.files.join(';'), s.c.gen.qtGenItem,
    s.c.gen.money, s.c.gen.moneyRate, +s.total.toFixed(4),
    s.top.slice(0, 4).map(([k, v]) => `${k} ${(v * 100).toFixed(1)}`).join(' | '),
    ...GRADE.map((g) => pct(s.grades.get(g))), ...allCats.map((k) => pct(s.cats.get(k)))]));

writeCsv(path.join(outDir, 'drops_detail.csv'),
  ['mob id', 'mob TH', 'mob EN', 'mob level', 'source', 'item id', 'item TH', 'item EN', 'type', 'grade',
    'item req level', 'per 100 kills', 'note'], detail);

writeCsv(path.join(outDir, 'drop_tables.csv'),
  ['file', 'used by mobs', 'GENRATE %', 'rolls (n:%)', 'avg rolls', 'entry % total', 'entry', 'entry %', 'items in entry', 'types in entry'],
  [...sNames.values()].filter((n) => /\.genitem$/i.test(n)).sort().flatMap((n) => {
    const t = table(n);
    const headCols = [t.name, tableUse.get(t.name) || 0, t.genRate, t.nums.map((x) => `${x.n}:${x.pct}`).join(' '), +t.rolls.toFixed(3), t.entryPct];
    const rows = t.entries.map((e) => {
      const pool = e.spec !== undefined ? (specItems.get(e.spec) || []) : [items.get((e.sid << 16 | e.mid) >>> 0)].filter(Boolean);
      const kinds = [...new Set(pool.map((i) => i.cat))].join(' | ');
      return [...headCols, e.spec !== undefined ? 'spec ' + e.spec : `item ${e.mid}/${e.sid}`, e.pct, pool.length, kinds];
    });
    for (const e of t.qt) { const it = items.get((e.sid << 16 | e.mid) >>> 0); rows.push([...headCols, `question ${e.mid}/${e.sid}`, e.pct, it ? 1 : 0, it ? it.cat : '']); }
    return rows.length ? rows : [[...headCols, '(empty)', '', '', '']];
  }));

writeCsv(path.join(outDir, 'spec_groups.csv'),
  ['spec id', 'items', 'types', 'grades', 'req level min', 'req level max', 'examples'],
  [...specItems.entries()].sort((a, b) => a[0] - b[0]).map(([id, pool]) => [id, pool.length,
    [...new Set(pool.map((i) => i.cat))].join(' | '), [...new Set(pool.map((i) => GRADE[i.grade] || i.grade))].join(' | '),
    Math.min(...pool.map((i) => i.reqLevel)), Math.max(...pool.map((i) => i.reqLevel)),
    pool.slice(0, 5).map((i) => i.nameEn || i.nameTh || idOf(i)).join(' ; ')]));

writeCsv(path.join(outDir, 'problems.csv'), ['mob id', 'mob EN', 'file', 'entry', 'problem'], problems);

// ------------------------------------------------------------------ console
const mobs = summary.filter((s) => s.c.emCrow === 2);
const catMobs = new Map(), catExp = new Map();
for (const s of mobs) for (const [k, v] of s.cats) { catMobs.set(k, (catMobs.get(k) || 0) + 1); catExp.set(k, (catExp.get(k) || 0) + v); }
console.log(JSON.stringify({
  crows: crow.count, withDrops: summary.length, mobsWithDrops: mobs.length,
  kinds: summary.reduce((a, s) => { const k = EMCROW[s.c.emCrow] || s.c.emCrow; a[k] = (a[k] || 0) + 1; return a; }, {}),
  items: items.size, specGroups: specItems.size, scale,
  genitemFiles: [...sNames.keys()].filter((n) => n.endsWith('.genitem')).length, usedFiles: tableUse.size,
  detailRows: detail.length, problems: problems.length,
  levelRange: [Math.min(...summary.map((s) => s.c.level)), Math.max(...summary.map((s) => s.c.level))],
}, null, 1));
if (refDir) console.log('reference tables: mobs fully priced from them', refUsed, ', mobs with a table that has no reference version', refMissing);
console.log('category: mobs dropping it / avg per 100 kills among those');
for (const [k, n] of [...catMobs.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(40)} ${String(n).padStart(5)}  ${(catExp.get(k) / n * 100).toFixed(2)}`);
const pk = new Map(); for (const p of problems) pk.set(p[4].replace(/\d+(\.\d+)?%/, 'N%'), (pk.get(p[4].replace(/\d+(\.\d+)?%/, 'N%')) || 0) + 1);
console.log('problems:', JSON.stringify([...pk.entries()], null, 1));
