// Daily Hunter NPC 49/25 (2026-10-26): name, exchange list, talk file.
//   node mk_hunter_npcfiles.js <rcc-extract dir> <glogic dir> <offset-recording npcdialogue copy> <out dir>
// The talk file is npc_eventexchange.ntk (greeting + "แลก" exchange answer) with the greeting
// replaced and one answer added: a copy of 2007_chaos_Kate.ntk's quest-start answer (talk 11,
// condition level >= X, nothing else) given our five quests and level 90.
const fs = require('fs'), path = require('path');
const [, , T, G, NDOFF, O] = process.argv;
const { addLines, enc874, encodeV8 } = require('./strtab.js');
const g = require(T + '/gamecrypt.js');
const bc = require(T + '/bytecrypt.js');
const nd = require(NDOFF);                       // npcdialogue.js + offsets (start/end/countAt/condAt)
const { RccArchive } = require(T + '/rcc.js');
const th = new TextDecoder('windows-874');
fs.mkdirSync(O, { recursive: true });

const QUESTS = [3100, 3101, 3102, 3103, 3104];
const LEVEL = 90;
const GREETING = 'ภารกิจนักล่าประจำวัน! กำจัดมอนสเตอร์ที่กำหนดวันละ 200 ตัว (เลเวล 90 ขึ้นไป) รับเหรียญนักล่า แล้วนำมาแลกกล่องสุ่มนักล่าที่ฉัน ในกล่องอาจมีบัตรแลกเข็มขัดนักล่า';
const ANSWER = 'รับภารกิจนักล่าประจำวัน';

// 1. name
console.log('crow th', addLines(T, path.join(G, 'CrowStrTable.txt'), path.join(O, 'CrowStrTable.txt'), 'CN_049_024', [['CN_049_025', 'นักล่าประจำวัน']]));
console.log('crow en', addLines(T, path.join(G, 'CrowStrTable_en.txt'), path.join(O, 'CrowStrTable_en.txt'), 'CN_049_024', [['CN_049_025', 'Daily Hunter']]));

// 2. exchange list
const tail = '[65535,65535,1][65535,65535,1][65535,65535,1][65535,65535,1]';
const line = (id, rm, rs, qm, qs, n) => `NPC_EXCHANGE_ITEM=[${id}][${rm},${rs},1][0,0,0,0,0,0,0,0][${qm},${qs},${n}]${tail}`;
const ex = [
  ';npc item exchange',
  ';daily hunter (2026-10-26)',
  ';',
  '[NPC_EXCHANGE_BASIC]',
  'NPC_EXCHANGE_TITLE\t= แลก นักล่าประจำวัน',
  ';',
  ';id',
  ';result mid, result sid, result num',
  ';result att, result def, result res fire, result res ice, result res elect, result res poison, result res spirit, result gen RV,',
  ';require item mid, required item sid, required item num',
  ';',
  '[NPC_EXCHANGE_LIST]',
  line(1, 512, 75, 512, 74, 1),     // coin -> random box
  line(2, 512, 77, 512, 76, 1),     // card -> belt attack
  line(3, 512, 78, 512, 76, 1),     // card -> belt energy
  line(4, 512, 79, 512, 76, 1),     // card -> belt hit rate
  line(5, 512, 80, 512, 76, 1),     // card -> belt avoid
  '',
].join('\r\n');
const exBuf = encodeV8(g, enc874(ex));
if (th.decode(g.decode(exBuf)).replace(/ +$/, '') !== ex) throw new Error('npcex round trip');
fs.writeFileSync(path.join(O, 'dailyhunter.npcex'), exBuf);

// 3. talk file
const talkRcc = new RccArchive(path.join(G, 'npctalk', 'NpcTalk.rcc'));
const B0 = nd.BODY_OFFSET + 2;
const decodeBody = (raw) => { const b = Buffer.from(raw); bc.decode(b, nd.NPCTALK_TABLE, B0, b.length); return b; };
const encodeBody = (dec) => { const b = Buffer.from(dec); bc.encode(b, nd.NPCTALK_TABLE, B0, b.length); return b; };
const lp = (s) => { const b = Buffer.concat([enc874(s), Buffer.alloc(1)]); const h = Buffer.alloc(4); h.writeUInt32LE(b.length); return Buffer.concat([h, b]); };

