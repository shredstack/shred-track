# Releasing a new iOS build to App Store Connect

Step-by-step for cutting a new ShredTrack iOS build and getting it into
App Store Connect (TestFlight and/or the App Store).

## Key facts about this project

ShredTrack iOS is a **Capacitor thin shell**. The native app does not bundle
the web app — it loads `https://shredtrack.shredstack.net` directly (see
`capacitor.config.ts`). Practical consequences:

- A "new iOS build" almost never needs a code change. You bump the build
  number, sync Capacitor, archive, and upload.
- Web/UI changes ship by deploying the Next.js app to Vercel, **not** by
  releasing to the App Store. Only release a new iOS build when native
  code, plugins, capabilities, Info.plist, icons, or the minimum OS change.

| Setting              | Value                                  |
| -------------------- | -------------------------------------- |
| App bundle ID        | `net.shredstack.shredtrack`            |
| Watch app bundle ID  | `net.shredstack.shredtrack.watchkitapp`|
| Apple Team ID        | `VWU4D8FPH8`                           |
| Xcode scheme         | `App`                                  |
| Xcode project        | `ios/App/App.xcodeproj`                |
| Marketing version    | `MARKETING_VERSION` (currently `1.1`)  |
| Build number         | `CURRENT_PROJECT_VERSION` (currently `4`) |

There is **no `.xcworkspace`** — this project uses Swift Package Manager
Capacitor, so you open `App.xcodeproj` directly.

---

## 1. Pre-flight checklist

Run from the repo root (`/Users/sarahdorich/shred-track`).

- [ ] **You are on a clean, up-to-date branch.** `git status` is clean and
      the web app is already deployed to production if this release depends
      on it.
- [ ] **The ngrok dev flag is OFF.** Confirm `.env.local` has no active
      `NEXT_PUBLIC_NGROK_DOMAIN` line (commented out or absent). If it is
      set, the build would point at your local tunnel instead of production.
      ```bash
      grep -n NGROK .env.local
      ```
      Expect no output (or a `#`-commented line).
- [ ] **Dependencies are installed.** `npm install` if anything changed.

---

## 2. Bump the version and build numbers

Every upload to App Store Connect needs a **unique, higher** build number
(`CFBundleVersion`). The marketing version (`CFBundleShortVersionString`)
only changes when you want a new user-facing version.

- **New build of the same version** (bug fixes, native tweaks):
  bump build number only. `3` → `4`.
- **New user-facing version** (e.g. App Store update): bump the marketing
  version (`1.1` → `1.2`) **and** the build number.

Set both the **App** target and the **ShredTrackWatch Watch App** target to
the same values so the embedded watch app stays in sync.

**Easiest — in Xcode:**
1. Open `ios/App/App.xcodeproj`.
2. Select the **App** target → **General** tab → set **Version** and **Build**.
3. Select the **ShredTrackWatch Watch App** target → set the same Version and Build.

**Or from the terminal** (sets all targets at once):
```bash
cd ios/App
# Bump build number for the next upload
agvtool next-version -all
# (optional) set a new marketing version
agvtool new-marketing-version 1.2
```
Then verify:
```bash
grep -E "MARKETING_VERSION|CURRENT_PROJECT_VERSION" App.xcodeproj/project.pbxproj | sort -u
```

> **agvtool gotcha (this project):** `App/Info.plist` uses the build-setting
> variables `$(CURRENT_PROJECT_VERSION)` and `$(MARKETING_VERSION)`.
> `agvtool next-version -all` correctly bumps `CURRENT_PROJECT_VERSION` in
> `project.pbxproj`, but it *also* rewrites the `CFBundleVersion` value in
> `Info.plist` to a hardcoded literal (e.g. `4`), which breaks the variable
> for future bumps. After running agvtool, restore that one line:
> ```
> <key>CFBundleVersion</key>
> <string>$(CURRENT_PROJECT_VERSION)</string>
> ```
> agvtool may also print a harmless `Cannot find ".../YES"` warning — ignore
> it. To avoid all of this, just bump **Build** in Xcode's General tab.

---

## 3. Sync Capacitor

This regenerates the native bridge config and copies plugin updates into the
iOS project. Always run it before archiving.

```bash
# from repo root
npx cap sync ios
```

> If `webDir` (`out`) is missing or stale, `cap sync` may warn. That's fine
> for this thin-shell setup — the app loads the remote URL, not `out/`. The
> sync step that matters is updating `ios/App/App/capacitor.config.json` and
> plugins.

---

## 4. Archive in Xcode

