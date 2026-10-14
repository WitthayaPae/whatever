'use strict';
//
// `trainer-orb-fix.js` — make the class trainers' Spirit Orb exchanges match the
// skill table (2026-10-14: "the swordsman level 5 can not exchange to skill book
// Blood Thirst ... there is no option when talking").
//
//   node trainer-orb-fix.js <nd_cond.js> <CLIENT/data dir> <work dir> [--write]
//
// Trainers: npc_{1,2,3}_t_{knight,fighter,archer,spirit}1.ntk (sword, fist, bow,
// magic; SG, MP, PHX). An orb answer is an EM_BASIC / EM_ITEM_TRADE talk that
// takes Spirit Orb No. N (104/N) and gives a skill scroll. Orb N is for the
// class's grade-N skills (skill.csv dwGRADE, dwCLASS).
//
//   - An answer whose scroll teaches a skill of another grade is removed.
//   - A skill of the class that has a scroll (item.csv SKILL type, sSkill_ID) and
//     an orb page for its grade, but no answer, gets one on that page: a copy of
//     an existing scroll trade on the same page (same orb, same condition), with
//     label "<that answer's prefix><skill name>" and the scroll (lowest item id
//     when several are identical copies).
//   - The page's "back" answer keeps the highest talk id, so it stays last.
//
// Talks are written as SNpcTalk 0x0200 (NpcTalk.cpp LOAD_0200): the copy keeps
// every field of the template except the id, the label string and result slot 0.
// The file is decoded (EMBYTECRYPT_NPCTALK from byte 134), spliced, re-encoded
// and parsed again; every page that was not edited must come back identical.
//
// <nd_cond.js> is npcdialogue.js with talk byte spans, talk-list count offsets,
// conditions and result items kept (scratch copy used for this fix).
//
const fs = require('fs');
const path = require('path');
const { RccArchive } = require('./rcc.js');
const g = require('./gamecrypt.js');
const bytecrypt = require('./bytecrypt.js');

const args = process.argv.slice(2);
const write = args.includes('--write');
const [ndPath, D, W] = args.filter((a) => !a.startsWith('--'));
if (!ndPath || !D || !W) { console.error('usage: node trainer-orb-fix.js <nd_cond.js> <CLIENT/data> <work dir> [--write]'); process.exit(2); }
const nd = require(path.resolve(ndPath));
const th = new TextDecoder('windows-874');
const plain = (b) => (g.isEncoded(b) ? g.decode(b) : b);
const a = new RccArchive(path.join(D, 'glogic', 'GLogic.rcc'));
const rd = (n) => plain(a.read(a.list().find((x) => x.toLowerCase() === n.toLowerCase())));
const rawT = (buf) => { const m = new Map(); for (const l of buf.toString('latin1').split(/\r?\n/)) { const t = l.split('/')[0].split('\t').filter((x) => x); if (t.length >= 2 && !m.has(t[0])) m.set(t[0], t[1].trim()); } return m; };
function csvLine(line) { const o = []; let cur = '', q = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; } else if (ch === '"') q = true; else if (ch === ',') { o.push(cur); cur = ''; } else cur += ch; } o.push(cur); return o; }

const SN = rawT(plain(rd('SkillStrTable.txt')));   // raw cp874 bytes as latin1
const skills = new Map();
{
  const L = rd('skill.csv').toString('latin1').split(/\r?\n/); const h = csvLine(L[0]);
  const iN = h.indexOf('szNAME'), iC = h.indexOf('dwCLASS'), iG = h.indexOf('dwGRADE');
  for (const l of L.slice(1)) {
    if (!l) continue; const f = csvLine(l); if (!/^SN_/.test(f[iN] || '')) continue;
    const k = `${+f[0]}/${+f[1]}`; if (skills.has(k)) continue;
    skills.set(k, { k, nameRaw: SN.get(f[iN]) || '', cls: +f[iC], grade: +f[iG] });
  }
}
const bookSkill = new Map(), books = new Map();
{
  const L = rd('item.csv').toString('latin1').split(/\r?\n/); const h = csvLine(L[0]);
  const iT = h.indexOf('emItemType'), iSm = h.indexOf('sSkill_ID wMainID'), iSs = h.indexOf('sSkill_ID wSubID');
  for (const l of L.slice(1)) {
    if (!l) continue; const f = csvLine(l); if (+f[iT] !== 3) continue;
    const id = ((+f[1] << 16) | +f[0]) >>> 0, s = `${+f[iSm]}/${+f[iSs]}`;
    bookSkill.set(id, s); if (!books.has(s)) books.set(s, []); books.get(s).push(id);
  }
  for (const v of books.values()) v.sort((x, y) => (x & 0xffff) - (y & 0xffff) || (x >>> 16) - (y >>> 16));
}
const KIND = { knight: 0x82, fighter: 0x41, archer: 0x104, spirit: 0x208 };
const UINT_MAX = 0xffffffff, ORB = 104;
const orbOf = (t) => { if (!(t.action === 2 && t.actionNo === 5)) return 0; const x = (t.needItems || []).find((n) => n.id !== UINT_MAX && (n.id & 0xffff) === ORB); return x ? x.id >>> 16 : 0; };
const scrollSkill = (t) => { for (const x of (t.resultItems || [])) if (x.id !== UINT_MAX && bookSkill.has(x.id)) return skills.get(bookSkill.get(x.id)); return null; };
const strip = (x) => JSON.stringify(x, (k, v) => (k === '_s' || k === '_e' || k === 'cqAt' ? undefined : (Buffer.isBuffer(v) ? v.toString('hex') : v)));

