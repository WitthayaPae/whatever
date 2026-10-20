// Names and descriptions for 512/57, 512/58 (and English names for the user's 512/55, 512/56).
//   node mk_strings.js <tools dir> <glogic dir> <out dir>
const [, , T, G, O] = process.argv;
const { addLines } = require('./strtab.js');
const path = require('path');

const TH = [
  ['IN_512_057', 'ขนนกฟีนิกซ์ [ไอเท็มกิจกรรม]'],
  ['ID_512_057', 'ไอเท็มกิจกรรม เก็บให้ครบ 300 ชิ้น แล้วนำไปแลก สร้อยนกฟีนิคซ์ [7 วัน] ได้ที่ NPC แลก ไอเท็มกิจกรรม'],
  ['IN_512_058', 'เศษแหวนลึกลับ [ไอเท็มกิจกรรม]'],
  ['ID_512_058', 'ไอเท็มกิจกรรม เก็บให้ครบ 150 ชิ้น แล้วนำไปแลก แหวนลึกลับ[ทับ][7 วัน] ได้ที่ NPC แลก ไอเท็มกิจกรรม'],
];
const EN = [
  ['IN_512_055', 'Phoenix Necklace [7 Days]'],
  ['IN_512_056', 'Mystic Ring [7 Days]'],
  ['IN_512_057', 'Phoenix Feather [Event Item]'],
  ['ID_512_057', 'Event item. Collect 300 and trade them for Phoenix Necklace [7 Days] at the Event Item Exchange NPC.'],
  ['IN_512_058', 'Mystic Ring Shard [Event Item]'],
  ['ID_512_058', 'Event item. Collect 150 and trade them for Mystic Ring [7 Days] at the Event Item Exchange NPC.'],
];
console.log('th', addLines(T, path.join(G, 'ItemStrTable.txt'), path.join(O, 'ItemStrTable.txt'), 'IN_512_056', TH));
console.log('en', addLines(T, path.join(G, 'ItemStrTable_en.txt'), path.join(O, 'ItemStrTable_en.txt'), 'IN_512_054', EN));
