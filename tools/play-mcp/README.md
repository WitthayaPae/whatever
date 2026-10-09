# google-play MCP server

Lets Claude Code manage **Legacy M Online** (`com.legacym.online`) on Google Play
through the Google Play Developer API (androidpublisher v3).

Registered in `DEV EP9/.mcp.json` as `google-play`. Claude Code asks once to
approve a project MCP server; after that the tools are there in every session.

## Tools

| Tool | Does |
|---|---|
| `play_status` | key check, app details, every track and release, uploaded bundles |
| `play_upload_bundle` | upload an `.aab` and release it on a track (internal / alpha / beta / production) in one commit |
| `play_set_release` | promote, staged rollout (`inProgress` + `userFraction`), complete, halt |
| `play_get_listing` / `play_update_listing` | store listing per language (title 30, short 80, full 4000) |
| `play_list_images` / `play_upload_images` | icon, feature graphic, screenshots |
| `play_update_details` | default language, contact email / site / phone |
| `play_get_testers` / `play_set_testers` | Google Groups on a testing track |
| `play_list_reviews` / `play_reply_review` | reviews from the last week, replies |
| `play_internal_share` | internal app sharing link for an `.aab` (no track, no review) |
| `play_set_data_safety` | submit the Data safety CSV |

Every changing tool opens an edit, makes its change and commits it, so one call
is one change in Play Console. Production is never a default: the track is
always named.

## What the API cannot do (Play Console only)

- **Create the app.** Play Console > Create app: name *Legacy M Online*,
  default language Thai, Game, Free.
- **The first bundle.** A new app's first `.aab` is uploaded in Play Console by
  hand (Testing > Internal testing > Create release). That upload ties the
  package name `com.legacym.online` to the app; the API works from then on.
- App content declarations other than Data safety (content rating
  questionnaire, target audience, ads, privacy policy URL, app access), store
  settings (category, tags), pricing and countries, individual tester email
  lists.

## Setup (once)

1. **Google Cloud project.** <https://console.cloud.google.com/> > create a
   project (for example `legacy-m-play`).
2. **Turn on the API.** APIs & Services > Library > *Google Play Android
   Developer API* > Enable.
3. **Service account.** IAM & Admin > Service accounts > Create: name
   `play-publisher`, no roles needed. Open it > Keys > Add key > JSON. Save
   the file as
   `MOBILE/native/.play/service-account.json`
   (the folder is gitignored; the key is a password, never commit or send it).
4. **Give it Play access.** Play Console > Users and permissions > Invite new
   users > the service account's email (`play-publisher@<project>.iam.gserviceaccount.com`)
   > App permissions > Legacy M Online, with: View app information, Manage
   testing tracks, Release to production, Manage store presence, Reply to
   reviews (or Admin for the app). Invite.
5. Check: `node MOBILE/tools/play-mcp/selftest.mjs` lists the tools and
   `play_status` shows the app instead of "no service-account key".

Permissions can take a few minutes, sometimes up to a day, to reach the API
after the invite. Until then `play_status` answers 401/403.

## Files

- `server.mjs` - the server. `PLAY_KEY` and `PLAY_PACKAGE` override the key
  path and the package.
- `selftest.mjs` - starts the server over stdio, lists the tools and calls
  `play_status`.
- `npm install` in this folder after a fresh clone (node_modules is ignored).
