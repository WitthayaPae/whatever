"""Copy the launcher sources for the Google Play build, without the APK self-update.

    python store-java.py <java src dir> <out dir>

Play forbids an app updating itself outside Play, and its scanner reads the dex,
not the run-time isStore() test: the install-result receiver (an Intent taken
from a broadcast and handed to startActivity) was reported as "Intent
Redirection" on 2026-10-12 although the store build never reaches it. So the
store build is compiled from a copy with offerApk()/commitInstall() cut out and
a stub left in their place. build-apk.sh then checks the dex really is clean.

Fails loudly if the anchors moved: a silent miss ships the code again.
"""
import os, shutil, sys

BEGIN = "    private boolean offerApk(JSONObject apk, int myApk) throws Exception {\n"
END = "    private static String hex(byte[] b) {\n"
STUB = (
    "    /*  Store build: no APK self-update code (cut by store-java.py). */\n"
    "    private boolean offerApk(JSONObject apk, int myApk) { return false; }\n"
    "\n"
)

src, out = sys.argv[1], sys.argv[2]
if os.path.isdir(out):
    shutil.rmtree(out)
shutil.copytree(src, out)

p = os.path.join(out, "com", "ran", "launcher", "RanLauncher.java")
raw = open(p, "rb").read()
nl = b"\r\n" if b"\r\n" in raw else b"\n"
s = raw.decode("utf-8").replace("\r\n", "\n")

if s.count(BEGIN) != 1 or s.count(END) != 1:
    sys.exit("[!] store-java: anchors not found exactly once (offerApk %d, hex %d)"
             % (s.count(BEGIN), s.count(END)))
a, b = s.index(BEGIN), s.index(END)
if a >= b:
    sys.exit("[!] store-java: offerApk is not above hex()")

cut = s[a:b]
for must in ("PackageInstaller", "Intent.EXTRA_INTENT", "commitInstall"):
    if must not in cut:
        sys.exit("[!] store-java: the cut region no longer holds %s" % must)

s = s[:a] + STUB + s[b:]
for gone in ("getPackageInstaller", "Intent.EXTRA_INTENT", "commitInstall(",
             "ACTION_MANAGE_UNKNOWN_APP_SOURCES"):
    if gone in s:
        sys.exit("[!] store-java: %s is still in the store source" % gone)

data = s.replace("\n", nl.decode()).encode("utf-8")
open(p, "wb").write(data)
print("  store java: cut %d lines of APK self-update" % cut.count("\n"))
