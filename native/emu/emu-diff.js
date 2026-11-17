// RAN EMU: which CLIENT files differ from the last built patch (out/launcher_mobile/manifest.json),
// i.e. the unreleased data the emulator app needs on top of the game data already on the device.
//   node emu-diff.js            -> prints one manifest path per line (paths relative to CLIENT)
// Read-only. Files the manifest does not ship (server-only data, emutest) are added by emu-push.sh.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const NATIVE = path.join(__dirname, '..');
const CLIENT = path.join(NATIVE, '..', '..', 'CLIENT');
const man = JSON.parse(fs.readFileSync(path.join(NATIVE, 'out', 'launcher_mobile', 'manifest.json'), 'utf8'));
const t0 = fs.statSync(path.join(NATIVE, 'out', 'launcher_mobile', 'manifest.json')).mtimeMs;
const out = [];
for (const f of man.files) {
  const p = path.join(CLIENT, f.path);
  let st; try { st = fs.statSync(p); } catch (e) { continue; }          // gone locally: nothing to push
  if (st.size !== f.size) { out.push(f.path); continue; }
  if (st.mtimeMs < t0 - 3600e3) continue;                              // older than the manifest: same file
  if (crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') !== f.sha256) out.push(f.path);
}
console.error(`manifest ${man.version}: ${out.length} file(s) differ in CLIENT`);
console.log(out.join('\n'));
