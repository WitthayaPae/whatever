'use strict';
//  Read or change keys in an encrypted Config.ini ([GAME_FEATURE] etc.).
//
//    node config-keys.js <Config.ini> --show
//    node config-keys.js <in Config.ini> <out Config.ini> KEY=VALUE [KEY=VALUE ...]
//
//  The file is the game's AES layer (gamecrypt.js): 4-byte version, then
//  AES-256-ECB, plaintext padded with spaces to a whole block. A key that
//  exists anywhere is replaced in place; a new one is appended at the end
//  (which is inside the last section, [GAME_FEATURE] in the shipped file).
//  The result is decoded again and compared before it is written.
const fs = require('fs');
const crypto = require('crypto');
const G = require('./gamecrypt.js');

function encode(plain) {
  const pad = (16 - (plain.length % 16)) % 16;
  const body = Buffer.concat([plain, Buffer.alloc(pad, 0x20)]);
  const c = crypto.createCipheriv('aes-256-ecb', G.V8_KEY, null);
  c.setAutoPadding(false);
  const head = Buffer.alloc(4); head.writeInt32LE(G.VERSION, 0);
  return Buffer.concat([head, c.update(body), c.final()]);
}

const [inFile, second, ...rest] = process.argv.slice(2);
if (!inFile || !second) { console.error('usage: see the top of this file'); process.exit(1); }
const raw = fs.readFileSync(inFile);
if (!G.isEncoded(raw)) { console.error(inFile + ' is not an encoded Config.ini'); process.exit(1); }
let text = G.decode(raw).toString('latin1').replace(/ +$/, '');

if (second === '--show') { process.stdout.write(text + '\n'); process.exit(0); }

for (const kv of rest) {
  const m = /^([A-Za-z0-9_]+)=(.*)$/.exec(kv);
  if (!m) { console.error('bad KEY=VALUE: ' + kv); process.exit(1); }
  const re = new RegExp('^([ \\t]*' + m[1] + '[ \\t]*=).*$', 'm');
  if (re.test(text)) { text = text.replace(re, m[1] + ' = ' + m[2]); console.log('set     ' + m[1] + ' = ' + m[2]); }
  else {
    if (!/\r?\n$/.test(text)) text += '\r\n';
    text += m[1] + ' = ' + m[2] + '\r\n';
    console.log('added   ' + m[1] + ' = ' + m[2]);
  }
}

const out = encode(Buffer.from(text, 'latin1'));
const back = G.decode(out).toString('latin1').replace(/ +$/, '');
if (back !== text) { console.error('round trip FAILED - nothing written'); process.exit(1); }
fs.writeFileSync(second, out);
console.log(second + '  ' + out.length + ' bytes, verified');