fs.mkdirSync(path.join(W, 'files'), { recursive: true });
const report = [];
for (const sch of [1, 2, 3]) for (const [kind, MASK] of Object.entries(KIND)) {
  const name = `npc_${sch}_t_${kind}1.ntk`;
  const raw = fs.readFileSync(path.join(D, 'glogic', 'npctalk', name));
  const r = nd.parse(raw);
  if (!r.eofExact) throw new Error(name + ': does not parse to its last byte');

  // the orb page for each N: the one page 1 links to, else the lowest id holding orb-N trades
  const root = r.dialogues.find((d) => d.nid === 1);
  const linked = new Set(); if (root) root.cases.forEach((c) => c.talks.forEach((t) => { if (t.action === 1) linked.add(t.actionNo); }));
  const pages = new Map();   // N -> {dl, ci}
  for (const dl of r.dialogues.slice().sort((x, y) => x.nid - y.nid)) dl.cases.forEach((c, ci) => {
    for (const t of c.talks) { const N = orbOf(t); if (!N) continue; const cur = pages.get(N); if (!cur || (!linked.has(cur.dl.nid) && linked.has(dl.nid))) pages.set(N, { dl, ci }); }
  });

  // removals: scroll of another grade
  const removed = new Set(), offered = new Set();
  r.dialogues.forEach((dl) => dl.cases.forEach((c) => c.talks.forEach((t) => {
    const N = orbOf(t); if (!N) return; const sk = scrollSkill(t); if (!sk) return;
    if (sk.grade !== N) { removed.add(t); report.push([name, 'remove', `page ${dl.nid} orb ${N}`, sk.k, th.decode(Buffer.from(sk.nameRaw, 'latin1')), `grade ${sk.grade}`]); }
    else offered.add(sk.k);
  })));
  // additions
  const adds = new Map();    // page key -> [{skill, scroll}]
  for (const sk of skills.values()) {
    if (!(sk.cls & MASK) || sk.cls === 0 || offered.has(sk.k) || !books.has(sk.k)) continue;
    const pg = pages.get(sk.grade); if (!pg) continue;
    const key = `${pg.dl.nid}:${pg.ci}`; if (!adds.has(key)) adds.set(key, { pg, list: [] });
    adds.get(key).list.push({ sk, scroll: books.get(sk.k)[0] });
  }
  if (!removed.size && !adds.size) { report.push([name, 'unchanged']); continue; }

  // splice, last control first
  const body = Buffer.from(raw); bytecrypt.decode(body, nd.NPCTALK_TABLE, 134, body.length);
  const controls = [];
  r.dialogues.forEach((dl) => dl.cases.forEach((c, ci) => {
    const hasRemoved = c.talks.some((t) => removed.has(t)), add = adds.get(`${dl.nid}:${ci}`);
    if (hasRemoved || add) controls.push({ dl, c, ci, add });
  }));
  controls.sort((x, y) => y.c.talks.countAt - x.c.talks.countAt);
  let out = body;
  const expect = new Map();  // `${nid}:${ci}` -> expected talk list (labels / results) for verification
  for (const ctl of controls) {
    const talks = ctl.c.talks.slice().sort((x, y) => x._s - y._s);
    const keep = talks.filter((t) => !removed.has(t));
    const parts = keep.map((t) => Buffer.from(out.subarray(t._s, t._e)));
    let maxNid = Math.max(...talks.map((t) => t.nid));
    const back = keep.filter((t) => t.action === 1).sort((x, y) => y.nid - x.nid)[0];
    if (ctl.add) {
      const lbl = (t) => { const b = out.subarray(t._s + 10, t._s + 10 + out.readUInt32LE(t._s + 6)); return th.decode(b); };
      const tmpl = keep.find((t) => orbOf(t) && scrollSkill(t) && lbl(t).startsWith('แลกเป็นสกิล ')) || keep.find((t) => orbOf(t) && scrollSkill(t));
      if (!tmpl) throw new Error(`${name} page ${ctl.dl.nid}: no scroll trade to copy`);
      const tb = Buffer.from(out.subarray(tmpl._s, tmpl._e));
      const sLen = tb.readUInt32LE(6), label = tb.subarray(10, 10 + sLen);
      const lab = label.toString('latin1').replace(/\0+$/, '');
      const prefix = lab.slice(0, lab.indexOf(' ') + 1);                 // "แลกเป็นสกิล "
      if (!prefix) throw new Error(`${name}: template label has no prefix`);
      const after = 10 + sLen;                                           // action
      for (const { sk, scroll } of ctl.add.list) {
        const text = Buffer.from(prefix + sk.nameRaw + '\0', 'latin1');
        const head = Buffer.alloc(10); tb.copy(head, 0, 0, 6); head.writeUInt32LE(++maxNid, 2); head.writeUInt32LE(text.length, 6);
        const rest = Buffer.from(tb.subarray(after));
        const resAt = 16 + 40;                                           // action..param2, then 5 need items
        rest.writeUInt32LE(scroll, resAt); rest.writeUInt16LE(1, resAt + 4);
        parts.push(Buffer.concat([head, text, rest]));
        report.push([name, 'add', `page ${ctl.dl.nid} orb ${sk.grade}`, sk.k, th.decode(Buffer.from(sk.nameRaw, 'latin1')), `scroll ${scroll & 0xffff}/${scroll >>> 16}`]);
      }
    }
    if (back && ctl.add) {   // keep the back answer last
      const i = keep.indexOf(back); parts[i].writeUInt32LE(++maxNid, 2);
    }
    const first = Math.min(...talks.map((t) => t._s)), last = Math.max(...talks.map((t) => t._e));
    const cnt = Buffer.alloc(4); cnt.writeInt32LE(parts.length, 0);
    out = Buffer.concat([out.subarray(0, ctl.c.talks.countAt), cnt, out.subarray(ctl.c.talks.countAt + 4, first), ...parts, out.subarray(last)]);
    expect.set(`${ctl.dl.nid}:${ctl.ci}`, keep.length + (ctl.add ? ctl.add.list.length : 0));
  }
  bytecrypt.encode(out, nd.NPCTALK_TABLE, 134, out.length);

  // verify
  const v = nd.parse(out);
  if (!v.eofExact) throw new Error(name + ': result does not parse to its last byte');
  if (v.dialogues.length !== r.dialogues.length) throw new Error(name + ': dialogue count changed');
  r.dialogues.forEach((dl, di) => dl.cases.forEach((c, ci) => {
    const nv = v.dialogues[di].cases[ci];
    const key = `${dl.nid}:${ci}`;
    if (!expect.has(key)) { if (strip(c) !== strip(nv)) throw new Error(`${name} page ${dl.nid}: changed though not edited`); return; }
    if (nv.talks.length !== expect.get(key)) throw new Error(`${name} page ${dl.nid}: talk count ${nv.talks.length} != ${expect.get(key)}`);
    if (strip({ ...c, talks: [] }) !== strip({ ...nv, talks: [] })) throw new Error(`${name} page ${dl.nid}: case text/condition changed`);
    const ids = nv.talks.map((t) => t.nid); if (new Set(ids).size !== ids.length) throw new Error(`${name} page ${dl.nid}: duplicate talk id`);
    const backs = nv.talks.filter((t) => t.action === 1); if (backs.length && Math.max(...ids) !== Math.max(...backs.map((t) => t.nid))) throw new Error(`${name} page ${dl.nid}: back is not last`);
  }));
  const after = new Map(); v.dialogues.forEach((dl) => dl.cases.forEach((c) => c.talks.forEach((t) => { const N = orbOf(t), sk = N && scrollSkill(t); if (sk) { if (sk.grade !== N) throw new Error(`${name}: still a grade ${sk.grade} skill on orb ${N}`); after.set(sk.k, N); } })));
  for (const sk of skills.values()) if ((sk.cls & MASK) && sk.cls && books.has(sk.k) && pages.has(sk.grade) && !after.has(sk.k)) throw new Error(`${name}: ${sk.k} still has no answer`);
  fs.writeFileSync(path.join(W, 'files', name), out);
  report.push([name, 'written', `${raw.length} -> ${out.length} bytes`]);
}
for (const r of report) console.log(r.join(' | '));
if (write) {
  const files = fs.readdirSync(path.join(W, 'files')).map((f) => [f, path.join(W, 'files', f)]);
  const src = path.join(D, 'glogic', 'npctalk', 'NpcTalk.rcc'), dst = path.join(W, 'NpcTalk.rcc');
  const log = console.log; console.log = () => {};
  try { require('./rcc-pack.js').pack(src, dst, files); } finally { console.log = log; }
  console.log('packed', dst, files.length, 'files');
}
