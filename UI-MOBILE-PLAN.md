# Mobile UI redesign — research and plan

Written 2026-10-08. User: "for the mobile for all UI I wanted to make it easy for
mobile, better design, match the mobile only. Right now it's from PC, it's really
hard to use. It's big work because it's for every window."

Status: **research + proposal, waiting for the user's approval of the design**.
Nothing implemented yet. PC client untouched by everything here (`RAN_MOBILE`).

---

## 1. What we have today (measured 2026-10-08, LDPlayer 3840x2160, test01)

- The inner interface registers **~110 windows** (`InnerInterfaceGuid.h`, ids ending
  `_WINDOW`), plus modals, tooltips and HUD pieces.
- Mobile treatment so far is generic: every `CUIWindow` is drawn **2x** around its own
  centre (`DxGameStage MobileMagnifyWants` / `MobileApplyMagnify`), with special pairs
  for bag + NPC shop / storage / enhance / ย่อย / trade. Only two windows were written
  for mobile: `MOBILE_MENU_WINDOW` (the grid menu) and `MOBILE_ENHANCE_WINDOW`.
- Captured: character, skills, party, club, quest, friends, map, party finder,
  ranking, settings, item mall (scratchpad `uishots/`, not committed: other players'
  names and chat are on them).

Problems seen on those captures:

| # | Problem | Evidence |
|---|---|---|
| P1 | **Targets far below finger size.** Apple asks 44 pt, Android 48 dp. | Converted to an iPhone 15 (393 pt tall in landscape): quest list rows ≈ 17 pt, window close X ≈ 10 pt, character stat +/− ≈ 8 pt, settings checkboxes ≈ 10 pt, tabs ≈ 20 pt tall. |
| P2 | **Every window a different size and place.** | Character: right half. Party finder and ranking: almost full screen. Map: right side. Friends: middle. The player hunts for the close button each time. |
| P3 | **HUD shows through and around windows.** | Skill ring, attack button, joystick, chat and pad buttons draw beside or through translucent windows; a tap near an edge can hit the HUD instead. |
| P4 | **Mouse idioms with no touch equivalent.** | Hover tooltips, right-click to use/equip, drag-and-drop to equip/move/sell, shift-click to split, double-click. (The drag-and-drop bugs fixed this month all came from here.) |
| P5 | **Dense small text.** | Character window: ~20 stat lines in small type. Party finder: map list in small type. |
| P6 | **Windows that are mostly empty.** | Party and friends with nobody in them: a large dark rectangle with two small buttons. |
| P7 | **No consistent way out.** | Close X position differs per window; Back closes the top window but does not reliably reach the ESC menu (bug found 2026-10-08). |

## 2. Research — how others solved it

