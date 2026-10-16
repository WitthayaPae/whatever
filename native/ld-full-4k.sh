#!/bin/bash
# Restart the client on LDPlayer (4K) and walk into the world. Test rig only.
A=/c/LDPlayer/LDPlayer14/adb.exe; D="${D:-127.0.0.1:5555}"; HERE="$(cd "$(dirname "$0")" && pwd)"
t() { "$A" -s "$D" shell input tap "$1" "$2"; sleep "${3:-1}"; }
"$A" -s "$D" shell am force-stop com.ran.native; sleep 3; "$A" -s "$D" logcat -c
"$A" -s "$D" shell am start -n com.ran.native/com.ran.launcher.RanLauncher >/dev/null
for i in $(seq 1 60); do "$A" -s "$D" logcat -d | grep -q "=== boot complete ===" && break; sleep 4; done
sleep 15
t 1776 960 3; t 3160 960 2; t 3460 1672 10      # server, channel, connect
D="$D" "$HERE/ld-relogin-4k.sh" >/dev/null
t 1632 1288 14                                   # OK
t 3160 560 3; t 3488 1320 30                     # character, start
echo in-world
