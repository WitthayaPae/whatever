'use strict';
//
// GLQUEST version 0x0202 (the editor's current format) - read AND write, so a
// quest can be copied and changed (2026-11-05, new academy sweep quests for SG
// and Phoenix). Mirrors SOURCE GLQUEST::LOAD_0202 / GLQUEST_STEP::LOAD_0201
// (GLQuest.cpp, GLQuestStep.cpp). The proof is the round trip: every 0x0202
// quest in Quest.rcc must be rewritten byte for byte (selftest below).
//
//   [128 type][u32 0][ body @132, EMBYTECRYPT_OLD ]
//   body: u32 0x0202, then LOAD_0202
// std::string = [u32 len incl NUL][bytes]; bool = 1 byte; vector<T> = [u32 n][n * sizeof T];
// SITEMCUSTOM = 80 bytes (layout probe); GLQUEST_START / ATTENDANCE = [u32 ver][u32 size][body].
//
const ITEM = 80;

class R {
  constructor(b) { this.b = b; this.p = 0; }
  u8() { return this.b[this.p++]; }
  u16() { const v = this.b.readUInt16LE(this.p); this.p += 2; return v; }
  u32() { const v = this.b.readUInt32LE(this.p); this.p += 4; return v; }
  f32() { const v = this.b.readFloatLE(this.p); this.p += 4; return v; }
  raw(n) { const v = Buffer.from(this.b.subarray(this.p, this.p + n)); this.p += n; if (v.length !== n) throw new Error('eof'); return v; }
  str() { const n = this.u32(); const v = this.raw(n); return v; }           // raw bytes incl NUL
  block() { const ver = this.u32(), size = this.u32(); return { ver, body: this.raw(size) }; }
  vecDw() { const n = this.u32(); const a = []; for (let i = 0; i < n; i++) a.push(this.u32()); return a; }
  vecItem() { const n = this.u32(); return this.raw(n * ITEM); }               // n recovered from length
}
class W {
  constructor() { this.parts = []; }
  u8(v) { this.parts.push(Buffer.from([v & 255])); }
  u16(v) { const b = Buffer.alloc(2); b.writeUInt16LE(v >>> 0, 0); this.parts.push(b); }
  u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); this.parts.push(b); }
  f32(v) { const b = Buffer.alloc(4); b.writeFloatLE(v, 0); this.parts.push(b); }
  raw(b) { this.parts.push(Buffer.from(b)); }
  str(b) { this.u32(b.length); this.raw(b); }
  block(k) { this.u32(k.ver); this.u32(k.body.length); this.raw(k.body); }
  vecDw(a) { this.u32(a.length); for (const v of a) this.u32(v); }
  vecItem(b) { this.u32(b.length / ITEM); this.raw(b); }
  buf() { return Buffer.concat(this.parts); }
}

function readStep(r) {
  const s = { ver: r.u32() };
  if (s.ver !== 0x0201) throw new Error('step version ' + s.ver.toString(16));
  s.title = r.str(); s.comment = r.str();
  s.mobKillId = r.u32(); s.mobKillNum = r.u32(); s.mobKillText = r.str();
  s.genVer = r.u32();
  const n = r.u32(); s.gens = [];
  for (let i = 0; i < n; i++) s.gens.push({ ver: r.u32(), nid: r.u32(), num: r.u16(), rate: r.raw(4), mobs: r.vecDw() });
  s.genText = r.str();
  s.npcTalkId = r.u32(); s.npcTalkText = r.str();
  s.reachMap = r.u32(); s.reachX = r.u16(); s.reachY = r.u16(); s.reachR = r.u16(); s.reachText = r.str();
  s.level = r.u16();
  s.guardId = r.u32(); s.guardText = r.str();
  s.defMap = r.u32(); s.defX = r.u16(); s.defY = r.u16(); s.defR = r.u16(); s.defTime = r.raw(4); s.defText = r.str();
  s.giftQ = r.vecItem(); s.resetQ = r.vecDw();
  s.moveMap = r.u32(); s.moveX = r.u16(); s.moveY = r.u16(); s.moveGate = r.u32();
  return s;
}
function writeStep(w, s) {
  w.u32(s.ver); w.str(s.title); w.str(s.comment);
  w.u32(s.mobKillId); w.u32(s.mobKillNum); w.str(s.mobKillText);
  w.u32(s.genVer); w.u32(s.gens.length);
  for (const g of s.gens) { w.u32(g.ver); w.u32(g.nid); w.u16(g.num); w.raw(g.rate); w.vecDw(g.mobs); }
  w.str(s.genText);
  w.u32(s.npcTalkId); w.str(s.npcTalkText);
  w.u32(s.reachMap); w.u16(s.reachX); w.u16(s.reachY); w.u16(s.reachR); w.str(s.reachText);
  w.u16(s.level);
  w.u32(s.guardId); w.str(s.guardText);
  w.u32(s.defMap); w.u16(s.defX); w.u16(s.defY); w.u16(s.defR); w.raw(s.defTime); w.str(s.defText);
  w.vecItem(s.giftQ); w.vecDw(s.resetQ);
  w.u32(s.moveMap); w.u16(s.moveX); w.u16(s.moveY); w.u32(s.moveGate);
}

