# Store listing — Legacy M Online

Text for the Google Play Console and App Store Connect forms. Written
2026-10-08. Rules from STORE-PLAN.md: no "Ran" in the title or keywords, no
original-publisher names, no website top-up, no prices.

## Names

| Field | Value |
|---|---|
| App name (both) | Legacy M Online |
| Apple subtitle (30) | MMORPG สงครามโรงเรียน |
| Play short description (80) | MMORPG สงครามโรงเรียน เลือกสถาบัน ฝึกสกิล ปาร์ตี้ และ PvP กับเพื่อน เล่นฟรี |
| Package / bundle id | com.legacym.online |
| Category | Game > Role Playing |
| Contact email | [contact email] |
| Privacy policy URL | https://ran-legacy-m.com/privacy.html (upload MOBILE/store/privacy.html) |

## Full description (Play 4000 / Apple 4000)

Legacy M Online คือเกม MMORPG ออนไลน์บนมือถือ ในโลกของนักเรียนต่างสถาบันที่แข่งขันกันเพื่อเป็นที่หนึ่ง

• เลือกสถาบันและสายอาชีพ: นักหมัด นักดาบ นักธนู และหมอ
• ฝึกเลเวล เก็บสกิล ตีบวกอาวุธ และสร้างตัวละครในแบบของคุณ
• ตั้งปาร์ตี้ ล่าบอส และสำรวจแผนที่ต่าง ๆ กับเพื่อน
• PvP และศึก Tyranny ระหว่างสถาบัน
• ระบบคลับ เพื่อน และแชทในเกม
• ปุ่มและจอยสติ๊กออกแบบมาเพื่อมือถือ เล่นได้ทั้งมือถือและแท็บเล็ต

ต้องมีบัญชีเกมเพื่อเข้าเล่น และต้องเชื่อมต่ออินเทอร์เน็ตตลอดการเล่น
ครั้งแรกที่เปิด เกมจะดาวน์โหลดข้อมูลเพิ่มเติมประมาณ 5 GB แนะนำให้ใช้ Wi-Fi

(2026-10-09: classes taken from the in-game ranking tabs; Tyranny is live
(its announcements run in chat), School Wars is not, so it is not named. The
payload was 4.8 GB at patch 721. No website or top-up mention anywhere in the
listing: Play forbids steering players to outside payment.)

## Apple keywords (100 chars, comma-separated, no spaces needed)

mmorpg,rpg,online,ออนไลน์,เกมออนไลน์,นักเรียน,สถาบัน,pvp,ปาร์ตี้,สกิล

## Age rating answers

- Cartoon or fantasy violence: frequent / intense (combat is the game)
- Realistic violence: none
- Sexual content, nudity: none
- Profanity or crude humour: infrequent (players can type anything in chat)
- Alcohol, tobacco, drugs: none
- Simulated gambling: **answer "none" only if no random box can be bought,
  directly or through cash points. Otherwise "infrequent", and the odds must
  be shown before buying (both stores).** Needs the user's check.
- Unrestricted web access: no
- User-generated content / chat between users: yes (unmoderated chat)
- Expected result: Apple 12+, Play (IARC) Teen / 13+.

## Google Play — Data safety

Collected (not shared with third parties, encrypted in transit, deletion on
request):

| Data type | Why | Optional? |
|---|---|---|
| Personal info > User IDs (game username) | App functionality, account management | Required |
| Messages > Other in-app messages (chat) | App functionality | Required to chat |
| App activity > Other actions (game progress) | App functionality | Required |
| App info and performance > Crash logs | Analytics (diagnostics) | Required |
| App info and performance > Diagnostics | Analytics (diagnostics) | Required |
| Device or other IDs: **none** (no advertising id, no Android id) | | |
| Location, contacts, photos, financial info: **none** | | |

- Data is encrypted in transit: yes for HTTPS (updates, crash reports). The game
  connection itself is the server's own protocol. Answer "yes" only if the user
  accepts that; otherwise "no".
- Account deletion: accounts are created on the website, not in the app.
  Deletion URL: https://ran-legacy-m.com/privacy.html#delete (the "Deleting your
  account" section). A deletion request form on the website is better; needs
  the user.

## Apple — App Privacy

- Data linked to the user: User ID, Other user content (chat), Gameplay content
  — App Functionality.
- Data not linked to the user: Crash data, Performance data — App
  Functionality.
- Tracking: no.

## Reviewer notes (Play "App access" and TestFlight "Beta App Review")

Login required. Test account:
- Username: [reviewer username]
- Password: [reviewer password]

1. Open the app. The first launch downloads the game data (about 5 GB, Wi-Fi
   recommended), then the login screen appears.
2. Log in with the account above and pick the existing character.
3. Move with the left joystick, attack with the right button, skills on the
   ring. The menu button (top right) opens the bag, character, skills and
   settings.

The app has no purchases. Game data updates are downloaded from our server;
the app binary only changes through the store.

Make the reviewer account a normal player account (not GM) with a mid-level
character in a safe town. Never put a real player's password here.

## TestFlight "What to Test" (per build)

ทดสอบเกมเวอร์ชันล่าสุด: เข้าเล่น ทำเควส ตั้งปาร์ตี้ และแจ้งปัญหาที่เจอผ่านปุ่ม Send Beta Feedback ใน TestFlight
