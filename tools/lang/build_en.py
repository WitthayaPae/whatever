# Builds the English overlay files from the translation memory.
#   python build_en.py <scratch> <repo root> <out dir>
# XML overlays: every WORD / SENTENSE / NUMBER element that has a Thai VALUE,
# copied whole with its Thai values replaced. Name tables: key TAB english for
# every Thai entry.
import sys, re, io, json, os
S, ROOT, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
BS = chr(92); LF = chr(10); CR = chr(13); TAB = chr(9)
tm = json.load(io.open(S + '/tr/tm.json', encoding='utf-8'))
def thai(s): return any('฀' <= c <= '๿' for c in s)
os.makedirs(OUT, exist_ok=True)

# ids kept exactly as hand-written and tested on the lobby pages
OVERRIDE = {}
for fn in ('gameword', 'gameintext', 'gameextext'):
    p = ROOT + '/CLIENT/data/gui/%s_en.xml' % fn
    hand = S + '/tr/hand_%s_en.xml' % fn
    if not os.path.exists(hand) and os.path.exists(p):
        io.open(hand, 'w', encoding='utf-8', newline='').write(io.open(p, encoding='utf-8', newline='').read())
    if os.path.exists(hand):
        s = io.open(hand, encoding='utf-8').read()
        for m in re.finditer(r'<(WORD|SENTENSE|NUMBER)\b[^>]*\bId="([^"]+)"[^>]*>.*?</\1>', s, re.S):
            OVERRIDE[(fn, m.group(2))] = m.group(0)

stats = {}
for fn in ('gameword', 'gameintext', 'gameextext', 'servertext'):
    s = io.open(ROOT + '/CLIENT/data/gui/%s.xml' % fn, encoding='utf-8').read()
    out = ['<?xml version="1.0" encoding="utf-8"?>', '<TEXT>',
           '<!-- English overlay for %s.xml, generated from the translation memory.' % fn,
           '     Loaded over the Thai base when the language option is English;',
           '     ids missing here keep their Thai text. Do not edit by hand:',
           '     change the translation memory and rebuild. -->']
    n = miss = 0; seen = set()
    for m in re.finditer(r'<(WORD|SENTENSE|NUMBER)\b[^>]*\bId="([^"]+)"[^>]*>.*?</\1>', s, re.S):
        el, eid = m.group(0), m.group(2)
        if eid in seen: continue          # a duplicated id: the first one is what the base keeps? no - last wins; see below
        if (fn, eid) in OVERRIDE:
            out.append(OVERRIDE[(fn, eid)]); seen.add(eid); n += 1; continue
        if not thai(el): continue
        def rep(v):
            global miss
            inner = v.group(2)
            if not thai(inner): return v.group(0)
            if inner not in tm: miss += 1; return v.group(0)
            return v.group(1) + tm[inner] + v.group(3)
        new = re.sub(r'(<VALUE\b[^>]*>)(.*?)(</VALUE>)', rep, el, flags=re.S)
        out.append(new.replace(CR, '')); seen.add(eid); n += 1
    for (f2, eid), el in OVERRIDE.items():
        if f2 == fn and eid not in seen: out.append(el); n += 1
    out.append('</TEXT>')
    io.open(OUT + '/%s_en.xml' % fn, 'w', encoding='utf-8', newline='').write((CR + LF).join(x.replace(LF, CR + LF) for x in out) + CR + LF)
    stats[fn] = (n, miss)

def declines(b):
    try:
        u = b.decode('utf-8')
        if all(ord(c) < 0x80 or 0x0e00 <= ord(c) <= 0x0e7f or c in '‘’“”…–—•€' for c in u):
            return u
    except UnicodeDecodeError:
        pass
    return b.decode('cp874', errors='replace')
for n, name in (('item', 'ItemStrTable_en.txt'), ('skill', 'SkillStrTable_en.txt'), ('crow', 'CrowStrTable_en.txt')):
    raw = open(S + '/src/cur_%s.txt' % n, 'rb').read()
    lines = []; miss = 0
    for bl in raw.split(bytes([10])):
        l = declines(bl).rstrip(CR)
        if TAB not in l: continue
        k, v = l.split(TAB, 1)
        if not thai(v): continue
        if v not in tm: miss += 1; continue
        e = tm[v].replace(TAB, ' ').replace(LF, ' ').strip()
        # '/' starts a comment in this table format (SpanExcluding("/")).
        e = e.replace('/', '-') if '/' in e and '/' not in v else e
        lines.append(k + TAB + e)
    open(OUT + '/' + name, 'wb').write((CR + LF).join(lines).encode('ascii') + (CR + LF).encode('ascii'))
    stats[n] = (len(lines), miss)
print(stats)
