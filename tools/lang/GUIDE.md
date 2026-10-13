# Thai -> English translation guide (RAN Online / "Legacy M Online")

You are translating the in-game text of RAN Online, a school-themed MMORPG, from
Thai to English for an English language option. The text is UI labels, system
messages, item names, skill names and descriptions, and monster/NPC names.

## Input and output

Input file: UTF-8, one string per line, three tab-separated columns:

    <id> TAB <source> TAB <thai text>

`source` is `ui`, `skill`, `crow` (monster/NPC name) or `item` (item name).

Output: one line per input line, same order, two tab-separated columns:

    <id> TAB <english text>

- Every input id must appear exactly once. Never skip, merge or reorder lines.
- No header, no blank lines, no commentary, no markdown.
- Write the output with the Write tool as several part files of at most 400
  lines each (see your task for the exact file names). Do not print the
  translations in your reply.

## Hard rules (the game breaks if these are violated)

1. Output must be plain ASCII. No Thai characters, no curly quotes, no em/en
   dashes, no ellipsis character (use `...`), no accented letters.
2. Keep every format specifier exactly as written and in the same order:
   `%d %s %u %f %.1f %2d %I64d %c %%`, `%1% %2%`, `{0}`. Same count as the source.
3. Keep the literal two-character escapes `\n` and `\t` exactly where they
   belong (they are line breaks / tabs inside the string). Same count as source.
4. Keep XML entities as they are (`&lt; &gt; &amp; &quot; &#x0D; &#x0A;`) and
   never introduce a raw `<`, `>` or `&` that the source did not have.
   Tags such as `<BLUE>` that are already in the source stay unchanged.
5. Keep numbers, punctuation style, bracket style `[] () {} <>` and leading /
   trailing spaces of the source. Text already in English or Latin letters
   inside a string stays exactly as it is (only fix it if it is obviously
   broken English in a sentence you are rewriting anyway).
6. Never translate a tab into a space or the reverse.

## Style

- Natural, concise game English, like an official MMORPG localisation.
- UI labels and buttons must be SHORT. Thai is compact; aim for an English
  string no longer than about 1.3x the Thai character count, and abbreviate
  sensibly when needed (Lv, Atk, Def, Max, Min, Qty, Exp, Info).
- Title Case for labels, buttons, item names, skill names and monster names.
  Sentence case for messages and descriptions.
- Messages: clear and direct. No exclamation marks unless the source has them.
- Proper names with no meaning are transliterated; meaningful names are
  translated ("the Fire God Gun", not a phonetic rendering).

## Glossary (use these exact terms)