// body = the decoded bytes after the 132-byte header
function parse(body) {
  const r = new R(body);
  const q = { ver: r.u32() };
  if (q.ver !== 0x0202) throw new Error('quest version ' + q.ver.toString(16));
  q.editVer = r.u32(); q.title = r.str(); q.comment = r.str(); q.flags = r.u32(); q.area = r.u32();
  q.start = r.block(); q.attend = r.block();
  q.beginParty = r.u32(); q.beginMoney = r.u32(); q.limitTime = r.u32();
  q.timeKeep = r.u8(); q.pastOnline = r.u8(); q.nonDie = r.u8(); q.limitParty = r.u32();
  const n = r.u32(); q.steps = []; for (let i = 0; i < n; i++) q.steps.push(readStep(r));
  q.giftMoney = r.u32(); q.giftExp = r.raw(8); q.giftSkillPt = r.u32(); q.giftStatPt = r.u32();
  q.giftLife = r.u32(); q.giftDisPK = r.u32(); q.giftElement = r.u32(); q.giftQuest = r.u32();
  q.giftItems = r.vecItem(); q.giftSkills = r.vecDw();
  q.progress = r.u8();
  q.progressRaw = q.progress ? r.raw(4 * 4 + (4 + 2 + 2 + 4) * 3) : Buffer.alloc(0);
  q.tail = r.raw(body.length - r.p);          // whatever follows (padding)
  return q;
}
function write(q) {
  const w = new W();
  w.u32(q.ver); w.u32(q.editVer); w.str(q.title); w.str(q.comment); w.u32(q.flags); w.u32(q.area);
  w.block(q.start); w.block(q.attend);
  w.u32(q.beginParty); w.u32(q.beginMoney); w.u32(q.limitTime);
  w.u8(q.timeKeep); w.u8(q.pastOnline); w.u8(q.nonDie); w.u32(q.limitParty);
  w.u32(q.steps.length); for (const s of q.steps) writeStep(w, s);
  w.u32(q.giftMoney); w.raw(q.giftExp); w.u32(q.giftSkillPt); w.u32(q.giftStatPt);
  w.u32(q.giftLife); w.u32(q.giftDisPK); w.u32(q.giftElement); w.u32(q.giftQuest);
  w.vecItem(q.giftItems); w.vecDw(q.giftSkills);
  w.u8(q.progress); w.raw(q.progressRaw); w.raw(q.tail);
  return w.buf();
}

// GLQUEST_START v3/v4 body: class u32, school u16, level u16, skill u32, item u32, map u32, size u16, x u16, y u16, [join i32]
function startGet(q) { const b = q.start.body; return { cls: b.readUInt32LE(0), school: b.readUInt16LE(4), level: b.readUInt16LE(6) }; }
function startSetSchool(q, s) { if (q.start.ver < 3) throw new Error('start ver'); q.start.body.writeUInt16LE(s, 4); }

const nid = (v) => (v & 0xffff) + '/' + (v >>> 16);
const S = (b, dec) => dec.decode(b.subarray(0, b.indexOf(0) >= 0 ? b.indexOf(0) : b.length));
const mkStr = (bytes) => Buffer.concat([Buffer.from(bytes), Buffer.from([0])]);

module.exports = { parse, write, startGet, startSetSchool, nid, S, mkStr, ITEM };
