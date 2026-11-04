// Academy sweep quests for Sacred Gate and Phoenix (2026-11-05), copies of Mystic Peak's
//   Q106 00091.qst "การกวาดล้างที่สถาบัน Mystic Peak"   lv24 kill Uncle Bald Head x30
//   Q110 00095.qst "การกวาดล้างที่สถาบัน Mystic Peak 2" lv25 kill Fu x34, orb 4
// (user: "it should be similar like MP have การกวาดล้างสถาบัน ... for each school", then
// "Full copies for SG + PHX"). Both monsters spawn in every academy (Level.rcc, 2/0 / 5/0 / 8/0
// and the matching rooms), so only school, hand-in NPC and texts change:
//   3125 00091s.qst  SG  -> 9/27 ห้องวิทยาศาสตร์   3126 00095s.qst  SG  (needs 3125)
//   3127 00091b.qst  PHX -> 34/31 ห้องพัสดุ        3128 00095b.qst  PHX (needs 3127)
// (3105-3124 are named by old 2015 event NPC files, so not used.) File names lowercase = the RCC entry.
// NPC answers are copies of MP 32/22's talks 10-13 (npc_2_haksen1_1.ntk): start (level, school,
// previous quest), hand-in (quest at step 1). Pages: Phoenix's own Uncle Bald Head / Fu pages
// (12->13, 15->16); SG gets copies of those four pages (new nids 20-23).
//
//   node mk_academy_quests.js <rcc-extract dir> <glogic dir> <out dir>
// Writes into <out dir>: the 4 .qst, quest.lst, npc_1_gwahak_1.ntk, npc_3_gyobo_1.ntk.
const fs = require('fs'), path = require('path');
const [, , T, G, O] = process.argv;
const { RccArchive } = require(T + '/rcc.js');
const bc = require(T + '/bytecrypt.js');
const q2 = require(T + '/quest202.js');
const nd = require(T + '/npcdialogue-off.js');
const { enc874 } = require('./strtab.js');
const th = new TextDecoder('windows-874');
fs.mkdirSync(O, { recursive: true });
const nidOf = (m, s) => ((s << 16) | m) >>> 0;
const UINT_MAX = 0xffffffff;
const assert = (c, m) => { if (!c) throw new Error(m); };

const SETS = [
  { school: 0, sName: 'Sacred Gate', npc: nidOf(9, 27),  talkText: 'เปิดตู้สื่อสารที่ศูนย์วิทยาศาสตร์', ntk: 'npc_1_gwahak_1.ntk', A: 3125, B: 3126, fA: '00091s.qst', fB: '00095s.qst' },
  { school: 2, sName: 'Phoenix',     npc: nidOf(34, 31), talkText: 'เปิดตู้สื่อสารที่ห้องพัสดุ',      ntk: 'npc_3_gyobo_1.ntk',  A: 3127, B: 3128, fA: '00091b.qst', fB: '00095b.qst' },
];
const MP_NPC = nidOf(32, 22);

// ---------------------------------------------------------------- quests
const qa = new RccArchive(path.join(G, 'quest', 'Quest.rcc'));
const qlist = qa.list();
const readQ = (f) => { const raw = qa.read(qlist.find((x) => x.toLowerCase() === f)); const body = Buffer.from(raw.subarray(132)); bc.decode(body, 'EMBYTECRYPT_OLD'); return { head: Buffer.from(raw.subarray(0, 132)), body }; };
const lst = qa.read(qlist.find((x) => x.toLowerCase() === 'quest.lst')).toString('latin1');
const usedIds = new Set(lst.split(/\r?\n/).map((l) => (l.match(/^QUEST\s+(\d+)/) || [])[1]).filter(Boolean).map(Number));

