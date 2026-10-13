// Pulls every NPC talk line and quest string out of the loose client files,
// keyed the way the client's XML translation lookups key them.
//   node extract_talk.js <rcc-extract dir> <CLIENT/data/glogic> <out.json>
const fs = require('fs'), path = require('path');
const R = process.argv[2], G = process.argv[3], OUT = process.argv[4];
const { decrypt } = require(R + '/rcc.js');
const bytecrypt = require(R + '/bytecrypt.js');
const npc = require(R + '/npcdialogue.js');
const qd = require(R + '/questdata.js');

const lat = (x) => (x == null ? '' : Buffer.isBuffer(x) ? x.toString('latin1')
  : (typeof x === 'object' && x.text) ? (Buffer.isBuffer(x.text) ? x.text.toString('latin1') : String(x.text))
  : String(x));
function tryParse(fn, raw) {
  for (const pre of [(b) => b]) {
    try { const r = fn(pre(Buffer.from(raw))); if (r) return r; } catch (e) { /* next */ }
  }
  return null;
}

const out = { npc: {}, quest: {}, stats: {} };
let ok = 0, bad = [];
for (const f of fs.readdirSync(path.join(G, 'npctalk')).filter((x) => /\.ntk$/i.test(x))) {
  const raw = fs.readFileSync(path.join(G, 'npctalk', f));
  const p = tryParse((b) => { const r = npc.parse(b); return r && r.dialogues ? r : null; }, raw);
  if (!p) { bad.push(f); continue; }
  ok++;
  const key = f.toLowerCase();
  for (const d of p.dialogues) {
    (d.cases || []).forEach((c, ci) => {
      const bt = lat(c.basicTalk);
      if (bt) out.npc[`${key}_${d.nid}_${ci}`] = bt;
      for (const t of c.talks || []) {
        const tt = lat(t.talk);
        if (tt) out.npc[`${key}_${d.nid}_${ci}_${t.nid}`] = tt;
      }
    });
  }
}
out.stats.ntk = { ok, bad: bad.length, badFiles: bad.slice(0, 10) };

ok = 0; bad = []; let notExact = 0;
// quest.lst gives id -> file; the id is what the QN_/QD_ keys are built from.
const files = fs.readdirSync(path.join(G, 'quest'));
for (const f of files.filter((x) => /\.qst$/i.test(x))) {
  const raw = fs.readFileSync(path.join(G, 'quest', f));
  let res = null;
  for (const pre of [(b) => b]) {
    try { const r = qd.decodeQst(pre(Buffer.from(raw)), bytecrypt); if (r && r.quest && !r.error) { res = r; if (r.eofExact) break; } } catch (e) { /* next */ }
  }
  if (!res) { bad.push(f); continue; }
  ok++; if (!res.eofExact) notExact++;
  const q = res.quest, e = { title: lat(q.title), comment: lat(q.comment), steps: [] };
  for (const s of q.steps) {
    const st = {};
    for (const k of ['title', 'comment', 'npcTalkText', 'mobKillText', 'genText', 'reachText', 'guardText', 'defText']) {
      const v = lat(s[k]); if (v) st[k] = v;
    }
    e.steps.push(st);
  }
  out.quest[f.toLowerCase()] = e;
}
out.stats.qst = { ok, bad: bad.length, notExact, badFiles: bad.slice(0, 10) };
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(JSON.stringify(out.stats), 'npc keys', Object.keys(out.npc).length, 'quests', Object.keys(out.quest).length);