1. Open the project:
   ```bash
   open ios/App/App.xcodeproj
   ```
2. In the scheme selector (top toolbar), choose the **App** scheme.
3. Set the run destination to **Any iOS Device (arm64)**. You cannot
   archive while a Simulator is selected.
4. Confirm signing: select the **App** target → **Signing & Capabilities** →
   Team is **ShredStack (VWU4D8FPH8)** and *Automatically manage signing*
   is on (unless you intentionally use manual provisioning). Repeat for the
   **ShredTrackWatch Watch App** target.
5. Menu: **Product → Archive**. Wait for the build to finish — the
   **Organizer** window opens automatically when it succeeds.

> If **Product → Archive** is greyed out, the destination is still a
> Simulator. Switch it to *Any iOS Device*.

---

## 5. Upload to App Store Connect

In the **Organizer** window (Window → Organizer if it's not open):

1. Select the archive you just created (check the version/build column).
2. Click **Distribute App**.
3. Choose **App Store Connect** → **Next**.
4. Choose **Upload** → **Next**.
5. Leave the default options checked (Upload symbols, Manage version — you
   can let Xcode strip Bitcode; it's not used) → **Next**.
6. Choose **Automatically manage signing** → **Next**.
7. Review the summary → **Upload**.
8. Wait for "Upload Successful".

Processing in App Store Connect then takes ~5–30 minutes. You'll get an
email when the build finishes processing (or an email if it's rejected for
something like a missing export-compliance answer).

---

## 6. Finish in App Store Connect (web)

Go to <https://appstoreconnect.apple.com> → **My Apps → ShredTrack**.

### Export compliance
`Info.plist` already declares `ITSAppUsesNonExemptEncryption = false`, so
App Store Connect should not prompt for encryption questions. If it does,
answer "No" (the app uses only standard HTTPS).

### For TestFlight (beta testers)
1. **TestFlight** tab → wait for the build to show as *Ready to Test*.
2. Add the build to an **Internal** or **External** testing group.
3. External groups need a one-time Beta App Review on the first build.

### For an App Store release
1. **Distribution / App Store** tab → **+ Version** if it's a new
   marketing version, or edit the current version.
2. Under **Build**, click **+** and select the build you just uploaded.
3. Fill in **What's New in This Version**, screenshots (if changed), and
   any metadata.
4. Set the release option (manual or automatic on approval).
5. **Add for Review** → **Submit for Review**.

---

## 7. Quick command reference

```bash
# Pre-flight
grep -n NGROK .env.local               # expect no active line
git status                             # expect clean

# Bump build number (run inside ios/App)
cd ios/App && agvtool next-version -all && cd ../..

# Sync Capacitor
npx cap sync ios

# Open Xcode to archive
open ios/App/App.xcodeproj
# → scheme: App, destination: Any iOS Device, Product → Archive
# → Organizer → Distribute App → App Store Connect → Upload
```

---

## 8. Troubleshooting

| Symptom | Fix |
| ------- | --- |
| **Product → Archive is greyed out** | Destination is a Simulator. Switch to *Any iOS Device (arm64)*. |
| **"No profiles for net.shredstack.shredtrack were found"** | Signing & Capabilities → re-select Team `VWU4D8FPH8`, toggle *Automatically manage signing*. |
| **"The bundle version must be higher than the previously uploaded version"** | You reused a build number. Bump `CURRENT_PROJECT_VERSION` and re-archive. |
| **Watch app build rejected for version mismatch** | The Watch target's Version/Build must match the App target. Set both. |
| **Upload fails with an asset/icon error** | Check `Assets.xcassets` has all required icon sizes; re-run `npm run logo:generate` if logo assets changed, then `npx cap sync ios`. |
| **App opens to localhost / ngrok instead of production** | `NEXT_PUBLIC_NGROK_DOMAIN` was set in `.env.local` at sync time. Comment it out, re-run `npx cap sync ios`, re-archive. |
| **Build stuck "Processing" in App Store Connect for hours** | Usually clears on its own. If >24h, the build often needs re-uploading with a new build number. |

---

## Notes

- **Watch app**: ShredTrack ships an embedded watchOS app
  (`ShredTrackWatch Watch App`). It is archived and uploaded automatically
  as part of the `App` archive — you don't archive it separately, but you
  **do** bump its version/build alongside the App target.
- **Web changes don't need a release.** Because the shell loads
  `shredtrack.shredstack.net`, shipping a UI fix only requires a Vercel
  deploy. Reserve App Store releases for native-side changes.

