#!/bin/bash
# RAN EMU: install out-emu/RanEmu.apk on LDPlayer and give it the data.
#
#   ./emu-push.sh          install + data (first time: copies the real game's data on the device)
#   ./emu-push.sh data     only push the changed data again (after editing CLIENT)
#   D=<serial> ./emu-push.sh   another device (default: the first one adb lists)
#
# Data = the real game's data already on the device (com.ran.native, copied on the device,
# no 6 GB transfer), plus every CLIENT file that differs from the last built patch
# (emu/emu-diff.js), plus what the patch never ships: data/glogicserver/GLogicServer.rcc
# (the in-process server's drops and generators) and emutest/ (the PK test characters).
# Every pushed file is md5-checked on the device. The real game and its data are only read.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
CLIENT="$(cd "$HERE/../../CLIENT" && pwd)"
ADB="/c/Program Files/Unity/Hub/Editor/6000.5.8f1/Editor/Data/PlaybackEngines/AndroidPlayer/SDK/platform-tools/adb.exe"
export MSYS_NO_PATHCONV=1
D="${D:-$("$ADB" devices | awk 'NR>1 && $2=="device" {print $1; exit}')}"
[ -n "$D" ] || { echo "[!] no device"; exit 1; }
A() { "$ADB" -s "$D" "$@" < /dev/null; }     # never stdin: it would eat the file list of the loop below
SRC=/sdcard/Android/data/com.ran.native/files
DST=/sdcard/Android/data/com.ran.native.emu/files
echo "device $D"

if [ "$1" != data ]; then
  echo "== install =="
  A install -r "$(cygpath -w "$HERE/out-emu/RanEmu.apk")"
  if ! A shell "[ -f $DST/data/glogic/GLogic.rcc ]"; then
    echo "== copy the game's data on the device ($SRC -> $DST) =="
    A shell "[ -d $SRC/data ]" || { echo "[!] no game data at $SRC - install and patch the real game first"; exit 1; }
    A shell "mkdir -p $DST && cd $SRC && for f in *; do case \$f in cache|Logs|crash_pending|lastrun.bin|sticklog|questcheck|*.ppm) ;; *) cp -r \"\$f\" $DST/ ;; esac; done"
    A shell "du -sh $DST"
  fi
fi

echo "== changed data =="
LIST="$(cd "$HERE/emu" && node emu-diff.js)"
EXTRA="data/glogicserver/GLogicServer.rcc"
for f in "$CLIENT"/emutest/*.charset; do [ -f "$f" ] && EXTRA="$EXTRA
emutest/$(basename "$f")"; done
n=0; bad=0
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  src="$CLIENT/$rel"; [ -f "$src" ] || { echo "  (missing locally) $rel"; continue; }
  A shell "mkdir -p \"$DST/$(dirname "$rel")\""
  A push "$(cygpath -w "$src")" "$DST/$rel" > /dev/null
  l=$(md5sum "$src" | cut -c1-32); r=$(A shell "md5sum \"$DST/$rel\"" | cut -c1-32)
  if [ "$l" = "$r" ]; then n=$((n+1)); else bad=$((bad+1)); echo "  [!] md5 differs: $rel"; fi
done <<< "$LIST
$EXTRA"
echo "pushed $n file(s), $bad bad"
#  Files made by the adb shell (cp, push) belong to "shell", and cp leaves them -rw-r-----:
#  the app is another user and could not read them (boot: "Gui.rcc not indexed"). Open them
#  to the app (read for the data, write for its options and logs).
A shell "chmod -R a+rwX $DST"
#  emu.ini is written by the app's start page now; push emu/emu.ini only with EMUINI=1
if [ "${EMUINI:-0}" = 1 ]; then A push "$(cygpath -w "$HERE/emu/emu.ini")" "$DST/emu.ini" > /dev/null; A shell "chmod a+rw $DST/emu.ini"; fi
echo "start: tap RAN EMU (start page: pick the character, Start)"
