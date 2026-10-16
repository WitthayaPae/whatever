#!/bin/bash
A="${ADB:-/c/LDPlayer/LDPlayer14/adb.exe}"; D="${D:-127.0.0.1:5555}"
L=$(python -c "import sys;l=open('.login',encoding='utf-8').read().replace('\r','').split('\n');print(l[0]);print(l[1])")
U=$(echo "$L" | sed -n 1p); P=$(echo "$L" | sed -n 2p)
t() { "$A" -s "$D" shell input tap "$1" "$2"; sleep "${3:-1}"; }
clr() { "$A" -s "$D" shell input keyevent KEYCODE_MOVE_END; for i in $(seq 1 24); do "$A" -s "$D" shell input keyevent 67; done; }
t 2640 1288 2                      # close the error box
t 2096 708 1; clr; "$A" -s "$D" shell input text "$U"; sleep 1
t 2096 852 1; clr; "$A" -s "$D" shell input text "$P"; sleep 1
echo typed
