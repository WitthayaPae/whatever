#!/bin/bash
#  The fixed crowd benchmark (RENDERER_PLAN.md, phase 0): the same scene, the
#  same numbers, on any device, so a renderer change is judged against a
#  baseline instead of by feel.
#
#      ./tools/crowd-bench.sh android <serial> [label] [players] [seconds]
#      ./tools/crowd-bench.sh ios      -       [label] [players] [seconds]
#
#  Before running: the game is in the world, standing at the bench spot
#  (Sacred Gate plaza, by the warehouse), camera at its default zoom, nothing
#  open. The script then:
#    1. spawns <players> fake players (default 500) fighting with skills
#       (loadtest + loadfx 10 casts/s),
#    2. waits 20 s for the crowd and the heat to settle into it,
#    3. records the client's own once-a-second FRAME lines for <seconds>
#       (default 120),
#    4. removes the fakes, and prints one summary line, also appended to
#       MOBILE/tools/bench-results.md.
#
#  The fakes are client-side only (GLGMLoadTest): nothing is sent to the
#  server, so this does not load the live server.
#
#  LDPlayer measures CPU and draw-call cost only: it hands GL to a desktop GPU,
#  so fill (GPU) cost does not show there. Fill is measured on the Tab S9 and
#  the iPhone (dvt graphics on iOS).

set -u
export MSYS_NO_PATHCONV=1          #  Git Bash would rewrite /sdcard paths

HERE="$(cd "$(dirname "$0")" && pwd)"
OS="${1:-}"; SER="${2:--}"; LABEL="${3:-run}"; N="${4:-500}"; SECS="${5:-120}"
LDADB="/c/LDPlayer/LDPlayer14/adb.exe"
UADB="/c/Program Files/Unity/Hub/Editor/6000.5.8f1/Editor/Data/PlaybackEngines/AndroidPlayer/SDK/platform-tools/adb.exe"
OUT="$HERE/bench-results.md"
LOG="$(mktemp)"

case "$OS" in
  android)
    [ "$SER" != "-" ] || { echo "android needs a serial (adb devices)"; exit 1; }
    case "$SER" in emulator-*|127.0.0.1:*) ADB="$LDADB" ;; *) ADB="$UADB" ;; esac
    #  Never the user's own emulator.
    [ "$SER" = "emulator-5556" ] && { echo "emulator-5556 is the user's LDPlayer-1: not touching it"; exit 1; }
    #  The switches live in the data root (android_main.cpp: RanPlat_SetDiagRoot),
    #  not /sdcard/ran.
    DIAG=/sdcard/Android/data/com.ran.native/files
    setflag()   { "$ADB" -s "$SER" shell "printf '%s' '$2' > $DIAG/$1"; }
    clearflag() { "$ADB" -s "$SER" shell "rm -f $DIAG/$1"; }
    record()    { "$ADB" -s "$SER" logcat -c; sleep "$1"; "$ADB" -s "$SER" logcat -d -s RanApp:I RanMain:I > "$LOG"; }
    DEV="$("$ADB" -s "$SER" shell getprop ro.product.model | tr -d '\r')"
    ;;
  ios)
    IOSDEV="$HERE/ios-device.sh"
    setflag()   { "$IOSDEV" flag "$1" "$2" >/dev/null; }
    clearflag() { "$IOSDEV" unflag "$1" >/dev/null 2>&1; }
    record()    { timeout "$1" pymobiledevice3 syslog live --process-name ran > "$LOG" 2>/dev/null; true; }
    DEV="iPhone"
    ;;
  *) sed -n '2,22p' "$0"; exit 1 ;;
esac

echo "bench '$LABEL' on $DEV: $N fakes, loadfx 10, 20 s settle, $SECS s record"
setflag loadtest "$N"
setflag loadfx 10
sleep 20
record "$SECS"
clearflag loadfx
setflag loadtest 0
#  The game reads loadtest once a second and only the last value counts: a
#  following run that writes 500 within that second spawns 500 more on top of
#  the first (1,000 fakes ran LDPlayer out of memory on 2026-10-20).
sleep 3

#  FRAME 28.4 fps | 35.2 ms = update 4.1 + render 30.0 + present 1.1 [of render: swap .., submit .., engine cpu ..]
#  FRAME draws: 3100 per frame, 6 us each
#  FRAME glthread: on | gl busy 24.0 ms/frame, ...
SUM="$(awk '
  /FRAME [0-9.]+ fps/ { for (i=1;i<=NF;i++) if ($(i+1)=="fps") { f=$i+0; fps[n++]=f; s+=f } }
  /FRAME draws:/      { for (i=1;i<=NF;i++) if ($(i+1)=="per") { d+=$i; dn++ } }
  /FRAME gl calls:/   { for (i=1;i<=NF;i++) if ($i ~ /\/frame/) { split($i,a,"/"); g+=a[1]; gn++; break } }
  /gl busy/           { for (i=1;i<=NF;i++) if ($i=="busy") { b+=$(i+1); bn++ } }
  END {
    if (!n) { print "NO FRAME LINES"; exit }
    asort(fps); lo=fps[int(n*0.05)+1]; med=fps[int(n/2)+1]
    printf "fps avg %.1f, median %.1f, 5%% low %.1f (%d s)", s/n, med, lo, n
    if (dn) printf " | draws %.0f/frame", d/dn
    if (gn) printf " | gl calls %.0f/frame", g/gn
    if (bn) printf " | gl thread %.1f ms/frame", b/bn
  }' "$LOG")"

LINE="$(date '+%F %H:%M') | $DEV | $LABEL | $N fakes | $SUM"
echo "$LINE"
[ -f "$OUT" ] || printf '# Crowd bench results\n\nOne line per run of tools/crowd-bench.sh.\n\n' > "$OUT"
echo "- $LINE" >> "$OUT"
rm -f "$LOG"
