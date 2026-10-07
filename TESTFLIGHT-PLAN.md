# TestFlight plan (iOS) — not started

Written 2026-10-08. Parked: the user will decide later. Until then, iOS stays on
AltStore/SideStore through the patch (`ios/source.json`).

## Why

- Players install with the free TestFlight app from the App Store: no SideStore, no
  LocalDevVPN, no 7-day re-signing.
- Another RAN private server, "RAN 2499 Origin", is reported to be on TestFlight. Not
  confirmed: no public trace found on 2026-10-08.

## Cost

| Who | Cost |
|---|---|
| Players | Free. Public link or invite, no per-player or per-download fee. |
| Us | Apple Developer Program, $99 USD per year (about 3,500 baht). |

## Limits

- **Internal testing:** up to 100 people on our App Store Connect team, no Apple review.
- **External testing:** up to 10,000 players, public link allowed. Every build goes
  through Beta App Review. The first build gets the strict check; later builds are
  usually quick (hours), but this is not guaranteed.
- **Expiry:** each build expires after 90 days, so we upload a new one at least every
  3 months.

## Risks

- **IP:** Apple asks for rights to the content. RAN Online belongs to its original
  publisher. A complaint from the owner removes the app; repeated or serious cases can
  ban the developer account.
- **Payments:** top-up stays on the website only. Never link to or mention paid top-up
  inside the app (guideline 3.1.1).
- **Fallback:** keep AltStore/SideStore working in parallel, so a rejection or takedown
  costs nothing.

## What changes for patching

| Part | Today | With TestFlight |
|---|---|---|
| Game data (maps, items, UI, balance) | Patch from ran-legacy-m.com | **Same, no change.** No Apple review. |
| App code (new app version) | IPA via SideStore source | New TestFlight build. Players update in the TestFlight app (auto-update possible). |
| Speed of an iOS code fix | Instant once uploaded | Waits for TestFlight beta review. Android stays instant. |

## Steps

**User**
1. Join the Apple Developer Program ($99/year) as an individual or organisation.
2. In App Store Connect, create the app: name, bundle id (match the current one or pick
   a new one), and the age rating questions.
3. Create an App Store Connect API key (Users and Access, then Keys) for CI uploads.

**Claude**
4. Add signing to `.github/workflows/ios-build.yml`:
   - distribution certificate and provisioning profile, stored as GitHub secrets;
   - build a signed IPA instead of the unsigned one.
5. Upload each build to TestFlight from CI (App Store Connect API key, `xcrun altool`
   or Transporter). Build number = `versionCode`, as now.
6. Change the "update your app" screen (`ran_ios_patch.mm` / `ran_ios_main.mm`,
   minIos fatal stop) to point TestFlight installs to the TestFlight app. SideStore
   installs keep the SideStore steps.
7. `make-ios-source.js` / `build-and-publish.js`: keep publishing the SideStore IPA
   too, so both paths get each version.
8. Write the beta-review notes for Apple: a test account login, and what the app does.

**Then**
9. Internal testing first (staff/testers, no review).
10. Submit for external testing and get the public link.
11. Every release: CI uploads automatically. Re-upload before the 90-day expiry even
    without code changes.

## Open questions

- Same bundle id as the SideStore build, or a separate one? With the same id, one
  phone can't hold both installs.
- Developer account name: personal or company? It shows on the TestFlight page.
- What age rating should we declare (PvP, chat between players)?