function makeQuest(src, school, title, npc, talkText) {
  const { head, body } = readQ(src);
  const q = q2.parse(body);
  assert(q2.startGet(q).school === 1, src + ' is not MP');
  assert(q.steps.length === 2 && q.steps[1].npcTalkId === MP_NPC, src + ' hand-in is not 32/22');
  q.title = q2.mkStr(enc874(title));
  q2.startSetSchool(q, school);
  q.steps[1].npcTalkId = npc;
  q.steps[1].npcTalkText = q2.mkStr(enc874(talkText));
  const outBody = q2.write(q);
  const back = q2.parse(outBody);
  assert(q2.S(back.title, th) === title && q2.startGet(back).school === school && back.steps[1].npcTalkId === npc, 'quest read back ' + title);
  // everything else as the template: kill target, counts, rewards
  const t = q2.parse(body);
  assert(back.steps[0].mobKillId === t.steps[0].mobKillId && back.steps[0].mobKillNum === t.steps[0].mobKillNum, 'kill changed');
  assert(Buffer.compare(back.giftItems, t.giftItems) === 0 && Buffer.compare(back.giftExp, t.giftExp) === 0, 'reward changed');
  const enc = Buffer.from(outBody); bc.encode(enc, 'EMBYTECRYPT_OLD');
  return Buffer.concat([head, enc]);
}

let lstOut = lst.replace(/\s+$/, '') + '\r\n';
for (const s of SETS) {
  for (const [id, f, src, title] of [[s.A, s.fA, '00091.qst', `การกวาดล้างที่สถาบัน ${s.sName}`], [s.B, s.fB, '00095.qst', `การกวาดล้างที่สถาบัน ${s.sName} 2`]]) {
    assert(!usedIds.has(id), 'quest id in use ' + id);
    assert(!qlist.some((x) => x.toLowerCase() === f.toLowerCase()), 'file exists ' + f);
    fs.writeFileSync(path.join(O, f), makeQuest(src, s.school, title, s.npc, s.talkText));
    lstOut += `QUEST\t${id}\t${f}\t//` + enc874(title).toString('latin1') + '\r\n';
    console.log('quest', id, f, title);
  }
}
fs.writeFileSync(path.join(O, 'quest.lst'), Buffer.from(lstOut, 'latin1'));

// ---------------------------------------------------------------- NPC answers
const na = new RccArchive(path.join(G, 'npctalk', 'NpcTalk.rcc'));
const B0 = nd.BODY_OFFSET + 2;
const readNtk = (f) => na.read(na.list().find((x) => x.toLowerCase() === f));
const encodeBody = (dec) => { const b = Buffer.from(dec); bc.encode(b, nd.NPCTALK_TABLE, B0, b.length); return b; };
const lp = (s) => { const b = Buffer.concat([enc874(s), Buffer.alloc(1)]); const h = Buffer.alloc(4); h.writeUInt32LE(b.length); return Buffer.concat([h, b]); };
// condition 0x0010 field offsets from condAt (u16 ver, bool enable, u32 signLevel, u16 level, u32 class, u16 school, ...)
const C_SCHOOL = 13, C_QUEST = 51, C_DONEN = 59, C_DONE0 = 63;

const mp = nd.parse(readNtk('npc_2_haksen1_1.ntk'));
const mpTalks = mp.dialogues[0].cases[0].talks;
const tpl = (nid) => { const t = mpTalks.find((x) => x.nid === nid); assert(t && t.ver === 0x200 && t.cond && t.cond.ver === 0x10, 'MP talk ' + nid); return t; };
const T_START_A = tpl(10), T_DONE_A = tpl(11), T_START_B = tpl(12), T_DONE_B = tpl(13);
assert(T_START_A.questStartIds[0] === 106 && T_DONE_A.param1 === 106 && T_START_B.questStartIds[0] === 110 && T_DONE_B.param1 === 110, 'MP talk quests');
assert(T_START_B.cond.completeQuest.length === 1 && T_START_B.cond.completeQuest[0] === 106, 'MP Q110 needs Q106');

