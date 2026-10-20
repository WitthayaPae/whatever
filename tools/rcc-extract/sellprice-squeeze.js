'use strict';
//
// `sellprice-squeeze.js` - lower every NPC sell price above a knee onto a log
// curve, so the old top lands on a new top (user, 2026-10-20: sell prices were
// capped at 20,000 on 2026-10-11; "make it not more than 7000-7500", re-squeeze
// everything over 1,000).
//
//   node sellprice-squeeze.js <item.isf in> <item.isf out> <report.csv>
//                             [--knee=1000] [--from=20000] [--to=7500] [--keep=1996_10]
//
// dwSellPrice is what SITEM::GETSELLPRICE returns: the per-unit money an NPC
// pays a player who sells the item (GLCharInvenMsg.cpp MsgReqSaleToNpc), before
// the shop rate. A price v > knee becomes
//     knee * (to/knee) ^ ( ln(v/knee) / ln(from/knee) )
// so knee stays knee, from becomes to, and the order of prices is kept. Items
// listed in --keep (the money coin) are left alone, and so is anything above
// --from, which only the coin is.
//
// The field is patched in place in the SITEMBASIC block (type 1, ver 0x0205):
// nativeId, groupId, emLevel, itemType, strName, fExpMultiple, two grade caps,
// flags, dwBuyPrice, then dwSellPrice. A record is patched only when that offset
// reads back the value itemdb.js parsed; the whole file is parsed again after,
// and every record must match the input in everything but the sell price.
//
const fs = require('fs');
const B = require('./bytecrypt.js');
const itemdb = require('./itemdb.js');
const { Cursor } = require('./itemdata.js');

const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const [IN, OUT, REPORT] = args.filter((a) => !a.startsWith('--'));
if (!IN || !OUT || !REPORT) { console.error('usage: node sellprice-squeeze.js <in.isf> <out.isf> <report.csv> [--knee= --from= --to= --keep=]'); process.exit(2); }
const KNEE = +opt('knee', 1000), FROM = +opt('from', 20000), TO = +opt('to', 7500);
const KEEP = new Set(opt('keep', '1996_10').split(',').filter(Boolean));
if (!(KNEE > 0 && FROM > KNEE && TO > KNEE)) throw new Error('need knee < to and knee < from');
const curve = (v) => Math.round(KNEE * Math.pow(TO / KNEE, Math.log(v / KNEE) / Math.log(FROM / KNEE)));

function load(buf) {
  const head = B.readHeader(buf);
  if (head.type !== 'GLITEM') throw new Error('not GLITEM');
  const body = B.decode(Buffer.from(buf), 'EMBYTECRYPT_ITEM', head.bodyOffset);
  const c = new Cursor(body, head.bodyOffset);
  const n = c.u32();
  const st = { badBasic: 0, failedItems: 0, sentinelFalsePositives: 0, oldBasicVersions: new Map() };
  const recs = [];
  for (let i = 0; i < n; i++) { const s = c.p; const it = itemdb.readItem(c, st); recs.push({ st: s, en: c.p, it }); }
  if (c.p !== body.length) throw new Error('walk did not end at EOF');
  return { head, body, recs };
}

const raw = fs.readFileSync(IN);
const A = load(raw);
const body = A.body;
const rows = [['item', 'old sell price', 'new sell price']];
let changed = 0, skipped = 0;
for (const r of A.recs) {
  const b = r.it.basic;
  if (!b) continue;
  const id = (b.nativeId & 0xffff) + '_' + (b.nativeId >>> 16);
  const v = b.sellPrice;
  if (v <= KNEE || v > FROM || KEEP.has(id)) continue;
  // the SITEMBASIC block: first block after the record's version DWORD
  const p = r.st + 4;
  const type = body.readUInt32LE(p), ver = body.readUInt32LE(p + 4), data = p + 12;
  if (type !== 1 || ver !== 0x0205) { skipped++; continue; }
  const nameLen = body.readUInt32LE(data + 16);
  const at = data + 16 + 4 + nameLen + 4 + 2 + 2 + 4 + 4;
  if (body.readUInt32LE(at) !== v || body.readUInt32LE(at - 4) !== b.buyPrice) throw new Error(id + ': sell price not at the expected offset');
  const nv = curve(v);
  body.writeUInt32LE(nv, at);
  rows.push([id, v, nv]);
  changed++;
}
const out = B.encode(Buffer.from(body), 'EMBYTECRYPT_ITEM', A.head.bodyOffset);

// read back: same records, only the sell prices moved
const Z = load(out);
if (Z.recs.length !== A.recs.length) throw new Error('record count changed');
const want = new Map(rows.slice(1).map(([id, , nv]) => [id, nv]));
const strip = (it) => JSON.stringify(it, (k, val) => (k === 'sellPrice' ? undefined : val));
for (let i = 0; i < A.recs.length; i++) {
  const a = A.recs[i].it, z = Z.recs[i].it;
  if (strip(a) !== strip(z)) throw new Error('record ' + i + ' changed beyond the sell price');
  if (!a.basic) continue;
  const id = (a.basic.nativeId & 0xffff) + '_' + (a.basic.nativeId >>> 16);
  const exp = want.has(id) ? want.get(id) : a.basic.sellPrice;
  if (z.basic.sellPrice !== exp) throw new Error(id + ': read back ' + z.basic.sellPrice + ' not ' + exp);
}
let max = 0;
for (const r of Z.recs) if (r.it.basic) {
  const id = (r.it.basic.nativeId & 0xffff) + '_' + (r.it.basic.nativeId >>> 16);
  if (!KEEP.has(id)) max = Math.max(max, r.it.basic.sellPrice);
}
fs.writeFileSync(OUT, out);
fs.writeFileSync(REPORT, '﻿' + rows.map((r) => r.join(',')).join('\r\n') + '\r\n');
console.log(`changed ${changed}, skipped (other SBASIC version) ${skipped}, highest sell price now ${max} (kept: ${[...KEEP].join(' ')})`);
