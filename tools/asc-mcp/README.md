# asc-mcp — App Store Connect (TestFlight) MCP server

Twin of `../play-mcp` for iOS. Registered as `app-store-connect` in `DEV EP9/.mcp.json`.

Key: the same team API key the signing setup uses, `MOBILE/native/.appstore/`
(gitignored): `AuthKey_<KEYID>.p8` + `config` (KEY_ID, ISSUER_ID, TEAM_ID).
No tool returns a secret; tester emails are masked.

| Tool | Does |
|---|---|
| asc_status | builds (processing, beta states, review), groups (public link, testers), what Test Information / review contact is missing |
| asc_set_test_info | beta description, feedback email, URLs (locale, default th) |
| asc_set_review_details | review contact, sign-in account, notes |
| asc_set_what_to_test | per-build "What to Test" |
| asc_create_group / asc_add_build_to_group | groups and their builds |
| asc_submit_review | Beta App Review for an external build |
| asc_public_link | public link on/off, limit |
| asc_testers | list / add / remove testers |
| asc_feedback | TestFlight screenshot + crash feedback |

Cannot: create the app record, upload builds (ios-testflight.yml does).

    npm install
    node selftest.mjs                 lists tools, calls asc_status
    node call.mjs asc_status          one call, same path as MCP
