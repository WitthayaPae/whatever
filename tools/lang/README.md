# English language data

The shipped English files (`CLIENT/data/gui/*_en.xml`, `CLIENT/data/glogic/*_en.txt`,
`LangText_en.txt`, `*_english.ini`) are generated from the translation memory here.
Design and hooks: `MOBILE/STATUS.md`, section "Thai / English language option".

| File | What it is |
|---|---|
| `tm.json` | Thai -> English for UI text and item / skill / monster names |
| `tm_talk.json`, `tm_talk_obj.json` | Thai -> English for NPC talk, quest text, quest objective lines |
| `keyed2.json`, `keyed3.json` | lookup key -> Thai for NPC talk / quests / objectives (what `LangText_en.txt` is keyed by) |
| `maps_full.json` | map id -> Thai name |
| `GUIDE.md` | the translation rules and glossary every batch was translated under |
| `prep.py` | collects the unique Thai strings from the UI files and name tables into chunks |
| `validate.py` | checks a translated batch (ids, ASCII, format specifiers, entities) and writes a tm |
| `build_en.py` | tm -> `*_en.xml` overlays and `*StrTable_en.txt` |
| `build_small.py` | map names, `comment_english.ini`, `busmain_english.ini` |
| `extract_talk.js` | NPC talk out of the `.ntk` files (quest text comes from `quest/questText_TH.txt`; objective lines from the in-client dump, see `GLQuestMan::DumpObjectiveText`) |
| `scan_code.py`, `scan_hex.py` | find Thai string literals in the code |

The scripts were written against a scratch folder layout (`<scratch>/tr/...`, decoded
tables in `<scratch>/src/`); paths need adjusting before a re-run. After changing a
translation: rebuild, encrypt the `.txt` tables (AES layer, see `rcc-extract/gamecrypt.js`),
and repack with `rcc-extract/rcc-pack.js`.

New Thai text added to the game later shows in Thai for English players until it is
added to the memory and the files are rebuilt.
