// Daily Hunter quests (2026-10-26): five one-step "kill 200" quests, one offered per day
// (EMQF_ROTATE, SNpcTalk::RotateBlocked). Each is a copy of QUEST_1914.qst (version 0x15,
// item reward) cut to one step; only the fields below change, every other byte is the
// template's. The result is re-read with questdata.js and must parse to its last byte.
//   node mk_hunter_quests.js <rcc-extract dir> <Quest.rcc> <out dir>
const fs = require('fs'), path = require('path');
const [, , T, RCC, OUT] = process.argv;
const { RccArchive } = require(T + '/rcc.js');
const qd = require(T + '/questdata.js');
const bc = require(T + '/bytecrypt.js');
const { enc874 } = require('./strtab.js');

const FIRST_ID = 3100;
const COIN = { m: 512, s: 74 };
const FLAGS = 0x0001 | 0x0002 | 0x0008 | 0x0010 | 0x0020;   // repeat, again, give up, daily, rotate
const MOBS = [
  { m: 13, s: 17, name: 'Haunted Boy', lv: 101 },
  { m: 13, s: 21, name: 'Serial Killer', lv: 102 },
  { m: 36, s: 8, name: 'Freezing Clown', lv: 100 },
  { m: 13, s: 22, name: 'Prison Guard', lv: 104 },
  { m: 36, s: 10, name: 'Wrestler', lv: 104 },
];
const KILLS = 200;

const a = new RccArchive(RCC);
const tmplRaw = a.read('QUEST_1914.qst');
const head = tmplRaw.subarray(0, 132);
const body = Buffer.from(tmplRaw.subarray(132));
bc.decode(body, 'EMBYTECRYPT_OLD');

// --- walk the template recording spans (version 0x15 layout, as questdata.js reads it)
let p = 0;
const u32 = () => { const v = body.readUInt32LE(p); p += 4; return v; };
const str = () => { const n = u32(); const at = p; p += n; return { at: at - 4, end: p }; };
const ver = u32(); if (ver !== 0x15) throw new Error('template version ' + ver);
u32();                                  // editVer
const sTitle = str(), sComment = str();
const flagsAt = p; u32();
const startAt = p; u32(); const stSize = u32(); p += stSize;    // startopt block
p += 4 + 4 + 4 + 1 + 4;                 // beginParty, beginMoney, limitTime, nonDie, limitParty
const nStepsAt = p; const nSteps = u32();
const step0At = p;
// step 0 (ver >= 0x12): ver, title, comment, mobKillId, mobKillNum, mobKillText, rest...
const stepVer = u32();
const st0Title = str(), st0Comment = str();
const mobIdAt = p; p += 8;
const st0Kill = str();
const st0RestAt = p;
// find the end of step 0 and of all steps by re-reading with questdata's Reader
function stepsEnd() {
  const r = new qd.Reader(body); r.p = nStepsAt + 4;
  const ends = [];
  // replicate readStep for >=0x12 to know each end
  for (let i = 0; i < nSteps; i++) {
    const v = r.u32(); r.str(); r.str(); r.u32(); r.u32(); r.str();
    r.u32(); const ng = r.u32(); for (let k = 0; k < ng; k++) { r.u32(); r.u32(); r.u16(); r.f32(); r.vecDword(); }
    r.str(); r.u32(); r.str();
    r.u32(); r.u16(); r.u16(); r.u16(); r.str();
    r.u16();
    r.u32(); r.str();
    r.u32(); r.u16(); r.u16(); r.u16(); r.f32(); r.str();
    const itemSize = qd.ITEMCUSTOM[{ 0x12: 112, 0x13: 115, 0x15: 116 }[v]];
    r.vecItem(itemSize); r.vecDword();
    r.u32(); r.u16(); r.u16(); r.u32();
    ends.push(r.p);
  }
  return ends;
}
const ends = stepsEnd();
const rewardAt = ends[ends.length - 1];
// reward (new layout): money u32, exp i64, sp, stat, life, dispk, element, quest, items vec
const itemsVecAt = rewardAt + 4 + 8 + 4 * 6;
const nItems = body.readUInt32LE(itemsVecAt);
if (nItems !== 1) throw new Error('template reward items ' + nItems);
const item0At = itemsVecAt + 4;

