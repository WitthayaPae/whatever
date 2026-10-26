// Daily Hunter NPC talk, page 2 (2026-10-26).
//
// The quest-start answer was copied from 2007_chaos_Kate.ntk and kept Kate's target
// page (37). npc_dailyhunter.ntk has only page 1, so after accepting the quest the
// window could not move and kept showing the answer until the talk was reopened.
// Kate's answers go to a "you took it" page whose button returns to page 1, where the
// answer is hidden because the quest is now running. Same here:
//   page 2: PAGE2_TEXT, one answer (OK_TEXT) -> page 1 (EM_PAGE_MOVE, from Kate's page 6)
//   the quest answer's target: 37 -> 2
//   node mk_hunter_page2.js <rcc-extract dir> <npcdialogue-with-offsets.js> <in.ntk> <out.ntk> <NpcTalk.rcc>
const fs = require('fs');
const [, , T, NDOFF, IN, OUT, RCC] = process.argv;
const { enc874 } = require('./strtab.js');
const bc = require(T + '/bytecrypt.js');
const nd = require(NDOFF);
const { RccArchive } = require(T + '/rcc.js');
const th = new TextDecoder('windows-874');

const PAGE2_TEXT = 'รับภารกิจนักล่าประจำวันแล้ว! กำจัดมอนสเตอร์ตามภารกิจให้ครบ 200 ตัว แล้วรับเหรียญนักล่า นำมาแลกกล่องสุ่มนักล่าที่ฉันได้เลย';
const OK_TEXT = 'ตกลง';

const B0 = nd.BODY_OFFSET + 2;
const decodeBody = (raw) => { const b = Buffer.from(raw); bc.decode(b, nd.NPCTALK_TABLE, B0, b.length); return b; };
const encodeBody = (dec) => { const b = Buffer.from(dec); bc.encode(b, nd.NPCTALK_TABLE, B0, b.length); return b; };
const lp = (s) => { const b = Buffer.concat([enc874(s), Buffer.alloc(1)]); const h = Buffer.alloc(4); h.writeUInt32LE(b.length); return Buffer.concat([h, b]); };

const src = fs.readFileSync(IN);
const p0 = nd.parse(src);
if (p0.dialogues.length !== 1 || p0.dialogues[0].nid !== 1) throw new Error('expected only page 1');
const dec = decodeBody(src);

// layout: [134: 22 flag bytes][int nCount][page 1 ... to the end]
const COUNT_AT = B0 + 22;
const D1_AT = COUNT_AT + 4;
if (dec.readInt32LE(COUNT_AT) !== 1 || dec.readUInt32LE(D1_AT + 2) !== 1) throw new Error('layout');
const d1 = Buffer.from(dec.subarray(D1_AT));

// The answer that goes back to page 1: Kate page 6's only answer.
const kate = nd.parse(new RccArchive(RCC).read('2007_chaos_Kate.ntk'));
const k6 = kate.dialogues.find((d) => d.nid === 6);
const kt = k6 && k6.cases[0].talks.length === 1 ? k6.cases[0].talks[0] : null;
if (!kt || kt.action !== 1 || (kt.actionNo >>> 0) !== 1) throw new Error('Kate page 6 answer');
const kb = kate.body;
const ktLen = kb.readUInt32LE(kt.start + 6);
const kTail = kb.subarray(kt.start + 10 + ktLen, kt.end);		// action, target, params, items, ... unchanged
const okHdr = Buffer.alloc(6); okHdr.writeUInt16LE(kb.readUInt16LE(kt.start), 0); okHdr.writeUInt32LE(1, 2);
const okTalk = Buffer.concat([okHdr, lp(OK_TEXT), kTail]);

// Page 2 = page 1 with nid 2, the new greeting and the one answer.
const cs = p0.dialogues[0].cases[0];
const talks = cs.talks;
const t0 = talks[0].start - D1_AT, tEnd = talks[talks.length - 1].end - D1_AT, cntAt = talks.countAt - D1_AT;
let d2 = Buffer.concat([d1.subarray(0, t0), okTalk, d1.subarray(tEnd)]);
d2.writeInt32LE(1, cntAt);
d2.writeUInt32LE(2, 2);
const oldGreet = Buffer.from(cs.basicTalk.raw);
const lpOld = Buffer.concat([Buffer.alloc(4), oldGreet]); lpOld.writeUInt32LE(oldGreet.length, 0);
const g = d2.indexOf(lpOld);
if (g < 0 || d2.indexOf(lpOld, g + 1) >= 0) throw new Error('greeting not found once');
d2 = Buffer.concat([d2.subarray(0, g), lp(PAGE2_TEXT), d2.subarray(g + lpOld.length)]);

// The quest answer now targets page 2.
const q = talks.find((t) => t.action === 3);
const qLen = dec.readUInt32LE(q.start + 6);
const qTargetAt = q.start + 10 + qLen + 4;
if (dec.readUInt32LE(qTargetAt) !== (q.actionNo >>> 0)) throw new Error('quest target offset');
const out = Buffer.concat([dec.subarray(0, D1_AT), d1, d2]);
out.writeInt32LE(2, COUNT_AT);
out.writeUInt32LE(2, qTargetAt);
const ntk = encodeBody(out);

// read back
const p2 = nd.parse(ntk);
if (!p2.eofExact || p2.dialogues.length !== 2) throw new Error('does not parse');
const [a, b] = p2.dialogues;
const qa = a.cases[0].talks.find((t) => t.action === 3);
if ((qa.actionNo >>> 0) !== 2 || qa.questStartIds.slice(0, 5).join() !== '3100,3101,3102,3103,3104') throw new Error('quest answer');
if (b.nid !== 2 || b.cases[0].talks.length !== 1 || b.cases[0].talks[0].action !== 1 || (b.cases[0].talks[0].actionNo >>> 0) !== 1) throw new Error('page 2');
if (th.decode(Buffer.from(b.cases[0].basicTalk.text)) !== PAGE2_TEXT || th.decode(Buffer.from(b.cases[0].talks[0].talk)) !== OK_TEXT) throw new Error('page 2 text');
for (const d of p2.dialogues) for (const c of d.cases) for (const t of c.talks)
  console.log('page', d.nid, '|', th.decode(Buffer.from(t.talk)), '| action', t.action, '-> page', t.actionNo >>> 0);
fs.writeFileSync(OUT, ntk);
console.log('ok', ntk.length, 'bytes');
