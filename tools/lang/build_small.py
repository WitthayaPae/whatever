# Map names, comment.ini and the bus stop list in English.
#   python build_small.py <scratch>
# Map names go into LangText (key m:<dwID>); the two ini files become
# whole-file twins (comment_english.ini, busmain_english.ini).
import sys, io, json, re
S = sys.argv[1]
CRLF = chr(13) + chr(10); TAB = chr(9)
def thai(s): return any('฀' <= c <= '๿' for c in (s or ''))

# ---- map names: English in the order of the sorted unique Thai names
MAPS_EN = """Tiger 1F
Tiger 2F
Tiger 3F
CBT Event
Private Prison
Private Prison 2
Tiger B1
Tiger B2
Tiger B3
Duty-Free Market
History Building
Way to MP Computer Room
Way to PHX Computer Room
Way to SG Computer Room
Way to TD Computer Room
Harbor
Outside MP School
Outside PHX School
Outside SG School
Parking Lot 1
Parking Lot 2
Arena
Special Arena
Shopping Mall
MP Education Center
SG Education Center
PHX Education Center
Student Center 1
Student Center 2
Improvement Center
Research Center
Research Center B1
Science Center
Art Center
MP School
PHX School
SG School
Tiger School
Northern Heaven
Right Office
Office 1F
Office 30F
Office 50F
Office 51F
Office 52F
Office 90F
Left Office
Underground Office
Dormitory
Dormitory 2
MP Computer Room
PHX Computer Room
SG Computer Room
TD Computer Room
Practice Room
Test Lab
Laboratory
Principal's Office
Principal's Office 2
Library
Social Room
Equipment Room
Classroom 1
Classroom 2
Classroom 3
School Building 1
School Building 2
Tunnel
Underground Tunnel 3
Paradise Beach Island
Prison Test Zone
Prison Test Zone 2
Earthquake Zone
Disaster Zone
Southern Heaven
Land of Heaven
Land of Gods
Land of the Sword God
Land of the Bow God
Land of the Gun God
Land of the Fist God
Land of the Magic God
Quarantine Zone
Tokyo
Tokyo 2
Tokyo 3
Wedding Chapel
Heart of Heaven
Heart of the Land of Gods""".split(chr(10))
maps = json.load(io.open(S + '/tr/maps.json', encoding='utf-8'))
names = sorted(set(m['name'] for m in maps if thai(m['name'])))
assert len(names) == len(MAPS_EN), (len(names), len(MAPS_EN))
m2e = dict(zip(names, MAPS_EN))
raw = json.load(io.open(S + '/tr/maps_full.json', encoding='utf-8'))
lines = []
for m in raw:
    if m['name'] in m2e:
        dwid = (m['main'] & 0xFFFF) | ((m['sub'] & 0xFFFF) << 16)
        lines.append('m:%u' % dwid + TAB + m2e[m['name']])
p = S + '/tr/build/LangText_en.txt'
b = open(p, 'rb').read()
b = b''.join(l + b'\r\n' for l in b.split(b'\r\n') if l and not l.startswith(b'm:'))
open(p, 'wb').write(b + (CRLF.join(lines) + CRLF).encode('ascii'))
print('map names', len(lines))

