// Add NPC 49/24 "แลก ไอเท็มกิจกรรม" to crow.mnsf as a copy of 49/21 (npc_spender:
// an item-exchange NPC): new native id and name key, talk file
// npc_eventexchange.ntk, item-exchange file eventexchange.npcex.
//   node mk_crow.js <tools dir> <crow.mnsf in> <crow.mnsf out>
const [, , T, IN, OUT] = process.argv;
const fs = require('fs');
const bc = require(T + '/bytecrypt.js');
const cd = require(T + '/crowdata.js');

const raw = fs.readFileSync(IN);
const OFF = cd.BODY_OFFSET;
const body = bc.decode(Buffer.from(raw), cd.CROW_TABLE, OFF, raw.length);
const n = body.readUInt32LE(OFF + 4);

// record spans (same walk as crowdata.js; the GEN block is parsed structurally)
const recs = []; let o = OFF + 8;
for (let i = 0; i < n; i++) {
  const st = o; o += 4; let dt = body.readUInt32LE(o); o += 4; const blocks = [];
  while (dt !== 0xEDEDEDED) {
    const ver = body.readUInt32LE(o), size = body.readUInt32LE(o + 4); const bs = o + 8; let be = bs + size;
    if (dt === 3) { let q = bs + 12; q += 4 + body.readUInt32LE(q); q += 4 + body.readUInt32LE(q); q += 4 + 2; be = q; }
    blocks.push({ dt, ver, size, hdr: o - 4, bs, be }); o = be; dt = body.readUInt32LE(o); o += 4;
  }
  recs.push({ st, en: o, blocks, main: body.readUInt16LE(blocks[0].bs), sub: body.readUInt16LE(blocks[0].bs + 2) });
}
if (o !== body.length) throw new Error('walk end ' + o + ' / ' + body.length);
if (recs.some((r) => r.main === 49 && r.sub === 24)) throw new Error('49/24 exists');
const tpl = recs.find((r) => r.main === 49 && r.sub === 21);
if (!tpl) throw new Error('49/21 missing');

const lp = (s) => { const b = Buffer.concat([Buffer.alloc(4), Buffer.from(s, 'latin1'), Buffer.alloc(1)]); b.writeUInt32LE(s.length + 1, 0); return b; };
let rec = Buffer.from(body.slice(tpl.st, tpl.en));
const base = tpl.st;
const basic = tpl.blocks.find((b) => b.dt === 1), act = tpl.blocks.find((b) => b.dt === 2);
rec.writeUInt16LE(49, basic.bs - base); rec.writeUInt16LE(24, basic.bs - base + 2);
{ const at = basic.bs - base + 16; const nm = Buffer.alloc(33); Buffer.from('CN_049_024', 'latin1').copy(nm);
  const old = rec.slice(at, at + 33).toString('latin1').replace(/\0.*$/s, ''); if (old !== 'CN_049_021') throw new Error('name key ' + old);
  nm.copy(rec, at); }
let delta = 0;
for (const [from, to] of [['npc_spender.ntk', 'npc_eventexchange.ntk'], ['spender.npcex', 'eventexchange.npcex']]) {
  const f = lp(from), i = rec.indexOf(f, act.bs - base);
  if (i < 0 || i > act.be - base + delta) throw new Error('not in action block: ' + from);
  if (rec.indexOf(f, i + 1) >= 0 && rec.indexOf(f, i + 1) < act.be - base + delta) throw new Error('twice: ' + from);
  rec = Buffer.concat([rec.slice(0, i), lp(to), rec.slice(i + f.length)]);
  delta += lp(to).length - f.length;
}
// the action block's declared size (BeginBlock/EndBlock): exact, so it grows with the strings
const sizeAt = act.bs - base - 4;
if (rec.readUInt32LE(sizeAt) !== act.size) throw new Error('action size field');
rec.writeUInt32LE(act.size + delta, sizeAt);

// insert right after 49/23 (or the template), count + 1
const after = recs.find((r) => r.main === 49 && r.sub === 23) || tpl;
const out = Buffer.concat([body.slice(0, after.en), rec, body.slice(after.en)]);
out.writeUInt32LE(n + 1, OFF + 4);
const enc = bc.encode(Buffer.from(out), cd.CROW_TABLE, OFF, out.length);

// read back with the shipped parser
const p = cd.parse(enc), p0 = cd.parse(raw);
if (!p.eofExact || p.count !== n + 1) throw new Error('read back: ' + JSON.stringify({ eof: p.eofExact, count: p.count }));
const strip = (c) => JSON.stringify(c, (k, v) => (k === 'at' ? undefined : v));   // gen.at is a file offset: it moves for every record after the insert
const others = p.crows.filter((c) => !(c.main === 49 && c.sub === 24));
if (others.length !== p0.crows.length || others.some((c, i) => strip(c) !== strip(p0.crows[i]))) throw new Error('another crow changed');
const mine = p.crows.find((c) => c.main === 49 && c.sub === 24);
const t21 = p0.crows.find((c) => c.main === 49 && c.sub === 21);
console.log('new', JSON.stringify(mine));
console.log('tpl', JSON.stringify(t21));
// the exchange file string is past what crowdata reads: check it in the decoded body
const dec = bc.decode(Buffer.from(enc), cd.CROW_TABLE, OFF, enc.length);
console.log('exchange string present:', dec.includes(lp('eventexchange.npcex')), 'count', n + 1);
fs.writeFileSync(OUT, enc);
console.log('wrote', OUT, enc.length);
