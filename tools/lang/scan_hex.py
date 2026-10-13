# Lists string literals in the game code that carry Thai as CP874 byte escapes
# ("\xB7\xD1...") and decodes them.
#   python scan_hex.py <repo root> <out.tsv>
import sys, os, re, io, collections
ROOT, OUT = sys.argv[1], sys.argv[2]
DQ = chr(34); BS = chr(92)
LIT = re.compile(DQ + r'(?:[^' + DQ + BS + BS + r'\n]|' + BS + BS + r'.)*' + DQ)
HEX = re.compile(BS + BS + r'x([0-9A-Fa-f]{2})')
OCT = re.compile(BS + BS + r'([0-3][0-7]{2})')
def thai(s): return any('฀' <= c <= '๿' for c in s)
def unescape(lit):
    out = bytearray(); i = 0
    while i < len(lit):
        c = lit[i]
        if c == BS and i + 1 < len(lit):
            n = lit[i + 1]
            m = HEX.match(lit, i)
            if m: out.append(int(m.group(1), 16)); i = m.end(); continue
            m = OCT.match(lit, i)
            if m: out.append(int(m.group(1), 8) & 255); i = m.end(); continue
            out += {'n': b'\n', 't': b'\t', 'r': b'\r', '0': b'\0'}.get(n, n.encode('latin-1', 'replace')); i += 2; continue
        out += c.encode('latin-1', 'replace'); i += 1
    return bytes(out)
dirs = ['SOURCE/Lib_Client', 'SOURCE/Lib_ClientUI', 'SOURCE/Lib_Engine', 'SOURCE/Lib_Network',
        'MOBILE/native/shim', 'MOBILE/native/platform']
rows = []; per = collections.Counter()
for d in dirs:
    for dp, dn, fn in os.walk(os.path.join(ROOT, d)):
        q = dp.replace(BS, '/')
        if any(x in q for x in ('/_mapbak', '/third_party', '/out/', '/.git')): continue
        for f in fn:
            if not f.lower().endswith(('.cpp', '.h', '.mm', '.inl', '.hpp')): continue
            p = os.path.join(dp, f)
            txt = open(p, 'rb').read().decode('latin-1')
            if (BS + 'x') not in txt: continue
            for ln, line in enumerate(txt.split(chr(10)), 1):
                if (BS + 'x') not in line: continue
                # adjacent literals ("..." "...") are one string to the compiler
                for m in re.finditer('(?:' + LIT.pattern + r'[ \t]*)+', line):
                    parts = LIT.findall(m.group(0))
                    raw = b''.join(unescape(x[1:-1]) for x in parts)
                    if not any(b >= 0xA1 for b in raw): continue
                    try: u = raw.decode('utf-8')
                    except UnicodeDecodeError: u = raw.decode('cp874', errors='replace')
                    if thai(u):
                        rel = os.path.relpath(p, ROOT).replace(BS, '/')
                        rows.append((rel, ln, u.replace(chr(10), BS + 'n').replace(chr(13), '').replace(chr(9), BS + 't'))); per[rel] += 1
with io.open(OUT, 'w', encoding='utf-8', newline=chr(10)) as f:
    for r in rows: f.write('%s\t%d\t%s\n' % r)
print('literals', len(rows), 'unique', len(set(r[2] for r in rows)), 'chars', sum(len(x) for x in set(r[2] for r in rows)), 'files', len(per))
for k, v in per.most_common(70): print(v, k)
