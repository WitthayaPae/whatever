# Checks the translated parts against the source units and writes tm.json
# (thai -> english) for the entries that pass; failures go to bad.tsv.
#   python validate.py <tr dir> [units.json] [in dir] [out dir] [tm name]
import sys, re, io, json, glob, os
T = sys.argv[1]
UNITS = sys.argv[2] if len(sys.argv) > 2 else T + '/units.json'
OUTD = sys.argv[4] if len(sys.argv) > 4 else T + '/out'
TMN = sys.argv[5] if len(sys.argv) > 5 else 'tm.json'
BS = chr(92)
units = json.load(io.open(UNITS, encoding='utf-8'))
def esc(s):
    return (s.replace(BS, BS + BS).replace(chr(13), '')
             .replace(chr(10), BS + 'n').replace(chr(9), BS + 't'))
def unesc(s):
    out = []; i = 0
    while i < len(s):
        c = s[i]
        if c == BS and i + 1 < len(s):
            n = s[i + 1]
            if n == 'n': out.append(chr(10)); i += 2; continue
            if n == 't': out.append(chr(9)); i += 2; continue
            if n == BS: out.append(BS); i += 2; continue
        out.append(c); i += 1
    return ''.join(out)
SPEC = re.compile(r'%(?:\d+%|[-+#0]*\d*(?:\.\d+)?(?:I64|ll|l|h)?[dsufcxXi%])|\{\d+\}')
ENT = re.compile(r'&(?:lt|gt|amp|quot|apos|#x?[0-9A-Fa-f]+);')
got = {}
dup = 0; malformed = 0
for f in sorted(glob.glob(OUTD + '/chunk_*_p*.tsv')):
    for ln in io.open(f, encoding='utf-8', errors='replace').read().split(chr(10)):
        ln = ln.rstrip(chr(13))
        if not ln.strip(): continue
        m = re.match(r'^(\d{5})\t(.*)$', ln)
        if not m:
            m = re.match(r'^(\d{5}) +(.*)$', ln)
            if not m: malformed += 1; continue
        i = int(m.group(1))
        if i in got: dup += 1
        got[i] = m.group(2)
bad = []; tm = {}
for i, th in enumerate(units):
    if i not in got: bad.append((i, 'missing', '')); continue
    en_e = got[i]; th_e = esc(th)
    why = None
    if any(ord(c) > 126 for c in en_e): why = 'nonascii'
    elif sorted(SPEC.findall(th_e)) != sorted(SPEC.findall(en_e)): why = 'spec'
    elif 'talk' not in TMN and th_e.count(BS + 'n') != en_e.count(BS + 'n'): why = 'newline'
    elif th_e.count(BS + 't') != en_e.count(BS + 't'): why = 'tab'
    elif sorted(ENT.findall(th_e)) != sorted(ENT.findall(en_e)): why = 'entity'
    elif len(re.findall(r'[<>]', th_e)) != len(re.findall(r'[<>]', en_e)): why = 'angle'
    elif len(re.sub(ENT, '', th_e).split('&')) != len(re.sub(ENT, '', en_e).split('&')): why = 'amp'
    elif not en_e.strip() and th.strip(): why = 'empty'
    if why: bad.append((i, why, en_e)); continue
    en = unesc(en_e)
    # keep the source's outer whitespace
    lead = th[:len(th) - len(th.lstrip(' '))]; trail = th[len(th.rstrip(' ')):]
    tm[th] = lead + en.strip(' ') + trail
json.dump(tm, io.open(T + '/' + TMN, 'w', encoding='utf-8'), ensure_ascii=False)
with io.open(T + '/bad_' + TMN.replace('.json', '.tsv'), 'w', encoding='utf-8', newline=chr(10)) as f:
    for i, why, en in bad:
        f.write('%05d\t%s\t%s\t%s\n' % (i, why, esc(units[i]), en))
import collections
print('units', len(units), 'translated ok', len(tm), 'bad', len(bad), dict(collections.Counter(b[1] for b in bad)),
      'dup', dup, 'malformed', malformed, 'extra ids', len([k for k in got if k >= len(units)]))
