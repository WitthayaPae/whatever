#!/bin/bash
# RAN EMU - the PC Emulator on Android, for testing unreleased data on LDPlayer.
#
#   ./build-emu.sh            build (x86_64, LDPlayer) + package -> out-emu/RanEmu.apk
#   ABI=arm64-v8a ./build-emu.sh   for a real phone/tablet
#
# Everything lives in out-emu/: nothing here touches out/, the real app's APK, its
# version, the patch or the store builds (MAKE-PATCH only looks at out/<abi>/libran.so
# and android/). The library is the shipped build plus -DRAN_EMU=ON, which adds
# SOURCE/GameEmulator/EmuCore.cpp and one define to the app target only.
#
# Install + data: ./emu-push.sh (installs the APK, pushes CLIENT data and the server's
# GLogicServer.rcc to /sdcard/Android/data/com.ran.native.emu/files/).
set -e
unset MSYS_NO_PATHCONV MSYS2_ARG_CONV_EXCL
HERE="$(cd "$(dirname "$0")" && pwd)"
U="/c/Program Files/Unity/Hub/Editor/6000.5.8f1/Editor/Data/PlaybackEngines/AndroidPlayer"
NDK="$U/NDK"; CM="$U/SDK/cmake/3.22.1/bin"
BT="$U/SDK/build-tools/36.0.0"
PLATFORM="$U/SDK/platforms/android-34/android.jar"
JAVA="$U/OpenJDK/bin/java.exe"; JAVAC="$U/OpenJDK/bin/javac.exe"
ABI=${ABI:-x86_64}
ROOT="$HERE/out-emu"
BLD="$ROOT/$ABI"
STAGE="$ROOT/apk"
mkdir -p "$BLD"

echo "== native ($ABI, RAN_EMU) =="
"$CM/cmake.exe" -S "$HERE" -B "$BLD" -G Ninja \
  -DCMAKE_MAKE_PROGRAM="$CM/ninja.exe" \
  -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" \
  -DRAN_ASAN=OFF -DRAN_BOUNDS=OFF -DRAN_WRAPMEMCPY=OFF -DRAN_EMU=ON \
  -DANDROID_ABI=$ABI -DANDROID_PLATFORM=android-24 -DANDROID_STL=c++_shared \
  -DCMAKE_BUILD_TYPE=${BUILD_TYPE:-RelWithDebInfo} > "$BLD/configure.log" 2>&1 || { tail -40 "$BLD/configure.log"; exit 1; }
"$CM/ninja.exe" -C "$BLD" -k 0 2>&1 | tee "$BLD/build.log" | grep -E 'error:|FAILED' | head -${MAXERR:-60} || true
ERR=$(grep -c 'error:' "$BLD/build.log" || true)
echo "--- errors: $ERR"
[ -f "$BLD/libran.so" ] && [ "$ERR" = 0 ] || { echo "[!] build failed - APK NOT built"; exit 1; }

echo "== package =="
rm -rf "$STAGE"; mkdir -p "$STAGE/lib/$ABI" "$STAGE/classes"
case "$ABI" in arm64-v8a) TRIPLE=aarch64-linux-android ;; x86_64) TRIPLE=x86_64-linux-android ;; *) echo "unknown ABI"; exit 1 ;; esac
NDKBIN="$NDK/toolchains/llvm/prebuilt/windows-x86_64/bin"
cp "$BLD/libran.so" "$STAGE/lib/$ABI/"
"$NDKBIN/llvm-strip.exe" --strip-debug "$(cygpath -w "$STAGE/lib/$ABI/libran.so")"
cp "$NDK/toolchains/llvm/prebuilt/windows-x86_64/sysroot/usr/lib/$TRIPLE/libc++_shared.so" "$STAGE/lib/$ABI/"

# Java: the real app's classes (RanActivity runs the game) + the emu start page (emu/java)
find "$HERE/android/java" "$HERE/emu/java" -name '*.java' | while read -r f; do printf '"%s"\n' "$(cygpath -m "$f")"; done > "$STAGE/java.list"
"$JAVAC" -source 8 -target 8 -nowarn -encoding UTF-8 -bootclasspath "$(cygpath -w "$PLATFORM")" \
  -classpath "$(cygpath -w "$PLATFORM")" -d "$(cygpath -w "$STAGE/classes")" "@$(cygpath -w "$STAGE/java.list")" 2>&1 | grep -v '^Note:' || true
"$U/OpenJDK/bin/jar.exe" cf "$(cygpath -w "$STAGE/classes.jar")" -C "$(cygpath -w "$STAGE/classes")" .
"$JAVA" -cp "$(cygpath -w "$BT/lib/d8.jar")" com.android.tools.r8.D8 --min-api 24 --lib "$(cygpath -w "$PLATFORM")" \
  --output "$(cygpath -w "$STAGE")" "$(cygpath -w "$STAGE/classes.jar")"

"$BT/aapt2.exe" compile --dir "$(cygpath -w "$HERE/android/res")" -o "$(cygpath -w "$STAGE/res.zip")"
"$BT/aapt2.exe" link -o "$STAGE/base.apk" -I "$PLATFORM" --manifest "$HERE/emu/AndroidManifest.emu.xml" \
  --min-sdk-version 24 --target-sdk-version 34 "$(cygpath -w "$STAGE/res.zip")"
WINAPK="$(cygpath -w "$STAGE/base.apk")"; WINLIB="$(cygpath -w "$STAGE/lib")"; WINDEX="$(cygpath -w "$STAGE/classes.dex")"
powershell.exe -NoProfile -Command "
  Add-Type -A System.IO.Compression.FileSystem
  \$zip = [System.IO.Compression.ZipFile]::Open('$WINAPK','Update')
  foreach (\$f in Get-ChildItem -Recurse -File '$WINLIB') {
    \$rel = 'lib/' + \$f.Directory.Name + '/' + \$f.Name
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(\$zip, \$f.FullName, \$rel, [System.IO.Compression.CompressionLevel]::NoCompression)
  }
  [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(\$zip, '$WINDEX', 'classes.dex', [System.IO.Compression.CompressionLevel]::Optimal)
  \$zip.Dispose()"

# the local debug key: a test app, never the release key
KS="$HERE/android/debug.keystore"
"$BT/zipalign.exe" -f -p 4 "$WINAPK" "$(cygpath -w "$STAGE/aligned.apk")"
"$JAVA" -jar "$(cygpath -w "$BT/lib/apksigner.jar")" sign --ks "$(cygpath -w "$KS")" --ks-pass pass:android --key-pass pass:android \
  --out "$(cygpath -w "$ROOT/RanEmu.apk")" "$(cygpath -w "$STAGE/aligned.apk")"
printf "\n%s  %.1f MB  (%s)\n" "out-emu/RanEmu.apk" "$(stat -c%s "$ROOT/RanEmu.apk" | awk '{print $1/1048576}')" "$ABI"
echo "next: ./emu-push.sh"