const lp = (s) => { const b = Buffer.concat([enc874(s), Buffer.alloc(1)]); const h = Buffer.alloc(4); h.writeUInt32LE(b.length); return Buffer.concat([h, b]); };
const u32b = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };

fs.mkdirSync(OUT, { recursive: true });
const th = new TextDecoder('windows-874');
const lst = [];
MOBS.forEach((mob, i) => {
  const id = FIRST_ID + i;
  const title = `[ภารกิจนักล่าประจำวัน] กำจัด ${mob.name}`;
  const comment = `กำจัด ${mob.name} (Lv.${mob.lv}) ให้ครบ ${KILLS} ตัว รับเหรียญนักล่า 1 เหรียญ นำไปแลกกล่องสุ่มนักล่าได้ที่ NPC นักล่าประจำวัน (ทำได้วันละ 1 ครั้ง)`;
  const stepTitle = `กำจัด ${mob.name} ${KILLS} ตัว`;
  const reward = Buffer.from(body.subarray(rewardAt));
  const itemOff = item0At - rewardAt;
  reward.writeUInt32LE((COIN.m | (COIN.s << 16)) >>> 0, itemOff);
  const mobBuf = Buffer.alloc(8); mobBuf.writeUInt32LE((mob.m | (mob.s << 16)) >>> 0, 0); mobBuf.writeUInt32LE(KILLS, 4);
  const out = Buffer.concat([
    body.subarray(0, sTitle.at),                 // ver, editVer
    lp(title), lp(comment),
    u32b(FLAGS),
    body.subarray(startAt, nStepsAt),           // startopt .. limitParty, unchanged
    u32b(1),
    body.subarray(step0At, st0Title.at),        // step version
    lp(stepTitle), lp(stepTitle),
    mobBuf,
    lp(stepTitle),
    body.subarray(st0RestAt, ends[0]),           // rest of step 0, unchanged
    reward,
  ]);
  // check: parses to the end, fields as meant
  const enc = Buffer.from(out); bc.encode(enc, 'EMBYTECRYPT_OLD');
  const file = Buffer.concat([head, enc]);
  const r = qd.decodeQst(file, bc);
  if (!r.eofExact) throw new Error('quest ' + id + ' does not parse to the end: ' + r.error);
  const q = r.quest;
  if (q.flags !== FLAGS || q.steps.length !== 1 || q.steps[0].mobKillId !== ((mob.m | (mob.s << 16)) >>> 0) || q.steps[0].mobKillNum !== KILLS) throw new Error('quest ' + id + ' fields');
  if (q.gift.items.length !== 1 || q.gift.items[0].m !== COIN.m || q.gift.items[0].s !== COIN.s) throw new Error('quest ' + id + ' reward');
  if (th.decode(Buffer.from(q.title, 'latin1')) !== title) throw new Error('quest ' + id + ' title');
  const name = `daily_hunter_${i + 1}.qst`;
  fs.writeFileSync(path.join(OUT, name), file);
  lst.push(`QUEST\t${id}\t${name}\t//${title}`);
  console.log(id, name, title, '| kill', mob.m + '/' + mob.s, KILLS, '| reward', COIN.m + '/' + COIN.s, '| exp', q.gift.exp, 'money', q.gift.money);
});

// quest.lst: append the five lines (cp874, the list's own line ending)
const lstRaw = a.read('quest.lst');
const lstTxt = lstRaw.toString('latin1');
const nl = lstTxt.includes('\r\n') ? '\r\n' : '\n';
if (/QUEST\s+31\d\d\s/.test(lstTxt)) throw new Error('ids 31xx already in quest.lst');
const add = lst.map((l) => enc874(l).toString('latin1')).join(nl) + nl;
const newLst = lstTxt.replace(/\s*$/, '') + nl + add;
fs.writeFileSync(path.join(OUT, 'quest.lst'), Buffer.from(newLst, 'latin1'));
console.log('quest.lst', lstTxt.split(nl).length, '->', newLst.split(nl).length, 'lines');