// 3a. the template answer from Kate
const kate = nd.parse(talkRcc.read('2007_chaos_Kate.ntk'));
let tq = null;
for (const d of kate.dialogues) for (const cs of d.cases) for (const t of cs.talks)
  if (t.action === 3 && t.nid === 11 && t.ver === 0x200 && t.condAt !== undefined && t.condEnd - t.condAt === 83) tq = t;
if (!tq) throw new Error('Kate template answer not found');
const kb = kate.body;
const strLen = kb.readUInt32LE(tq.start + 6);
const afterStr = tq.start + 10 + strLen;
const QOFF = 4 + 4 + 4 + 4 + 40 + 40;          // action, actionNo, param1, param2, need[5], result[5]
let rest = Buffer.from(kb.subarray(afterStr, tq.end));
for (let i = 0; i < 5; i++) rest.writeUInt32LE(QUESTS[i] >>> 0, QOFF + 4 * i);
const lvAt = tq.condAt + 7 - afterStr;          // cond: u16 ver, bool enable, u32 sign, u16 level
if (kb.readUInt32LE(tq.condAt + 3) !== 4) throw new Error('template sign');
rest.writeUInt16LE(LEVEL, lvAt);

// 3b. start from the event NPC's talk, replace its greeting
const src = fs.readFileSync(path.join(G, 'npctalk', 'npc_eventexchange.ntk'));
const p0 = nd.parse(src);
const old = Buffer.from(p0.dialogues[0].cases[0].basicTalk.raw);
let dec = decodeBody(src);
const lpOld = Buffer.concat([Buffer.alloc(4), old]); lpOld.writeUInt32LE(old.length, 0);
const at = dec.indexOf(lpOld);
if (at < 0 || dec.indexOf(lpOld, at + 1) >= 0) throw new Error('greeting not found once');
dec = Buffer.concat([dec.subarray(0, at), lp(GREETING), dec.subarray(at + lpOld.length)]);

// 3c. add the answer in front of "แลก", count + 1
const p1 = nd.parse(encodeBody(dec));
const talks = p1.dialogues[0].cases[0].talks;
const nid = Math.max(...talks.map((t) => t.nid)) + 1;
const hdr = Buffer.alloc(6); hdr.writeUInt16LE(0x200, 0); hdr.writeUInt32LE(nid, 2);
const newTalk = Buffer.concat([hdr, lp(ANSWER), rest]);
const ins = talks[0].start;
dec = Buffer.concat([dec.subarray(0, ins), newTalk, dec.subarray(ins)]);
dec.writeInt32LE(dec.readInt32LE(talks.countAt) + 1, talks.countAt);
const ntk = encodeBody(dec);

// 3d. read back
const p2 = nd.parse(ntk);
if (!p2.eofExact) throw new Error('ntk does not parse to the end');
const t2 = p2.dialogues[0].cases[0].talks;
const q = t2.find((t) => t.action === 3);
if (!q || q.questStartIds.join() !== QUESTS.join() || p2.body.readUInt16LE(q.condAt + 7) !== LEVEL || th.decode(Buffer.from(q.talk)) !== ANSWER) throw new Error('quest answer read back');
const exAns = t2.find((t) => t.action !== 3);
const exAns0 = p0.dialogues[0].cases[0].talks[0];
if (!exAns || exAns.action !== exAns0.action || exAns.actionNo !== exAns0.actionNo || th.decode(Buffer.from(exAns.talk)) !== th.decode(Buffer.from(exAns0.talk))) throw new Error('exchange answer changed');
console.log('greeting:', th.decode(Buffer.from(p2.dialogues[0].cases[0].basicTalk.text)));
console.log('answers:', t2.map((t) => `${t.nid}:${th.decode(Buffer.from(t.talk))} action ${t.action}/${t.actionNo >>> 0}${t.action === 3 ? ' quests ' + t.questStartIds.join(',') + ' lv>=' + p2.body.readUInt16LE(t.condAt + 7) : ''}`).join(' | '));
fs.writeFileSync(path.join(O, 'npc_dailyhunter.ntk'), ntk);
console.log('ntk', ntk.length, 'bytes; dialogues', p2.dialogues.length);
