// NPC name, exchange file and talk file for 49/24.
//   node mk_npcfiles.js <tools dir> <glogic dir> <out dir>
const [, , T, G, O] = process.argv;
const fs = require('fs');
const path = require('path');
const { addLines, enc874, encodeV8 } = require('./strtab.js');
const g = require(T + '/gamecrypt.js');
const bc = require(T + '/bytecrypt.js');
const nd = require(T + '/npcdialogue.js');

// 1. name
console.log('crow th', addLines(T, path.join(G, 'CrowStrTable.txt'), path.join(O, 'CrowStrTable.txt'), 'CN_049_023', [['CN_049_024', 'แลก ไอเท็มกิจกรรม']]));
console.log('crow en', addLines(T, path.join(G, 'CrowStrTable_en.txt'), path.join(O, 'CrowStrTable_en.txt'), 'CN_049_023', [['CN_049_024', 'Event Item Exchange']]));

// 2. exchange file: same layout as spender.npcex (v8 text, read by SNPC_ITEM_EXCHANGE::LoadData)
const ex = [
  ';npc item exchange',
  ';event item exchange (2026-10-20)',
  ';',
  '[NPC_EXCHANGE_BASIC]',
  'NPC_EXCHANGE_TITLE\t= แลก ไอเท็มกิจกรรม',
  ';',
  ';id',
  ';result mid, result sid, result num',
  ';result att, result def, result res fire, result res ice, result res elect, result res poison, result res spirit, result gen RV,',
  ';require item mid, required item sid, required item num',
  ';',
  '[NPC_EXCHANGE_LIST]',
  'NPC_EXCHANGE_ITEM=[1][512,55,1][0,0,0,0,0,0,0,0][512,57,300][65535,65535,1][65535,65535,1][65535,65535,1][65535,65535,1]',
  'NPC_EXCHANGE_ITEM=[2][512,56,1][0,0,0,0,0,0,0,0][512,58,150][65535,65535,1][65535,65535,1][65535,65535,1][65535,65535,1]',
  '',
].join('\r\n');
const exBuf = encodeV8(g, enc874(ex));
if (new TextDecoder('windows-874').decode(g.decode(exBuf)).replace(/ +$/, '') !== ex) throw new Error('npcex round trip');
fs.writeFileSync(path.join(O, 'eventexchange.npcex'), exBuf);
// the shipped one, for comparison of the plain layout
const sp = new TextDecoder('windows-874').decode(g.decode(fs.readFileSync(path.join(G, 'spender.npcex'))));
console.log('spender.npcex first item line:', JSON.stringify(sp.split('\r\n').find((l) => l.startsWith('NPC_EXCHANGE_ITEM'))));

// 3. talk file: npc_spender.ntk with the greeting replaced (body EMBYTECRYPT_NPCTALK from 134)
const src = fs.readFileSync(path.join(G, 'npctalk', 'npc_spender.ntk'));
const p0 = nd.parse(src);
const old = Buffer.from(p0.dialogues[0].cases[0].basicTalk.raw);          // includes the NUL
const dec = bc.decode(Buffer.from(src), nd.NPCTALK_TABLE, nd.BODY_OFFSET, src.length);
const lpOld = Buffer.concat([Buffer.alloc(4), old]); lpOld.writeUInt32LE(old.length, 0);
const at = dec.indexOf(lpOld);
if (at < 0 || dec.indexOf(lpOld, at + 1) >= 0) throw new Error('greeting not found once');
const greet = Buffer.concat([enc874('สวัสดียินดีที่ได้พบกัน นำไอเท็มกิจกรรมมาแลกที่ฉันได้'), Buffer.alloc(1)]);
const lpNew = Buffer.concat([Buffer.alloc(4), greet]); lpNew.writeUInt32LE(greet.length, 0);
const outDec = Buffer.concat([dec.slice(0, at), lpNew, dec.slice(at + lpOld.length)]);
const ntk = bc.encode(Buffer.from(outDec), nd.NPCTALK_TABLE, nd.BODY_OFFSET, outDec.length);
const p1 = nd.parse(ntk);
if (!p1.eofExact) throw new Error('ntk does not parse to the end');
const th = new TextDecoder('windows-874');
console.log('greeting:', th.decode(Buffer.from(p1.dialogues[0].cases[0].basicTalk.text)));
const t0 = p0.dialogues[0].cases[0].talks, t1 = p1.dialogues[0].cases[0].talks;
console.log('answers:', t1.map((t) => th.decode(Buffer.from(t.talk)) + ' action ' + t.action + '/' + t.actionNo).join(' | '),
  '| same as template:', JSON.stringify(t0) === JSON.stringify(t1), '| flags:', JSON.stringify(p1.flags) === JSON.stringify(p0.flags));
fs.writeFileSync(path.join(O, 'npc_eventexchange.ntk'), ntk);
console.log('ntk', ntk.length, 'bytes');