// A talk copied from MP with a new nid / text, quest, school, page and previous quest.
function copyTalk(t, nid, text, quest, school, page, needQuest) {
  const b = mp.body;
  const strLen = b.readUInt32LE(t.start + 6);
  const afterStr = t.start + 10 + strLen;
  const rest = Buffer.from(b.subarray(afterStr, t.end));
  const R = (abs) => abs - afterStr;
  assert(rest.readInt32LE(0) === t.action && rest.readUInt32LE(8) === t.param1, 'talk layout');
  rest.writeUInt32LE(page >>> 0, 4);                          // actionNo: the page it opens
  if (t.param1 !== UINT_MAX) rest.writeUInt32LE(quest, 8);    // param1: the quest
  for (let i = 0; i < 5; i++) {                               // quest start ids
    const at = 96 + 4 * i;
    if (rest.readUInt32LE(at) !== UINT_MAX) rest.writeUInt32LE(quest, at);
  }
  const ca = R(t.condAt);
  assert(rest.readUInt16LE(ca) === 0x10 && rest.readUInt16LE(ca + C_SCHOOL) === t.cond.school && rest.readUInt32LE(ca + C_QUEST) === t.cond.questNid, 'cond layout');
  rest.writeUInt16LE(school, ca + C_SCHOOL);
  if (t.cond.questNid !== UINT_MAX) rest.writeUInt32LE(quest, ca + C_QUEST);
  const nDone = rest.readInt32LE(ca + C_DONEN);
  assert(nDone === t.cond.completeQuest.length, 'cond done count');
  if (nDone) { assert(needQuest !== undefined, 'needs a previous quest'); rest.writeUInt32LE(needQuest, ca + C_DONE0); }
  const hdr = Buffer.alloc(6); hdr.writeUInt16LE(t.ver, 0); hdr.writeUInt32LE(nid, 2);
  return Buffer.concat([hdr, lp(text), rest]);
}

// A whole page copied from another NPC file, renumbered; its talks' pages remapped, school set.
function copyDialogue(p, nid, newNid, pageMap, school) {
  const d = p.dialogues.find((x) => x.nid === nid);
  assert(d, 'page ' + nid);
  const out = Buffer.from(p.body.subarray(d.start, d.end));
  out.writeUInt32LE(newNid, 2);
  for (const cs of d.cases) for (const t of cs.talks) {
    const rel = (abs) => abs - d.start;
    const strLen = p.body.readUInt32LE(t.start + 6);
    const afterStr = rel(t.start) + 10 + strLen;
    if (pageMap[t.actionNo] !== undefined) out.writeUInt32LE(pageMap[t.actionNo], afterStr + 4);
    if (t.cond && t.cond.ver === 0x10 && t.cond.school !== 10) out.writeUInt16LE(school, rel(t.condAt) + C_SCHOOL);
  }
  return out;
}