Schools: Sacred Gate, Mystic Peak, Phoenix.
Classes: นักหมัด/นักมวย = Brawler, นักดาบ = Swordsman, นักธนู = Archer,
นักเวทย์/พระ/ชามาน = Shaman, เอ็กซ์ตรีม = Extreme, ปืน/นักวิทย์ = Scientist,
แอสซาซิน/นินจา = Assassin, มายากล/นักมายากล = Magician.
Stats: keep Pow, Dex, Spi, Int, Str, Stm, HP, MP, SP, CP as they are.
พลังโจมตี = Attack, พลังป้องกัน/ป้องกัน = Defense, อัตราการโจมตี = Hit Rate,
อัตราการหลบหลีก = Avoid Rate, ต้านทาน = Resistance, คริติคอล = Critical,
ความเร็วในการเคลื่อนที่ = Move Speed, ความเร็วในการโจมตี = Attack Speed.
Elements: ไฟ = Fire, น้ำแข็ง = Ice, ไฟฟ้า = Electric, พิษ = Poison,
วิญญาณ = Spirit, ลม = Wind, ดิน = Earth. "ธาตุX" = "X Element";
"ธาตุXรุนแรง" = "Strong X Element".
Systems: คลับ/กิลด์ = Club, ปาร์ตี้ = Party, เพื่อน = Friend, เควส = Quest,
ไอเทม = Item, สกิล = Skill, มอนสเตอร์ = Monster, เลเวล = Level (Lv in tight
labels), ช่องเก็บของ/กระเป๋า = Inventory, ล็อกเกอร์/ตู้เก็บของ = Locker,
ร้านค้า = Shop, ร้านค้าส่วนตัว = Private Shop, ตลาด = Market, ทอง = Gold,
พ้อย/พอยท์ = Points, แต้มชีวิต/ค่าความดี = Karma, อัพเกรด/ตีบวก = Upgrade,
สัตว์เลี้ยง = Pet, พาหนะ/มอเตอร์ไซค์ = Vehicle / Motorcycle, บัฟ = Buff,
ดีบัฟ = Debuff, คูลดาวน์ = Cooldown, ดรอป = Drop, บอส = Boss, แผนที่ = Map,
วาร์ป = Warp/Teleport, เกิดใหม่/รีบอร์น = Rebirth, ชุบชีวิต = Revive,
ดวล = Duel, สงครามคลับ = Club War, คลับเดธแมตช์ = Club Death Match,
ไทรานนี่ = Tyranny, โรงเรียนวอร์ = School War, ตกปลา = Fishing,
ออโต้ฮันท์/ออโต้ = Auto Hunt, ออโต้พอท = Auto Potion, เติมเงิน = Top Up,
ไอเทมมอลล์ = Item Mall, แลกเปลี่ยน = Trade, ทิ้ง = Drop/Discard,
ยืนยัน = Confirm, ตกลง = OK, ยกเลิก = Cancel, ปิด = Close.
Item-name fragments: "N วัน" = "N Days" (1 วัน = "1 Day"), ถาวร = Permanent,
ชาย = Male, หญิง = Female, กล่อง = Box, กล่องของขวัญ = Gift Box,
ชุดแต่งกาย = Costume, ส่วนสกิล/ตำราสกิล = Skill Scroll, มีการเปลี่ยนแปลง =
Modified, ห้ามเทรด/ไม่สามารถแลกเปลี่ยน = No Trade, สุ่ม = Random,
ยา = Potion, บัตร/การ์ด = Card, ตั๋ว = Ticket, กุญแจ = Key, หิน = Stone,
แหวน = Ring, สร้อยคอ = Necklace, กำไล = Bracelet, ต่างหู = Earring,
เข็มขัด = Belt, หมวก = Hat, เสื้อ = Top, กางเกง = Pants, กระโปรง = Skirt,
ถุงมือ = Gloves, รองเท้า = Shoes/Boots, ดาบ = Sword, ธนู = Bow, หอก = Spear,
ปืน = Gun, ปืนไฟฟ้า = Electric Gun, ปืนแม่เหล็ก = Magnetic Gun, กระบอง = Staff,
สนับมือ = Knuckles, มีดสั้น = Dagger.

If one Thai item name differs from a neighbouring line only by a duration, a
gender or an element, the English must differ in exactly the same way and be
otherwise identical, so the set reads as one family.

## NPC talk and quest text (source = `npc` or `quest`)

- `npc` lines are what an NPC says to the player, or the short answer buttons
  the player taps in reply. `quest` lines are quest titles, quest descriptions
  and step objectives.
- Write natural spoken English for NPC speech, in the tone of the Thai line
  (teacher, shopkeeper, gang member, student). Keep it about as long as the
  Thai; do not add information.
- Answer buttons and quest titles: short, Title Case. Descriptions and
  objectives: sentence case.
- Item, monster and place names inside a sentence follow the glossary and are
  written the same way every time. Text inside `[ ]` is usually an item or
  NPC name: translate it and keep the brackets.
- Coordinates such as `X:11 Y:7`, numbers and counts stay exactly as written.
- School buildings and rooms: ห้องเรียน = Classroom, ห้องพยาบาล = Infirmary,
  สนามกีฬา = Athletic Field, ตลาด = Market, หอพัก = Dormitory,
  ครู/คุณครู/อาจารย์ = Teacher, นักเรียน = Student, รุ่นพี่ = Senior.
  สายหมัด = Brawler class, สายดาบ = Swordsman class, สายธนู = Archer class,
  สายเวทย์/สายพระ = Shaman class.
