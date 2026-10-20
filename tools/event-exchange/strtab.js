// Insert lines into a v8 string table (ItemStrTable / CrowStrTable), after a given key.
//   const { addLines } = require('./strtab.js'); addLines(T, inFile, outFile, afterKey, [[key, text], ...])
// Text is UTF-16 JS; written as cp874 (windows-874). A key that already exists is refused.
const fs = require('fs');
const crypto = require('crypto');

function cp874Encoder() {
  const dec = new TextDecoder('windows-874');
  const map = new Map();
  for (let b = 0; b < 256; b++) { const ch = dec.decode(Buffer.from([b])); if (ch !== '�' && !map.has(ch)) map.set(ch, b); }
  return (s) => Buffer.from([...s].map((ch) => { if (!map.has(ch)) throw new Error('not in cp874: ' + JSON.stringify(ch)); return map.get(ch); }));
}
const enc874 = cp874Encoder();

function encodeV8(g, plain) {
  let b = plain;
  if (b.length % 16) b = Buffer.concat([b, Buffer.alloc(16 - b.length % 16, 0x20)]);
  const e = crypto.createCipheriv('aes-256-ecb', g.V8_KEY, null);
  e.setAutoPadding(false);
  const head = Buffer.alloc(4); head.writeInt32LE(g.VERSION, 0);
  return Buffer.concat([head, e.update(b), e.final()]);
}

function addLines(T, inFile, outFile, afterKey, pairs) {
  const g = require(T + '/gamecrypt.js');
  const raw = fs.readFileSync(inFile);
  let txt = g.decode(raw).toString('latin1');
  txt = txt.replace(/[\0 ]+$/, '');                 // padding the editor / encoder left
  if (!txt.endsWith('\r\n')) txt += '\r\n';
  const lines = txt.split('\r\n'); lines.pop();
  const keyOf = (l) => l.split('\t')[0];
  const have = new Set(lines.map(keyOf));
  for (const [k] of pairs) if (have.has(k)) throw new Error(inFile + ': key exists ' + k);
  let at = lines.findIndex((l) => keyOf(l) === afterKey);
  if (at < 0) throw new Error(inFile + ': anchor key not found ' + afterKey);
  const add = pairs.map(([k, v]) => k + '\t' + enc874(v).toString('latin1'));
  lines.splice(at + 1, 0, ...add);
  const plain = Buffer.from(lines.join('\r\n') + '\r\n', 'latin1');
  const out = encodeV8(g, plain);
  // read back
  const back = g.decode(out).toString('latin1');
  for (const [k, v] of pairs) {
    const l = back.split('\r\n').find((x) => keyOf(x) === k);
    if (!l || new TextDecoder('windows-874').decode(Buffer.from(l.split('\t')[1] || '', 'latin1')) !== v) throw new Error('read back failed for ' + k);
  }
  const before = g.decode(raw).toString('latin1').replace(/[\0 ]+$/, '');
  const afterNoNew = back.replace(/[\0 ]+$/, '').split('\r\n').filter((l) => !pairs.some(([k]) => keyOf(l) === k)).join('\r\n');
  if (afterNoNew.replace(/\r\n$/, '') !== before.replace(/\r\n$/, '')) throw new Error('other lines changed in ' + inFile);
  fs.writeFileSync(outFile, out);
  return { lines: lines.length, bytes: out.length };
}
module.exports = { addLines, enc874, encodeV8 };