const PHX = nd.parse(readNtk('npc_3_gyobo_1.ntk'));
for (const s of SETS) {
  const src = readNtk(s.ntk);
  const p = nd.parse(src);
  assert(p.eofExact, s.ntk + ' parse');
  let dec = Buffer.from(p.body);
  const talks = p.dialogues[0].cases[0].talks;
  const nextNid = Math.max(...talks.map((t) => t.nid)) + 1;
  //  this NPC's own "sweep confirmed" answer: the hand-in of its lv24 sweep (SG Q64, PHX Q148)
  const doneT = talks.find((t) => t.action === 4 && t.param1 === (s.school === 0 ? 64 : 148));
  assert(doneT, s.ntk + ' hand-in answer');
  const DONE_PAGE = doneT.actionNo >>> 0;
  let pageA, pageB, newPages = [];
  if (s.school === 2) { pageA = 12; pageB = 15; }            // Phoenix: its own Uncle Bald Head / Fu pages
  else {
    const used = new Set(p.dialogues.map((d) => d.nid));
    [20, 21, 22, 23].forEach((n) => assert(!used.has(n), 'SG page nid in use ' + n));
    const map = { 13: 21, 16: 23 };
    newPages = [copyDialogue(PHX, 12, 20, map, 0), copyDialogue(PHX, 13, 21, map, 0), copyDialogue(PHX, 15, 22, map, 0), copyDialogue(PHX, 16, 23, map, 0)];
    pageA = 20; pageB = 22;
  }
  const doneText = th.decode(Buffer.from(doneT.talk));
  const add = [
    copyTalk(T_START_A, nextNid,     `การกวาดล้างที่สถาบัน ${s.sName}`,   s.A, s.school, pageA),
    copyTalk(T_DONE_A,  nextNid + 1, doneText,                            s.A, s.school, DONE_PAGE),
    copyTalk(T_START_B, nextNid + 2, `การกวาดล้างที่สถาบัน ${s.sName} 2`, s.B, s.school, pageB, s.A),
    copyTalk(T_DONE_B,  nextNid + 3, doneText,                            s.B, s.school, DONE_PAGE),
  ];
  // the later edit first, so the earlier offsets stay true: pages at the end, then the answers
  if (newPages.length) {
    const endAt = p.dialogues[p.dialogues.length - 1].end;
    dec = Buffer.concat([dec.subarray(0, endAt), ...newPages, dec.subarray(endAt)]);
    dec.writeInt32LE(dec.readInt32LE(p.dlgCountAt) + newPages.length, p.dlgCountAt);
  }
  const insAt = talks[talks.length - 1].end;
  dec = Buffer.concat([dec.subarray(0, insAt), ...add, dec.subarray(insAt)]);
  dec.writeInt32LE(dec.readInt32LE(talks.countAt) + add.length, talks.countAt);
  const ntk = encodeBody(dec);

  // read back: everything that was there is unchanged, the new answers say what they should
  const p2 = nd.parse(ntk);
  assert(p2.eofExact, s.ntk + ' new file parse');
  assert(p2.dialogues.length === p.dialogues.length + newPages.length, 'page count');
  const t2 = p2.dialogues[0].cases[0].talks;
  assert(t2.length === talks.length + 4, 'answer count');
  for (let i = 0; i < talks.length; i++) {
    const a = talks[i], b = t2[i];
    assert(a.nid === b.nid && a.action === b.action && a.actionNo === b.actionNo && a.param1 === b.param1 && JSON.stringify(a.cond) === JSON.stringify(b.cond), 'old answer changed ' + a.nid);
  }
  for (let i = 1; i < p.dialogues.length; i++) assert(Buffer.compare(p.body.subarray(p.dialogues[i].start, p.dialogues[i].end), p2.body.subarray(p2.dialogues[i].start, p2.dialogues[i].end)) === 0, 'old page changed');
  const n = t2.slice(talks.length);
  const show = (t) => `${t.nid} "${th.decode(Buffer.from(t.talk))}" action ${t.action}/${t.actionNo >>> 0} quest ${t.action === 3 ? t.questStartIds[0] : t.param1} | lv ${t.cond.signLevel}/${t.cond.level} school ${t.cond.school} step-of ${t.cond.questNid === UINT_MAX ? '-' : t.cond.questNid + '#' + t.cond.questStep} done [${t.cond.completeQuest}]`;
  assert(n[0].questStartIds[0] === s.A && n[1].param1 === s.A && n[1].cond.questNid === s.A && n[2].questStartIds[0] === s.B && n[2].cond.completeQuest[0] === s.A && n[3].cond.questNid === s.B, 'new answers');
  n.forEach((t) => assert(t.cond.school === s.school, 'school'));
  console.log('\n' + s.ntk + ': ' + n.length + ' answers, ' + newPages.length + ' pages');
  n.forEach((t) => console.log('   ' + show(t)));
  for (const d of p2.dialogues.slice(p.dialogues.length))
    console.log(`   page ${d.nid}: "${th.decode(Buffer.from(d.cases[0].basicTalk.text)).slice(0, 50)}" -> ${d.cases[0].talks.map((t) => 'page ' + (t.actionNo >>> 0) + ' school ' + (t.cond ? t.cond.school : '-')).join(', ')}`);
  fs.writeFileSync(path.join(O, s.ntk), ntk);
}
console.log('\nwrote', O);
