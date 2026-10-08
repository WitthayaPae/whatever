#!/bin/bash
# The Google Play build: an .aab for upload plus a universal .apk to test it.
# Sourced by build-apk.sh when STORE=1, after the libs, classes.dex and
# res.zip are staged in $OUT. See MOBILE/STORE-PLAN.md.
#
# What differs from the direct build, all in a manifest copy:
#   - its own package id (STORE_PKG), so it installs beside com.ran.native and
#     the launcher knows it is the store build (RanLauncher.isStore)
#   - label "Legacy M Online" (store name, 2026-10-08)
#   - target API 36 (Play, since 2026-08-31)
#   - no REQUEST_INSTALL_PACKAGES / all-files / legacy storage: Play restricts
#     them and the store build never installs or migrates anything
#   - appCategory="game": Android 16 keeps the landscape lock for games on
#     large screens
#   - enableOnBackInvokedCallback="false": keeps KEYCODE_BACK reaching the game
#     (it opens the ESC menu) under predictive back
#
# The upload key signs the bundle. Google re-signs for players (Play App
# Signing). Lose the upload key and Google can reset it, but only after a
# support request, so keep a backup of native/.signing-upload and the keystore.

STORE_PKG="${STORE_PKG:-com.legacym.online}"
STORE_LABEL="Legacy M Online"
PLATFORM36="$U/SDK/platforms/android-36/android.jar"
BUNDLETOOL="$U/Tools/bundletool-all-1.17.2.jar"

SM="$OUT/AndroidManifest.store.xml"
sed -e "s|package=\"com.ran.native\"|package=\"$STORE_PKG\"|" \
    -e 's|android:targetSdkVersion="34"|android:targetSdkVersion="36"|' \
    -e '/android.permission.REQUEST_INSTALL_PACKAGES/d' \
    -e '/android.permission.MANAGE_EXTERNAL_STORAGE/d' \
    -e '/android.permission.READ_EXTERNAL_STORAGE/d' \
    -e '/android.permission.WRITE_EXTERNAL_STORAGE/d' \
    -e '/android:requestLegacyExternalStorage="true"/d' \
    -e "s|android:label=\"Ran Legacy M\"|android:label=\"$STORE_LABEL\"|g" \
    -e 's|<application|<application android:appCategory="game" android:enableOnBackInvokedCallback="false"|' \
    "$HERE/android/AndroidManifest.xml" > "$SM"

# STORE_VC=<n> builds a store APK with a lower version code, only to test the
# "update from Play Store" stop on a device. Never upload one.
if [ -n "${STORE_VC:-}" ]; then
  sed -i "s|android:versionCode=\"[0-9]*\"|android:versionCode=\"$STORE_VC\"|" "$SM"
  grep -q "android:versionCode=\"$STORE_VC\"" "$SM" || { echo "[!] STORE_VC not applied"; exit 1; }
  echo "  TEST BUILD: versionCode $STORE_VC"
fi

# Loud on any edit that did not land (a silent miss ships the wrong manifest).
chk() { if ! grep -q -- "$1" "$SM"; then echo "[!] store manifest: missing $1"; exit 1; fi; }
nochk() { if grep -q -- "$1" "$SM"; then echo "[!] store manifest: still has $1"; exit 1; fi; }
chk "package=\"$STORE_PKG\""
chk 'android:targetSdkVersion="36"'
chk 'android:appCategory="game"'
chk 'android:enableOnBackInvokedCallback="false"'
chk "android:label=\"$STORE_LABEL\""
nochk 'REQUEST_INSTALL_PACKAGES'
nochk 'EXTERNAL_STORAGE'
nochk 'requestLegacyExternalStorage'
nochk 'Ran Legacy M"'
echo "== store manifest: $STORE_PKG, target 36 =="

# Every library must be 16 KB aligned or Play refuses the bundle.
#  A failed readelf must fail the check, not pass it: the first version looped
#  over $(find) and split "DEV EP9" in two, readelf printed nothing, and the
#  empty result read as "aligned".
NSO=0
while IFS= read -r so; do
  ALIGN=$("$NDKBIN/llvm-readelf.exe" -lW "$(cygpath -w "$so")" | awk '$1=="LOAD" {print $NF}')
  if [ -z "$ALIGN" ]; then echo "[!] could not read $so"; exit 1; fi
  if echo "$ALIGN" | grep -qv '^0x4000$'; then
    echo "[!] $(basename "$(dirname "$so")")/$(basename "$so") is not 16 KB aligned"; exit 1
  fi
  NSO=$((NSO+1))
done < <(find "$OUT/lib" -name '*.so')
[ "$NSO" -gt 0 ] || { echo "[!] no libraries staged"; exit 1; }
echo "  $NSO libs 16 KB aligned"