# ---- comment.ini: line number -> English value (the part between "= " and the first comma)
COMMENT_EN = {
 15: 'Normal', 16: 'Skill Buff',
 30: 'Recover HP', 31: 'Recover MP', 32: 'Recover SP', 37: 'Recover HP+MP+SP', 42: 'Energy',
 256: 'Head (Hat)', 257: 'Upper (Top/Jacket)', 258: 'Lower (Pants/Skirt)', 259: 'Hand (Gloves)',
 260: 'Feet (Shoes)', 261: 'Hand (Weapon)', 262: 'Necklace', 263: 'Bracelet', 264: 'Ring',
 275: 'Belt', 276: 'Earring', 277: 'Accessory', 278: 'Ornament', 279: 'Face', 280: 'Misc',
 303: 'None', 304: 'Sword', 305: 'Blade', 306: 'Dagger', 307: 'Spear', 308: 'Staff', 309: 'Fist', 310: 'Bow',
 318: 'Knuckles', 319: 'Wand', 321: 'Whip', 322: 'Shield', 323: 'Hammer', 324: 'Umbrella', 328: 'Sword/Blade',
 596: 'Both (Neutral)',
 599: 'Brawler Male', 600: 'Swordsman Male', 601: 'Archer Female', 602: 'Shaman Female',
 603: 'Extreme Male', 604: 'Extreme Female', 605: 'Brawler Female', 606: 'Swordsman Female',
 607: 'Archer Male', 608: 'Shaman Male',
 1490: 'None', 1491: 'Sword', 1492: 'Blade', 1493: 'Sword/Blade', 1494: 'Dagger', 1495: 'Spear',
 1496: 'Staff', 1497: 'Fist', 1498: 'Bow', 1508: 'Knuckles', 1509: 'Wand', 1511: 'Whip',
 1513: 'Shield', 1514: 'Hammer', 1515: 'Umbrella',
}
b = open(S + '/inv/GLogic.rcc__comment.ini', 'rb').read()
ls = b.split(b'\n'); done = 0
for i, l in enumerate(ls, 1):
    u = l.decode('cp874', errors='replace')
    if thai(u):
        assert i in COMMENT_EN, ('comment.ini line', i, u)
        m = re.match(r'^(\s*\d+\s*=\s*)([^,\r]*?)(\s*(?:,.*)?\r?)$', u)
        assert m and thai(m.group(2)), (i, u)
        ls[i - 1] = (m.group(1) + COMMENT_EN[i] + m.group(3)).encode('cp874'); done += 1
assert done == len(COMMENT_EN), (done, len(COMMENT_EN))
open(S + '/tr/build/comment_english.ini', 'wb').write(b'\n'.join(ls))
print('comment.ini lines', done)

# ---- busmain.ini: lines 8..37, the two names at the end
BUS_EN = [
 ('Duty-Free Market', 'Entrance'), ('Arena', 'Entrance'),
 ('Outside SG School', 'School Front'), ('Outside SG School', 'Technical Teacher'),
 ('Outside SG School', 'Construction Zone 3'), ('Outside SG School', 'SG Roundabout'),
 ('Outside SG School', 'Road to Phoenix'), ('Outside SG School', 'Road to MP'),
 ('Outside SG School', 'Road to Shopping Mall'), ('Outside SG School', 'SG Junction'),
 ('Outside MP School', 'School Front'), ('Outside MP School', 'Trade Zone 1'),
 ('Outside MP School', 'Twin Towers Project 2'), ('Outside MP School', 'Shopping Street'),
 ('Outside MP School', 'Road to SG Roundabout'),
 ('Outside Phoenix School', 'School Front'), ('Outside Phoenix School', 'Industrial Zone 1'),
 ('Outside Phoenix School', 'Industrial Zone 4'), ('Outside Phoenix School', 'Lumber Shed'),
 ('Outside Phoenix School', 'Road to SG School'),
 ('Shopping Mall', 'Basketball Court'), ('Shopping Mall', 'Police Station'),
 ('Shopping Mall', 'Cargo Tunnel 1'), ('Shopping Mall', 'Indoor Sports Center'),
 ('Shopping Mall', 'Road to Private Prison'), ('Shopping Mall', 'Cargo Tunnel 2'),
 ('Harbor', 'Cold Storage'), ('Private Prison', 'Entrance'),
 ('Disaster Zone', 'Entrance'), ('Earthquake Zone', 'Entrance'),
]
b = open(S + '/inv/GLogic.rcc__busmain.ini', 'rb').read()
ls = b.split(b'\n'); k = 0
for i, l in enumerate(ls, 1):
    u = l.decode('cp874', errors='replace')
    if thai(u) and u.lstrip().startswith('Statin_Info'):
        parts = u.rstrip('\r').split(',')
        assert len(parts) == 6, (i, u)
        parts[4], parts[5] = BUS_EN[k]; k += 1
        ls[i - 1] = (','.join(parts) + ('\r' if u.endswith('\r') else '')).encode('ascii')
assert k == len(BUS_EN), (k, len(BUS_EN))
open(S + '/tr/build/busmain_english.ini', 'wb').write(b'\n'.join(ls))
print('bus stops', k)
