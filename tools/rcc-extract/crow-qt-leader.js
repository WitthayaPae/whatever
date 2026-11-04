'use strict';
//
// `crow-qt-leader.js` — let the school mobs drop their leader's summon box again.
//
//   node crow-qt-leader.js <CLIENT/data dir> <work dir> [--write]
//
// A leader (Fancer Leader 19/2, Hime Leader 2/2, ...) spawns only when a player
// picks up a QUESTION_MOBGEN Q-box (GLChar::ApplyQItemFact -> DropCrow at the
// box). The box comes from the mob's question table, SCROWGEN::m_strQtGenItem.
// The school mobs point at q_Lv*.genitem tables whose MobGen lines are all
// commented out, and the q_002_* / q_003_* tables that carry the leader box are
// used by no mob, so quests 702-711 ("kill 3 <leader>") could not be finished.
//
// For each mob below a new table is made from its current question table (or,
// when it has none, the original q_002_* / q_003_* table) plus the leader box at
// RATE, so nothing it dropped is lost. Run it on the data from before the fix. Only
// m_strQtGenItem changes in crow.mnsf. SQTGENITEM::SELECTITEM is one roll over
// the summed rates (percent), at most EMQTMAX = 20 lines, total <= 100.
//
// Without --write it only reports. With it, <work dir> gets crow.mnsf,
// GLogic.rcc (client + server glogic), GLogicServer.rcc and the new loose
// .genitem files. The data dir is not touched.
//
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { RccArchive } = require('./rcc.js');
const gamecrypt = require('./gamecrypt.js');
const bytecrypt = require('./bytecrypt.js');
const crowdata = require('./crowdata.js');
const { pack } = require('./rcc-pack.js');

const args = process.argv.slice(2);
const write = args.includes('--write');
const [dataDir, workDir] = args.filter((a) => !a.startsWith('--'));
if (!dataDir || !workDir) { console.error('usage: node crow-qt-leader.js <CLIENT/data> <work dir> [--write]'); process.exit(2); }

const RATE = 3.3;   // percent per kill: about one leader box per 30 kills (user, 2026-10-18; the q_002/q_003 tables had 0.5)
//  mob -> leader box (item main/sub) and leader, or a ready table when the mob has none.
const PLAN_ALL = [
  { mobs: ['2/0', '2/1'],   box: '9,11', leader: '2/2 Hime Leader' },
  { mobs: ['19/0', '19/1'], box: '9,19', leader: '19/2 Fancer Leader' },
  { mobs: ['4/1'],          box: '9,12', leader: '4/2 Gibbs Leader' },
  { mobs: ['4/0'],          base: 'q_002_lv017.genitem', box: '9,12', leader: '4/2 Gibbs Leader' },
  { mobs: ['5/0', '5/1'],   box: '9,13', leader: '5/2 Bald Head Master' },
  { mobs: ['10/0'],         base: 'q_002_lv028.genitem', box: '9,15', leader: '10/2 Master Fu' },
  { mobs: ['10/1'],         base: 'q_002_lv030.genitem', box: '9,15', leader: '10/2 Master Fu' },
  { mobs: ['22/0'],         base: 'q_003_lv050.genitem', box: '9,20', leader: '22/1 Welding Master' },
  { mobs: ['27/0'],         box: '9,22', leader: '27/1 Furious Chef' },
  { mobs: ['28/0'],         box: '9,23', leader: '28/1 Obasan' },
  { mobs: ['7/0', '7/1', '7/2'], box: '9,14', leader: '7/7 Blood Robber' },
];
//  --plan=vulgar (2026-10-31): Vulgar Leader had no box at all; 9/47 was made for it
//  (tools/event-exchange/mk_vulgarbox.js). Run on data that already has the other leaders.
const PLAN_VULGAR = [
  { mobs: ['0/0', '0/1'], box: '9,47', leader: '0/22 Vulgar Leader' },
];
const PLAN = args.includes('--plan=vulgar') ? PLAN_VULGAR : PLAN_ALL;
const STAMP = args.includes('--plan=vulgar') ? '2026-10-31' : '2026-10-18';

const plain = (b) => (gamecrypt.isEncoded(b) ? gamecrypt.decode(b) : b);
function encode(text) {
  let b = Buffer.from(text, 'latin1');
  if (b.length % 16) b = Buffer.concat([b, Buffer.alloc(16 - b.length % 16, 0x20)]);
  const e = crypto.createCipheriv('aes-256-ecb', gamecrypt.V8_KEY, null);
  e.setAutoPadding(false);
  const head = Buffer.alloc(4); head.writeInt32LE(gamecrypt.VERSION, 0);
  return Buffer.concat([head, e.update(b), e.final()]);
}
const qtLines = (text) => text.split(/\r?\n/).filter((l) => /^\s*QTITEM\b/.test(l));
const qtParse = (l) => { const t = l.split('//')[0].trim().split(/[\s,]+/); return { id: t[1] + ',' + t[2], rate: parseFloat(t[3]) }; };

// item check: each box must be a Q-box of type MOBGEN (8) that summons the named leader
{
  const g = new RccArchive(path.join(dataDir, 'glogic', 'GLogic.rcc'));
  const csv = plain(g.read(g.list().find((n) => n.toLowerCase() === 'item.csv'))).toString('latin1').split(/\r?\n/);
  const H = csv[0].split(','); const ip = H.indexOf('wParam1'), it = ip - 3;
  const items = new Map();
  for (const l of csv.slice(1)) { const c = l.split(','); if (c.length > ip) items.set(c[0] + ',' + c[1], { q: c[it], spawn: c[ip] + '/' + c[ip + 1] }); }
  for (const p of PLAN) {
    const box = p.box || null;
    if (!box) continue;
    const it2 = items.get(box);
    if (!it2 || it2.q !== '8' || it2.spawn !== p.leader.split(' ')[0]) throw new Error(`box ${box} does not summon ${p.leader}: ${JSON.stringify(it2)}`);
  }
}