**Ports of old PC MMOs (closest to us).**
- Old School RuneScape mobile ([Jagex dev blog](https://oldschool.runescape.wiki/w/Update:Dev_Blog:_OSRS_Mobile)):
  - side panels split to the two screen edges, and collapsible;
  - chat moved to where the keyboard cannot cover it;
  - right-click replaced by touch gestures and long-press;
  - an interface-scaling setting;
  - feedback that a finger hides was redesigned.
- RuneScape port lessons ([Ocean View Games](https://oceanviewgames.co.uk/blog/posts/porting-20-year-old-game-mobile-runescape)):
  - right-click menus, hover, dense panels and hotkeys were the four things that did not translate;
  - "the gap between works on mobile and feels native on mobile is almost entirely a UI/UX problem".
- Albion Online ([interview](https://www.mmogames.com/articles/archives/albion-online-mobile-development-interview), [Unity](https://unity.com/blog/albion-online-cross-platform-pvp-mmo-architecture)):
  - one game for PC and mobile, with *platform-specific UI profiles* over the same logic and packets.
  - This is our situation exactly: game logic and packets stay, only the UI layer changes.

**General rules for complex games on touch** ([Ocean View Games](https://oceanviewgames.co.uk/blog/posts/mobile-ui-design-complex-games), [porting guide](https://oceanviewgames.co.uk/blog/posts/mobile-game-porting-guide), [Android 48 dp](https://support.google.com/accessibility/android/answer/7101858)):
- **Prioritise, don't miniaturise.** Show what the player needs now; hide the rest.
- **Targets:** 44 pt / 48 dp minimum, 8 dp apart. The hit area can be bigger than the art.
- **Replace mouse idioms:**
  - long-press for context actions, with a visible fill while held;
  - tap-select plus action buttons instead of drag;
  - snap-to-slot if dragging stays;
  - confirm anything destructive.
- **Finger occlusion:** a finger covers a 50–100 px radius, so put the information above the touch point, not under it.
- **Decouple UI from logic** so packets and prediction never change.

**Asian mobile MMORPG conventions** (MU Origin, Lineage 2M, Ragnarok M/Origin, Yulgang
Mobile...). Few written sources exist; this is the widely shared pattern, to be confirmed against the
user's own screenshots of games they like:
- **Full-screen, opaque panels.** The world is hidden or blurred; the HUD is gone while a panel is open.
- **One frame for every panel:** title top-left, currencies top-centre/right, close (X or back) top-right. A tab rail runs down one side.
- **Hubs instead of windows:** e.g. Character hub = stats | equipment | bag | pet | mount as tabs of one panel.
- **Inventory:** character model and equipment on the left, item grid on the right, filter tabs (all / equipment / consumables / materials / quest), Sort button.
- **Tap an item → detail card** with stats and big action buttons (Use, Equip, Enhance, Sell, Split, Drop). No right-click, no drag needed.
- **NPC talk** as a bottom sheet with the NPC portrait and large option buttons.

## 3. Proposal

### 3.1 One mobile frame for every window ("shell")

A new `CMobilePanel` frame, written once and used by every window:

```
+--------------------------------------------------------------------------+
| ← ตัวละคร                         [gold 1,234,567]  [point 0]       [ X ] |  top bar 56
+------+-------------------------------------------------------------------+
| สถานะ |                                                                   |
| อุปกรณ์|              content of the selected tab                         |
| กระเป๋า|              (rows >= 48, text >= 14 pt equivalent)               |
| สัตว์เลี้ยง|                                                               |
| พาหนะ |                                                                   |
+------+-------------------------------------------------------------------+
  tab rail 120                       content
```

- **Full screen, opaque, HUD hidden** while open (joystick, skill ring, pad buttons, chat).
  The game keeps running underneath; a hit or a PK warning still shows as a top toast.
- **Same close/back in the same place** on every panel; Back (Android) and the X both
  close the top panel. Fixes P2, P3 and P7 at once.
- **Safe-area aware** (camera notches, rounded corners). This matters for Android 15+
  store builds too.
- Panels that need the world visible (NPC talk, trade confirm, quick party invite) use a
  **bottom sheet** variant of the same frame instead of full screen.

### 3.2 Hubs instead of 110 separate windows

| Hub (menu cell) | Tabs (existing windows inside) |
|---|---|
| **ตัวละคร** | สถานะ (CHARACTER) · อุปกรณ์+กระเป๋า (INVENTORY wear + bag) · สัตว์เลี้ยง (PET, PET_SKILL) · พาหนะ (VEHICLE) |
| **สกิล** | สกิล (SKILL) with "assign to ring" in place of drag-to-tray · สกิลสัตว์เลี้ยง |
| **ภารกิจ** | กำลังทำ / สำเร็จ (QUEST / MODERN_QUEST) · เช็คชื่อ (ATTENDANCE) · กิจกรรม (ACTIVITY) |
| **สังคม** | ปาร์ตี้ · หาปาร์ตี้ (PARTYFINDER) · เพื่อน · คลับ · จดหมาย (NOTE) |
| **ร้านค้า** | ไอเท็มช็อป (ITEMMALL) · ของจากช็อป (ITEMBANK) · ประมูล (AUCTION) |
| **ข้อมูล** | อันดับ · บอส · แข่งขัน · แผนที่ (full-screen map) |
| **ตั้งค่า** | ภาพ · เสียง · เกม · ปุ่ม/HUD (OPTION_HW tabs, AUTOPOT, CHATMACRO) |

NPC-driven panels (NPC shop, storage, club storage, item exchange, enhance, ย่อย, mix,
rebuild, trade, private market) open as a **two-pane panel: bag on one side, the NPC
function on the other**. This is the pattern `MobileNpcBesideBag` already started, made
consistent.

### 3.3 One item interaction everywhere: tap → item card

Replaces right-click, hover tooltips and most drag-and-drop (fixes P4):

```
+------------------------------------+
|  [icon]  ดาบ +7 Sacred Gate        |
|          อาวุธ · Lv 150            |
|  ATK 436-456 ... (tooltip content) |
|------------------------------------|
| [ สวมใส่ ]  [ ตีบวก ]  [ ย่อย ]       |
| [ ทิ้ง ]    [ แยก ]    [ ย้ายไปคลัง ]  |
+------------------------------------+
```

- The buttons shown depend on context: in a shop "ขาย"; at storage "ฝาก"/"ถอน"; in trade
  "ใส่ในการแลก".
- Quantities use a stepper with − / + / สูงสุด instead of typing.
- Drag stays possible (with snap-to-slot) but is never required.
- Long-press on equipment = compare with what is worn.
- The tooltip text comes from the existing `ItemInfoToolTip` builder, so every stat line
  the PC shows is still there.

### 3.4 Lists, text and controls

- Rows ≥ 48 logical px at the phone scale. One line of primary text plus a small
  secondary line. Momentum scrolling (the UI already scrolls by drag in places).
- Minimum text about 14 pt equivalent. Stat screens are grouped into sections
  (พื้นฐาน / โจมตี / ป้องกัน / ธาตุ) instead of one long column.
- Checkboxes become switches. Combo boxes become a full-width picker sheet. Stat +/−
  become large steppers with an "apply" button.
- Empty states say what to do ("ยังไม่มีปาร์ตี้ — กด หาปาร์ตี้") instead of a blank
  rectangle (P6).

### 3.5 What stays the same

- Game logic, packets and the server: unchanged. Every action goes through the same
  `GLCharacter` / `GLGaeaClient` request as today, so nothing new can desync or dupe.
- The PC client: unchanged (`#ifdef RAN_MOBILE`).
- Android and iOS: both get it from one edit, because it all lives in `SOURCE/`.
- Thai text: from gameword.xml / Gui.rcc as now; new labels go there too.

## 4. How to build it in this codebase

Three ways to bring a window over, used by tier:

| Way | What | Cost | For |
|---|---|---|---|
| **A. Frame only** | Put the existing PC window inside the mobile frame (opaque, HUD hidden, standard close, enlarged to fill), and keep its controls. | small per window | the long tail (tier 3) |
| **B. Re-layout** | Same controls and logic, new mobile rects and sizes from a mobile XML layout (Gui.rcc), plus the item card in place of right-click/drag. | medium | tier 2 |
| **C. Mobile window** | New window class for mobile reading the same game data, the way `MobileEnhanceWindow` was done. | largest | tier 1, the screens used every session |

The frame (3.1), the hub/tab mechanism (3.2) and the item card (3.3) are built first,
once. Every window after that is mostly layout.

### Tiers (by how often a player uses them)

- **Tier 1 — every session (C):**
  - bag + equipment;
  - item card;
  - character stats;
  - skills (+ assign to ring);
  - quest;
  - NPC talk (bottom sheet);
  - NPC shop;
  - storage;
  - settings;
  - map.
- **Tier 2 — often (B):**
  - party, party finder, friends, club, notes;
  - trade, private market;
  - item mall, item bank, auction;
  - enhance, ย่อย, mix, rebuild;
  - pet, vehicle;
  - ranking, boss, competition;
  - attendance, auto-pot, chat macro.
- **Tier 3 — rare (A):** the other ~80 windows:
  - hair, face and colour cards;
  - the lock windows;
  - gender, school and scale change;
  - GM tools;
  - item search, and so on.

To rank by real usage rather than a guess, the client can count window opens per session
and send the totals with the existing report endpoint (ran-legacy-m.com/crash). That is
optional, small, and gives the order for tiers 2 and 3.

### Order of work

1. **Design approval.** Clickable mockups of the frame, the character hub, bag + item
   card, quest, NPC shop + bag, and settings. The user approves before any code.
2. **Foundation:** `CMobilePanel` frame, tabs, HUD hiding, Back handling, item card,
   stepper/switch/picker controls. Test on LDPlayer, the Tab S9 and a phone-sized
   emulator.
3. **Tier 1**, shipped together as one release so the game never shows half old, half
   new in the screens players use most ([[finish-full-design-dont-ship-half-states]]).
4. **Tier 2**, in groups (social, trade, crafting...).
5. **Tier 3** frame-only pass.

Each step: full interaction test per window, rects logged and checked at 1:1, before it
ships, on both platforms (shared code; iOS checked through CI + the store build).

## 5. Decisions so far

- 2026-10-08, user: **keep the current RAN window style** (dark panel, grey title bar,
  silver bevel tabs, gold headers), made more compact for mobile, with special care for
  the windows that are too small today.
- 2026-10-08, user: **4K quality**. The new frame is drawn at the screen's real resolution
  from 9-slice art authored at 4K (corners, edges, tab and button plates), not the PC's
  small textures stretched 2x. Icons use the HD set (`CLIENT/textures/gui_hd`, already
  shipping). Text is rasterised at its final pixel size, not at 1280x720 and then scaled.
  Check every new window with a 1:1 crop on the Tab S9 (2560x1600) and the LDPlayer 4K
  screen before it ships.
- Mockup v1 (clickable): https://claude.ai/artifact/GJParct9A8qo1wNs6hFu4d. It covers
  character stats, bag + equipment + item card, quest, NPC shop + bag, and settings.
  Sizes are in the game's 1280x720 units: tabs/buttons 80 (≈44 pt on an iPhone 15), rows 64,
  slots 76, steppers 64x56. Colours were sampled from the live settings window.

- Mockup v2 (same link): **all 110 windows**, catalogued by hub with a mockup each.
  - Tiers: 20 in tier 1, 40 in tier 2, 44 in tier 3, 2 already on the HUD, 4 hidden on mobile
    (ESC menu, key settings, VN play-time, SMS).
  - Shared layout families: list + detail; bag pairs (shop, storage, item bank, auction storage, sell stall);
    craft bench (enhance, ย่อย, rebuild, mix, transfer, trash, pet-skin mix, NPC exchange); picker (11 cards);
    PIN pad (10 lock windows); confirm / quantity sheets; bottom sheets (NPC talk, player menu); table; form.
  - The item card is a redesign of the existing `CMobileItemSheet` and keeps its labels (MOBILE_ITEM_SHEET).

## 6. Open questions for the user

- Which mobile MMORPGs do you like the UI of? Screenshots of their bag, character and
  shop screens would pin the visual style (colours, frame art, fonts) better than
  anything written here.
- Full screen (world hidden) for big panels, or a wide side sheet with the world still
  visible on one side?
- Keep the current dark/gold RAN look, or a new mobile skin?
- Is drag-and-drop still wanted at all once tap → item card exists?
