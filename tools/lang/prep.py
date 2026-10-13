# Builds the translation memory input: every unique Thai string from the UI
# text files and the name tables, in source order, split into chunk files.
import sys, re, io, json
S = sys.argv[1]; ROOT = sys.argv[2]
BS = chr(92)
def thai(s): return any('฀' <= c <= '๿' for c in s)
def esc(s):
    return (s.replace(BS, BS + BS).replace(chr(13), '')
             .replace(chr(10), BS + 'n').replace(chr(9), BS + 't'))
def declines(b):
    # The tables are CP874 with a few UTF-8 lines mixed in; decide per line.
    try:
        u = b.decode('utf-8')
        if all(ord(c) < 0x80 or 0x0e00 <= ord(c) <= 0x0e7f or c in '‘’“”…–—•€' for c in u):
            return u
    except UnicodeDecodeError:
        pass
    return b.decode('cp874', errors='replace')
units = []          # (source, text)
for fn in ('gameword', 'gameintext', 'gameextext', 'servertext'):
    s = io.open(ROOT + '/CLIENT/data/gui/%s.xml' % fn, encoding='utf-8').read()
    for v in re.findall(r'<VALUE[^>]*>(.*?)</VALUE>', s, re.S):
        if thai(v): units.append(('ui', v))
for n in ('skill', 'crow', 'item'):
    raw = open(S + '/src/cur_%s.txt' % n, 'rb').read()
    for bl in raw.split(bytes([10])):
        l = declines(bl).rstrip(chr(13))
        if chr(9) in l:
            v = l.split(chr(9), 1)[1]
            if thai(v): units.append((n, v))
seen = {}; order = []
for src, t in units:
    if t not in seen: seen[t] = len(order); order.append((src, t))
chunks = []; cur = []; size = 0; LIMIT = 38000
for i, (src, t) in enumerate(order):
    if cur and (size + len(t) > LIMIT or (src != cur[-1][1] and size > LIMIT * 0.6)):
        chunks.append(cur); cur = []; size = 0
    cur.append((i, src, t)); size += len(t)
if cur: chunks.append(cur)
for k, c in enumerate(chunks):
    with io.open('%s/tr/in/chunk_%02d.tsv' % (S, k), 'w', encoding='utf-8', newline=chr(10)) as f:
        for i, src, t in c: f.write('%05d\t%s\t%s\n' % (i, src, esc(t)))
json.dump([t for _, t in order], io.open(S + '/tr/units.json', 'w', encoding='utf-8'), ensure_ascii=False)
print('unique', len(order), 'chunks', len(chunks))
for k, c in enumerate(chunks):
    print(k, len(c), sum(len(x[2]) for x in c), c[0][1], '..', c[-1][1])
