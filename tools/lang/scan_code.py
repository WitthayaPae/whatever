# Lists every string literal containing Thai in the client code.
#   python scan_code.py <repo root> <out.tsv>
import sys, os, re, io, collections
ROOT, OUT = sys.argv[1], sys.argv[2]
DQ = chr(34); BS = chr(92)
LIT = re.compile(DQ + r'(?:[^' + DQ + BS + BS + r'\n]|' + BS + BS + r'.)*' + DQ)
def thai(s): return any('฀' <= c <= '๿' for c in s)
def decode(b):
    try:
        u = b.decode('utf-8'); return u, 'utf8'
    except UnicodeDecodeError:
        return b.decode('cp874', errors='replace'), 'cp874'
dirs = ['SOURCE/Lib_Client', 'SOURCE/Lib_ClientUI', 'SOURCE/Lib_Engine', 'SOURCE/Lib_Network',
        'MOBILE/native/shim', 'MOBILE/native/platform', 'MOBILE/native/android/java']
rows = []; per = collections.Counter(); enc = collections.Counter()
for d in dirs:
    for dp, dn, fn in os.walk(os.path.join(ROOT, d)):
        if any(x in dp.replace(BS, '/') for x in ('/_mapbak', '/third_party', '/out/', '/.git')): continue
        for f in fn:
            if not f.lower().endswith(('.cpp', '.h', '.mm', '.java', '.inl', '.hpp', '.m')): continue
            p = os.path.join(dp, f)
            raw = open(p, 'rb').read()
            for ln, bl in enumerate(raw.split(bytes([10])), 1):
                if not any(c >= 0x80 for c in bl): continue
                u, e = decode(bl)
                code = u.split('//')[0] if DQ not in u.split('//')[0] or True else u
                # keep literals that are not inside a // comment
                cut = None
                i = 0; inq = False
                while i < len(u) - 1:
                    c = u[i]
                    if c == BS and inq: i += 2; continue
                    if c == DQ: inq = not inq
                    elif not inq and c == '/' and u[i + 1] == '/': cut = i; break
                    i += 1
                body = u if cut is None else u[:cut]
                for m in LIT.finditer(body):
                    s = m.group(0)[1:-1]
                    if thai(s):
                        rel = os.path.relpath(p, ROOT).replace(BS, '/')
                        rows.append((rel, ln, e, s)); per[rel] += 1; enc[e] += 1
with io.open(OUT, 'w', encoding='utf-8', newline=chr(10)) as f:
    for r in rows: f.write('%s\t%d\t%s\t%s\n' % r)
print('literals', len(rows), 'unique', len(set(r[3] for r in rows)), 'files', len(per), dict(enc))
for k, v in per.most_common(60): print(v, k)