const serverPath = path.join(dataDir, 'glogicserver', 'GLogicServer.rcc');
const server = new RccArchive(serverPath);
const sname = new Map(server.list().map((n) => [n.toLowerCase(), n]));
const readTable = (n) => { const e = sname.get(n.toLowerCase()); if (!e) throw new Error('table not in GLogicServer.rcc: ' + n); return plain(server.read(e)).toString('latin1').replace(/[\0 ]+$/, ''); };

const glogicPath = path.join(dataDir, 'glogic', 'GLogic.rcc');
const arc = new RccArchive(glogicPath);
const crowEntry = arc.list().find((n) => n.toLowerCase() === 'crow.mnsf');
const raw = arc.read(crowEntry);
const before = crowdata.parse(raw);
if (!before.eofExact) throw new Error('crow.mnsf does not parse to its last byte');
const byId = new Map(before.crows.map((c, i) => [`${c.main}/${c.sub}`, { c, i }]));

// decide each mob's new table; build new tables
const want = new Map();           // mob -> table name
const newTables = new Map();      // name -> text
for (const p of PLAN) {
  for (const m of p.mobs) {
    const r = byId.get(m); if (!r) throw new Error('mob not found ' + m);
    const cur = r.c.gen.qtGenItem;
    let src;
    if (p.base) {
      if (cur) throw new Error(`${m} has ${cur}; plan expected none`);
      src = p.base;
    } else {
      if (!cur) throw new Error(`${m} has no question table; plan expected one`);
      src = cur;
    }
    //  the source's lines, minus any line of this box (the q_002/q_003 tables carry it at 0.5)
    const lines = qtLines(readTable(src)).filter((l) => qtParse(l).id !== p.box);
    const sum = lines.reduce((s, l) => s + qtParse(l).rate, 0) + RATE;
    if (lines.length + 1 > 20 || sum > 100) throw new Error(`${src} + leader exceeds the limits`);
    const table = src.replace(/\.genitem$/i, '').toLowerCase() + '_ldr' + p.leader.split(' ')[0].replace('/', '_') + '.genitem';
    const text = `// ${src} + ${p.leader} summon box at ${RATE}% (crow-qt-leader.js, ${STAMP})\r\n` +
      lines.join('\r\n') + `\r\nQTITEM\t${p.box}\t${RATE}\t//MobGen ${p.leader}\r\n`;
    if (newTables.has(table) && newTables.get(table) !== text) throw new Error('two texts for ' + table);
    newTables.set(table, text);
    want.set(m, table);
  }
}

// crow.mnsf: rewrite m_strQtGenItem (first string after rates/item/money), last record first
const OFF = 132;
let body = bytecrypt.decode(Buffer.from(raw), crowdata.CROW_TABLE, OFF, raw.length);
const hits = [...want.keys()].map((m) => ({ m, ...byId.get(m) })).sort((a, b) => b.c.gen.at - a.c.gen.at);
for (const h of hits) {
  const p = h.c.gen.at + 12;
  const oldLen = body.readUInt32LE(p);
  const name = Buffer.from(want.get(h.m), 'latin1');
  const str = Buffer.alloc(4 + name.length + 1);
  str.writeUInt32LE(name.length + 1, 0); name.copy(str, 4);
  body = Buffer.concat([body.subarray(0, p), str, body.subarray(p + 4 + oldLen)]);
}
const outBuf = bytecrypt.encode(Buffer.from(body), crowdata.CROW_TABLE, OFF, body.length);
const after = crowdata.parse(outBuf);
if (!after.eofExact || after.count !== before.count) throw new Error('edited crow.mnsf does not parse the same');
const strip = (c) => JSON.stringify({ ...c, gen: c.gen ? { ...c.gen, at: 0, qtGenItem: '' } : null });
let diff = 0;
for (let i = 0; i < before.count; i++) {
  const a = before.crows[i], b = after.crows[i], id = `${a.main}/${a.sub}`;
  if (strip(a) !== strip(b)) throw new Error('record changed beyond the question table: ' + id);
  const qa = a.gen ? a.gen.qtGenItem : null, qb = b.gen ? b.gen.qtGenItem : null;
  if (qa !== qb) { if (want.get(id) !== qb) throw new Error('unexpected change ' + id); diff++; }
}
if (diff !== want.size) throw new Error(`changed ${diff}, wanted ${want.size}`);

for (const [m, t] of want) console.log(`${m.padEnd(5)} ${(byId.get(m).c.gen.qtGenItem || '(none)').padEnd(20)} -> ${t}`);
for (const [n, t] of newTables) console.log(`new ${n}: ${qtLines(t).length} lines`);
console.log(`crow.mnsf ${raw.length} -> ${outBuf.length} bytes, ${diff} mobs changed, every other field identical`);

if (write) {
  fs.mkdirSync(path.join(workDir, 'genitem'), { recursive: true });
  const crowFile = path.join(workDir, 'crow.mnsf');
  fs.writeFileSync(crowFile, outBuf);
  const repl = [];
  for (const [n, t] of newTables) {
    const f = path.join(workDir, 'genitem', n);
    const enc = encode(t);
    if (plain(enc).toString('latin1').replace(/ +$/, '') !== t) throw new Error('round trip failed ' + n);
    fs.writeFileSync(f, enc);
    repl.push([n, f]);
  }
  pack(glogicPath, path.join(workDir, 'GLogic.rcc'), [[crowEntry, crowFile]]);
  pack(serverPath, path.join(workDir, 'GLogicServer.rcc'), repl);
  console.log('written to', workDir);
}
