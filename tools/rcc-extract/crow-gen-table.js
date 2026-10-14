'use strict';
//
// `crow-gen-table.js` — give monsters that have no drop table one
// (SCROWGEN::m_strGenItem in crow.mnsf).
//
//   node crow-gen-table.js <CLIENT/data dir> <work dir> <main/sub=table.genitem> ... [--write]
//
// Only a monster whose m_strGenItem is empty is changed; anything else is
// refused. The string is CSerialFile's [DWORD count incl. NUL][bytes][NUL]
// inside the CROW byte cipher; SCROWGEN::LOAD (VERSION 0x0200, GLCrowDataGen.cpp
// :78, called from GLCrowData.cpp:489) reads it field by field and never seeks
// by the block size, so the record may grow. Every other byte of crow.mnsf is
// kept. The result is parsed again and compared record by record: same count,
// same ids, same fields, only the named monsters' table differs.
//
// The table must exist in GLogicServer.rcc. Without --write it only reports.
// With it, <work dir>/GLogic.rcc and <work dir>/crow.mnsf are written; the data
// dir is not touched.
//
const fs = require('fs');
const path = require('path');
const { RccArchive } = require('./rcc.js');
const gamecrypt = require('./gamecrypt.js');
const bytecrypt = require('./bytecrypt.js');
const crowdata = require('./crowdata.js');

const args = process.argv.slice(2);
const write = args.includes('--write');
const pos = args.filter((a) => !a.startsWith('--'));
const [dataDir, workDir] = pos;
const pairs = pos.slice(2).map((a) => { const m = /^(\d+)\/(\d+)=(.+\.genitem)$/i.exec(a); if (!m) throw new Error('bad pair ' + a); return { main: +m[1], sub: +m[2], table: m[3] }; });
if (!dataDir || !workDir || !pairs.length) { console.error('usage: node crow-gen-table.js <CLIENT/data> <work dir> <main/sub=table.genitem> ... [--write]'); process.exit(2); }

const server = new RccArchive(path.join(dataDir, 'glogicserver', 'GLogicServer.rcc'));
const tables = new Set(server.list().map((n) => n.toLowerCase()));
for (const p of pairs) if (!tables.has(p.table.toLowerCase())) throw new Error('table not in GLogicServer.rcc: ' + p.table);

const rccPath = path.join(dataDir, 'glogic', 'GLogic.rcc');
const arc = new RccArchive(rccPath);
const entry = arc.list().find((n) => n.toLowerCase() === 'crow.mnsf');
const raw = arc.read(entry);
if (gamecrypt.isEncoded(raw)) throw new Error('crow.mnsf is gamecrypt-wrapped; this tool edits the byte-cipher form only');
const before = crowdata.parse(raw);
if (!before.eofExact) throw new Error('crow.mnsf does not parse to its last byte');
if (before.fileVer < 0x0200) throw new Error('crow.mnsf is not in the byte cipher this tool writes');

// plain body, edited from the last record backwards so earlier offsets stay valid
const OFF = 132;
let body = bytecrypt.decode(Buffer.from(raw), crowdata.CROW_TABLE, OFF, raw.length);
const want = new Map(pairs.map((p) => [`${p.main}/${p.sub}`, p.table]));
const hits = [];
before.crows.forEach((c, i) => { const id = `${c.main}/${c.sub}`; if (want.has(id)) hits.push({ i, id, c }); });
for (const id of want.keys()) if (!hits.some((h) => h.id === id)) throw new Error('monster not found: ' + id);
for (const h of hits) if (!h.c.gen || h.c.gen.genItem !== '') throw new Error(`${h.id} already has a drop table: "${h.c.gen && h.c.gen.genItem}"`);
hits.sort((a, b) => b.c.gen.at - a.c.gen.at);
for (const h of hits) {
  let p = h.c.gen.at + 12;                    // after rates, item id, money
  p += 4 + body.readUInt32LE(p);              // m_strQtGenItem
  const oldLen = body.readUInt32LE(p);        // m_strGenItem
  const name = Buffer.from(want.get(h.id), 'latin1');
  const str = Buffer.alloc(4 + name.length + 1);
  str.writeUInt32LE(name.length + 1, 0); name.copy(str, 4);
  body = Buffer.concat([body.subarray(0, p), str, body.subarray(p + 4 + oldLen)]);
}
const outBuf = bytecrypt.encode(Buffer.from(body), crowdata.CROW_TABLE, OFF, body.length);

// verify: every record the same except the named tables
const after = crowdata.parse(outBuf);
if (!after.eofExact || after.count !== before.count) throw new Error('edited file does not parse the same');
const strip = (c) => { const g = c.gen ? { ...c.gen, at: 0, genItem: '' } : null; return JSON.stringify({ ...c, gen: g }); };
let diff = 0;
for (let i = 0; i < before.count; i++) {
  const a = before.crows[i], b = after.crows[i], id = `${a.main}/${a.sub}`;
  if (strip(a) !== strip(b)) throw new Error('record changed beyond the table: ' + id);
  const ga = a.gen ? a.gen.genItem : null, gb = b.gen ? b.gen.genItem : null;
  if (ga !== gb) {
    if (!want.has(id) || gb !== want.get(id)) throw new Error('unexpected table change: ' + id);
    diff++;
  }
}
if (diff !== want.size) throw new Error(`changed ${diff}, wanted ${want.size}`);
for (const h of hits.sort((a, b) => a.i - b.i)) console.log(`${h.id}  level ${h.c.level}  HP ${h.c.hp}  -> ${want.get(h.id)}`);
console.log(`crow.mnsf ${raw.length} -> ${outBuf.length} bytes, ${diff} monsters given a table, everything else identical`);

if (write) {
  fs.mkdirSync(workDir, { recursive: true });
  const f = path.join(workDir, 'crow.mnsf');
  fs.writeFileSync(f, outBuf);
  const o = path.join(workDir, 'GLogic.rcc');
  const log = console.log; console.log = () => {};
  try { require('./rcc-pack.js').pack(rccPath, o, [[entry, f]]); } finally { console.log = log; }
  console.log('packed', o);
}
