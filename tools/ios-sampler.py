#!/usr/bin/env python3
"""Decode samples.bin from the in-app iPhone sampler (platform/ios/ran_ios_sampler.mm).

    tools/ios-device.sh flag sampler 10          # start: 10 s of samples
    tools/ios-device.sh flag samplergl 10        # the GL thread instead
    (wait for the log line "wrote N samples")
    python tools/ios-sampler.py [samples.bin] [app binary] [--top 40]

Pulls Documents/ran/samples.bin itself when no file is given. The binary must
be the build that ran (default: the .ipa published in native/out/launcher_mobile/ios).
Prints self time (the function the pc was in) and inclusive time (on the stack
anywhere), as a share of the game thread's samples.
"""
import collections, os, struct, subprocess, sys, zipfile, plistlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'native', 'out')
NDK = r'C:\Program Files\Unity\Hub\Editor\6000.5.8f1\Editor\Data\PlaybackEngines\AndroidPlayer\NDK\toolchains\llvm\prebuilt\windows-x86_64\bin'
SYMBOLIZER = os.path.join(NDK, 'llvm-symbolizer.exe')
PY = r'C:\Users\tapnu\AppData\Local\Programs\Python\Python312\python.exe'

under = None
if '--under' in sys.argv:
    under = sys.argv[sys.argv.index('--under') + 1]
args = [a for a in sys.argv[1:] if not a.startswith('--') and a != under]
top = 40
if '--top' in sys.argv:
    top = int(sys.argv[sys.argv.index('--top') + 1])
    if str(top) in args:
        args.remove(str(top))

samples_path = args[0] if args else os.path.join(OUT, 'ios-device', 'samples.bin')
if not args:
    bundle = None
    apps = subprocess.run([PY, '-m', 'pymobiledevice3', 'apps', 'list'], capture_output=True, text=True, encoding='utf-8').stdout
    for k in __import__('json').loads(apps):
        if k.startswith('com.ran.launcher'):
            bundle = k
    os.makedirs(os.path.dirname(samples_path), exist_ok=True)
    subprocess.run([PY, '-m', 'pymobiledevice3', 'apps', 'pull', bundle, 'Documents/ran/samples.bin', samples_path], check=True)

binary = args[1] if len(args) > 1 else None
if not binary:
    ipa = os.path.join(OUT, 'launcher_mobile', 'ios', 'RanLegacyM.ipa')
    z = zipfile.ZipFile(ipa)
    info = [n for n in z.namelist() if n.endswith('.app/Info.plist')][0]
    p = plistlib.loads(z.read(info))
    binary = os.path.join(OUT, 'ios-device', 'ran.macho')
    open(binary, 'wb').write(z.read(info.rsplit('/', 1)[0] + '/' + p['CFBundleExecutable']))
    print('binary: build %s from %s' % (p['CFBundleVersion'], ipa))

data = open(samples_path, 'rb').read()
magic, ver, slide, n, words = struct.unpack_from('<IIQQQ', data, 0)
assert magic == 0x52534D50, 'not a samples.bin'
vals = struct.unpack_from('<%dQ' % words, data, 32)
#  Version 2 appends names for addresses outside the app binary (dladdr on the
#  phone): Apple's GL driver, Metal, libc.
sysnames = {}
if ver >= 2:
    at = 32 + 8 * words
    (cnt,) = struct.unpack_from('<Q', data, at); at += 8
    for _ in range(cnt):
        a, ln = struct.unpack_from('<QH', data, at); at += 10
        sysnames[a] = data[at:at + ln].decode('utf-8', 'replace'); at += ln
stacks = []
i = 0
while i < len(vals):
    d = vals[i]
    stacks.append(vals[i + 1:i + 1 + d])
    i += 1 + d
print('%d samples, slide 0x%x' % (len(stacks), slide))

#  Return addresses point after the call; step back one instruction so the
#  symbol is the calling line's function. The pc itself is exact.
def unslid(a, is_pc):
    return a - slide - (0 if is_pc else 4)

addrs = set()
for st in stacks:
    for k, a in enumerate(st):
        if a not in sysnames: addrs.add(unslid(a, k == 0))
addrs = sorted(addrs)
#  The shipped binary has a symbol table but no DWARF, which llvm-symbolizer
#  answers with "??" - so look each address up in llvm-nm's sorted list instead.
import bisect
NM = os.path.join(NDK, 'llvm-nm.exe')
out = subprocess.run([NM, '-n', '--defined-only', '-C', binary], capture_output=True, text=True,
                     encoding='utf-8', errors='replace').stdout
starts, labels = [], []
for line in out.splitlines():
    parts = line.split(' ', 2)
    if len(parts) == 3 and parts[1] in ('t', 'T'):
        try: starts.append(int(parts[0], 16)); labels.append(parts[2])
        except ValueError: pass
names = {}
for a in addrs:
    i = bisect.bisect_right(starts, a) - 1
    if i >= 0 and a - starts[i] < 0x100000:
        nm = labels[i]
        nm = nm.split('(')[0] if not nm.startswith('(') else nm
        names[a] = nm
    else:
        names[a] = '[system] 0x%x' % a

def name_of(a, k):
    if a in sysnames: return '[' + sysnames[a] + ']'
    return names[unslid(a, k == 0)]

self_c = collections.Counter()
incl = collections.Counter()
for st in stacks:
    if not st:
        continue
    fs = [name_of(a, k) for k, a in enumerate(st)]
    self_c[fs[0]] += 1
    for f in set(fs):
        incl[f] += 1

N = float(len(stacks))
#  For the GL thread: which of our calls the time was spent under (the first
#  frame in the app binary, counting from the leaf), and which system library.
ours = collections.Counter(); libs = collections.Counter()
for st in stacks:
    if not st: continue
    fs = [name_of(a, k) for k, a in enumerate(st)]
    first = next((f for f in fs if not f.startswith('[')), '-')
    ours[first] += 1
    libs[fs[0].split('!')[0] + ']' if fs[0].startswith('[') else '(app)'] += 1
print('--- by library of the leaf')
for f, c in libs.most_common(15): print('%6.1f%%  %s' % (100 * c / N, f[:140]))
print('--- by the innermost app function (for the GL thread: which call)')
for f, c in ours.most_common(top): print('%6.1f%%  %s' % (100 * c / N, f[:160]))
print('--- self (where the game thread was)')
for f, c in self_c.most_common(top):
    print('%6.1f%%  %s' % (100 * c / N, f[:140]))
print('--- inclusive (anywhere on the stack)')
for f, c in incl.most_common(top):
    print('%6.1f%%  %s' % (100 * c / N, f[:140]))

#  --under NAME: where the time inside NAME goes (its direct children, and the
#  leaves), and who calls it.
if under:
    kids = collections.Counter(); leaves = collections.Counter(); parents = collections.Counter(); tot = 0
    for st in stacks:
        if not st: continue
        fs = [name_of(a, k) for k, a in enumerate(st)]
        idx = [i for i, f in enumerate(fs) if f.startswith(under)]
        if not idx: continue
        tot += 1; i = idx[-1]
        kids[fs[i - 1] if i > 0 else '(self)'] += 1
        leaves[fs[0]] += 1
        parents[fs[i + 1] if i + 1 < len(fs) else '-'] += 1
    print('=== %s: %.1f%% of samples' % (under, 100 * tot / N))
    for t, c in (('callers', parents), ('children', kids), ('leaves', leaves)):
        print('--- ' + t)
        for f, v in c.most_common(18): print('%6.1f%%  %s' % (100 * v / N, f[:120]))
