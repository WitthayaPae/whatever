#!/usr/bin/env python3
"""Decode samples.bin from the in-app iPhone sampler (platform/ios/ran_ios_sampler.mm).

    tools/ios-device.sh flag sampler 10          # start: 10 s of samples
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

args = [a for a in sys.argv[1:] if not a.startswith('--')]
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
        addrs.add(unslid(a, k == 0))
addrs = sorted(addrs)
inp = '\n'.join('0x%x' % a for a in addrs) + '\n'
r = subprocess.run([SYMBOLIZER, '--obj=' + binary, '--functions=short', '--demangle', '--no-inlines', '--output-style=GNU'],
                   input=inp, capture_output=True, text=True)
lines = r.stdout.split('\n')
names = {}
for k, a in enumerate(addrs):
    nm = lines[2 * k] if 2 * k < len(lines) else '??'
    names[a] = nm if nm and nm != '??' else '0x%x' % a

self_c = collections.Counter()
incl = collections.Counter()
for st in stacks:
    if not st:
        continue
    fs = [names[unslid(a, k == 0)] for k, a in enumerate(st)]
    self_c[fs[0]] += 1
    for f in set(fs):
        incl[f] += 1

N = float(len(stacks))
print('--- self (where the game thread was)')
for f, c in self_c.most_common(top):
    print('%6.1f%%  %s' % (100 * c / N, f[:140]))
print('--- inclusive (anywhere on the stack)')
for f, c in incl.most_common(top):
    print('%6.1f%%  %s' % (100 * c / N, f[:140]))
