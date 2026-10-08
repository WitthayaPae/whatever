# Store plan — TestFlight (iOS) and Google Play (Android)

Written 2026-10-08, replaces TESTFLIGHT-PLAN.md. Goal (user, 2026-10-08): get the app
on TestFlight and on the Play Store.

The direct channels stay: the APK from ran-legacy-m.com and the AltStore/SideStore
source. A store rejection or takedown must cost players nothing.

---

## 0. The risk that decides everything: IP

RAN Online belongs to its original developer/publisher. Both stores ask whether we
hold the rights to the content.

- **Apple** (guideline 5.2): needs proof of rights or permission when asked. A
  complaint from the owner removes the app. Repeat cases can close the developer
  account.
- **Google** (Intellectual Property policy): same. A takedown counts as a strike on
  the developer account. Several strikes terminate the account and any linked
  accounts.

Other private servers being listed proves only that nobody has complained yet. The
user decides whether to take this risk. Everything below assumes yes.

Ways to lower it: a name and store icon of our own (not "RAN Online", not the
original logo), and no original-publisher trademarks in the listing screenshots.
Use an account that losing would not hurt anything else.

---

## 1. Account decisions (user)

| | Apple Developer Program | Google Play Console |
|---|---|---|
| Cost | $99 USD / year | $25 USD once |
| Personal account | Allowed. The person's legal name shows as the seller. | Allowed, but new personal accounts must run a **closed test with 12+ testers opted in for 14 days in a row** before production is unlocked. The count dropping below 12 restarts the clock. Google checks the testers really play. |
| Organisation account | Needs a registered company + D-U-N-S number (free, a few days to weeks). | Same D-U-N-S. **No 12-tester rule.** |
| Identity check | Yes | Yes, plus a developer verification step for the account holder |

With a personal Play account, the Close Beta players are the 12 testers: they join the
closed test by Google account email or Google Group, install from Play, and play for 14
days. This fits the beta schedule.

---

## 2. Store build vs direct build

Both stores forbid what our launcher does today: replace its own binary.

- Play: an app may not update itself or download executable code (.so, dex) outside
  Play. `REQUEST_INSTALL_PACKAGES` is a restricted permission. A game that installs its
  own APK will be rejected.
- Apple: no installing other code (2.5.2). The TestFlight build updates via TestFlight.

**Data patching stays allowed in both** (maps, items, UI, GLogic, Gui.rcc, textures).
The patch system is unchanged for data.

So one source tree, two build variants, `STORE=1` vs the default direct build:

| | Direct build (today) | Store build |
|---|---|---|
| Data patch from ran-legacy-m.com | yes | **yes, same** |
| APK/IPA self-update when minApk/minIos is above us | installs the new APK / points to SideStore | **opens the Play Store page / TestFlight app** instead |
| `REQUEST_INSTALL_PACKAGES` | yes | **removed** |
| `MANAGE_EXTERNAL_STORAGE`, READ/WRITE_EXTERNAL_STORAGE | yes (old /sdcard/ran move) | **removed** (All-files access is refused for games). Data stays in the app's own external files dir, which needs no permission. |
| Package / bundle id | com.ran.native | **separate id** (e.g. `com.ranlegacym.game`), so a phone can hold both and the store copy cannot collide with the APK's signature |
| Signing | our APK key | Play App Signing (we upload with an upload key) / Apple distribution cert |
| Format | APK | **AAB** for Play; signed IPA for TestFlight |

Version numbers stay shared: `versionCode` = Play version code = iOS build number.

---

## 3. Android work to pass Play's technical checks (Claude)

Measured on 2026-10-08:

1. **Target API.** We target 34. Since 2026-08-31, new apps and updates must target
   **API 36** (Android 16); an extension to 2026-11-01 can be requested. Raise
   `targetSdkVersion` to 36, build against android-36, then re-test the behaviour
   changes: edge-to-edge is forced, predictive back, foreground/background rules,
   and the boot handover.
2. **16 KB pages.** `libran.so` LOAD segments are aligned to 0x1000 (4 KB). Play needs
   16 KB support for apps targeting Android 15+. Link with
   `-Wl,-z,max-page-size=16384` (NDK r27+ does this by default) and check with
   `llvm-readelf -lW` that every LOAD shows 0x4000. Run once on a 16 KB emulator image.
3. **AAB.** `build-apk.sh` makes an APK by hand. Add a bundle step (bundletool, with
   the same libs, dex, and resources), signed with the upload key.
4. **Store variant** (section 2): manifest without the two restricted permissions,
   launcher compiled with the self-install path replaced by "open Play Store".
   CLAUDE.md parity: the iOS launcher gets the same change for TestFlight.
5. **64-bit only** is fine (arm64-v8a, plus x86_64 for emulators).

## 4. iOS work (Claude)

6. CI signing: distribution certificate and provisioning profile as GitHub secrets;
   build a signed IPA next to the unsigned AltStore one.
7. CI uploads each build to TestFlight (App Store Connect API key).
8. The "update your app" stop (`ran_ios_patch.mm` / `ran_ios_main.mm`): a TestFlight
   install opens TestFlight; a SideStore install keeps the SideStore steps.
9. `make-ios-source.js` keeps publishing the SideStore IPA too.

TestFlight limits: 100 internal testers with no review; up to 10,000 external testers
with a public link, every build through Beta App Review; builds expire after 90 days.

---

## 5. Store listing and policy items (user + Claude)

- **Privacy policy URL** (required by both). Claude drafts, hosted on ran-legacy-m.com.
- **Account deletion.** Play requires an in-app path **and** a web link to delete the
  game account, if accounts can be created from the app. Apple requires it in-app.
  Needs a small server/web piece (flag the account, same as character delete).
- **Data safety (Play) / privacy labels (Apple):** account id, chat, crash reports
  (ran-legacy-m.com/crash), device model.
- **Content rating:** IARC questionnaire (Play) and the Apple age rating: fantasy
  violence, PvP, unmoderated chat between players. Expect 12+ to 16+.
- **Payments.** Top-up stays on the website. The app must not link to it, mention it,
  or show prices (Play Payments policy; Apple 3.1.1). Items bought on the web may be
  used in the game. Any in-game top-up button or text pointing to the web must be
  hidden in the store build.
- **Gacha/random boxes:** both stores require the odds to be shown before purchase.
  Needed if a box can be bought with money (directly or via cash points).
- **Reviewer account:** a test login with a character for Apple and Google reviewers.
- **Listing art:** icon 512x512, feature graphic 1024x500, phone + tablet
  screenshots. Can reuse the promo work in PROMO/.

---

## 6. Order of work

1. User: decide on the IP risk; choose personal vs organisation; open both accounts.
2. Claude: Android technical work (API 36, 16 KB, store variant, AAB). Test on
   LDPlayer and the Tab S9. The direct build keeps shipping in the same patches.
3. Claude: iOS signing + TestFlight upload in CI; update screen.
4. Claude drafts the privacy policy, data-safety answers, reviewer notes, Thai listing
   text. User fills the consoles.
5. Account deletion (web + in-app).
6. Play: internal test, then closed test with 12+ testers for 14 days (personal
   account), then production. TestFlight: internal, then external review + public link.

## Open questions

- Store name and icon: our own, or keep "RAN LEGACY M"?
- Personal or organisation account (decides the 12-tester rule and the seller name)?
- Is registration possible inside the app, or only on the website? Decides how strict
  the account-deletion rule is.