# Resources in proto format, which is what a bundle module carries.
"$BT/aapt2.exe" link --proto-format -o "$(cygpath -w "$OUT/store_proto.apk")" -I "$(cygpath -w "$PLATFORM36")" \
  --manifest "$(cygpath -w "$SM")" --min-sdk-version 24 --target-sdk-version 36 \
  --version-code "$(sed -n 's/.*android:versionCode="\([0-9]*\)".*/\1/p' "$SM")" \
  --version-name "$(sed -n 's/.*android:versionName="\([^"]*\)".*/\1/p' "$SM")" \
  "$(cygpath -w "$OUT/res.zip")"

# The module: manifest/, dex/, lib/, res/, resources.pb.
MOD="$OUT/store_module"
rm -rf "$MOD"; mkdir -p "$MOD/manifest" "$MOD/dex"
( cd "$MOD" && "$U/OpenJDK/bin/jar.exe" xf "$(cygpath -w "$OUT/store_proto.apk")" )
mv "$MOD/AndroidManifest.xml" "$MOD/manifest/AndroidManifest.xml"
cp "$OUT/classes.dex" "$MOD/dex/classes.dex"
cp -r "$OUT/lib" "$MOD/lib"
rm -f "$OUT/store_module.zip"
#  jar, not .NET ZipFile: Windows PowerShell's CreateFromDirectory writes
#  backslash entry names and bundletool then finds no manifest/AndroidManifest.xml.
"$U/OpenJDK/bin/jar.exe" cfM "$(cygpath -w "$OUT/store_module.zip")" -C "$(cygpath -w "$MOD")" .

AAB="$HERE/out/$NAME-store.aab"
rm -f "$AAB"
"$JAVA" -jar "$(cygpath -w "$BUNDLETOOL")" build-bundle \
  --modules="$(cygpath -w "$OUT/store_module.zip")" --output="$(cygpath -w "$AAB")"

# The upload key, made once. Its passwords live in native/.signing-upload,
# gitignored, never printed.
UPF="$HERE/.signing-upload"
if [ ! -f "$UPF" ]; then
  P=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)
  printf 'UPLOAD_KEYSTORE="%s"\nUPLOAD_PASS=%s\nUPLOAD_ALIAS=upload\n' "$HERE/android/upload.jks" "$P" > "$UPF"
  "$U/OpenJDK/bin/keytool.exe" -genkeypair -keystore "$(cygpath -w "$HERE/android/upload.jks")" \
    -storetype PKCS12 -storepass "$P" -keypass "$P" -alias upload -keyalg RSA -keysize 4096 \
    -validity 10000 -dname "CN=Legacy M Online,C=TH" > /dev/null 2>&1 \
    || { echo "[!] could not create the upload key"; rm -f "$UPF"; exit 1; }
  echo "  NEW upload key: native/android/upload.jks (back it up with native/.signing-upload)"
fi
. "$UPF"

"$U/OpenJDK/bin/jarsigner.exe" -keystore "$(cygpath -w "$UPLOAD_KEYSTORE")" \
  -storepass "$UPLOAD_PASS" -keypass "$UPLOAD_PASS" -sigalg SHA256withRSA -digestalg SHA-256 \
  "$(cygpath -w "$AAB")" "$UPLOAD_ALIAS" > /dev/null \
  || { echo "[!] could not sign the bundle"; exit 1; }

# A universal APK from the same bundle, for testing it on LDPlayer / the tablet.
APKS="$OUT/store.apks"
rm -f "$APKS"
"$JAVA" -jar "$(cygpath -w "$BUNDLETOOL")" build-apks --mode=universal \
  --bundle="$(cygpath -w "$AAB")" --output="$(cygpath -w "$APKS")" \
  --ks="$(cygpath -w "$UPLOAD_KEYSTORE")" --ks-pass="pass:$UPLOAD_PASS" \
  --ks-key-alias="$UPLOAD_ALIAS" --key-pass="pass:$UPLOAD_PASS" > /dev/null
( cd "$OUT" && "$U/OpenJDK/bin/jar.exe" xf "$(cygpath -w "$APKS")" universal.apk )
mv "$OUT/universal.apk" "$HERE/out/$NAME-store.apk"

printf "\n%s  %.1f MB   (upload to Play)\n" "out/$NAME-store.aab" "$(stat -c%s "$AAB" | awk '{print $1/1048576}')"
printf "%s  %.1f MB   (test install: adb install -r)\n" "out/$NAME-store.apk" \
  "$(stat -c%s "$HERE/out/$NAME-store.apk" | awk '{print $1/1048576}')"
