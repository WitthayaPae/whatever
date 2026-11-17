//  ===========================================================================
//  RanGuard - signs of cheating on the phone, sent home as reports.
//
//  2026-11-17, the user: "can we track which user is trying to modify the
//  memory, or detect the [SMT] loader or some kind of injection". Players are
//  on phones and emulators only. Chosen: report, do not act - nothing here
//  blocks, kicks or bans; it writes what it saw, who was playing, and sends it
//  to the site the crash reports go to, where a person reads it and decides.
//  A client-side check can be beaten by someone who knows it is there; what it
//  catches is the ready-made tool, and a false hit costs nothing but a line in
//  a list.
//
//  What is looked at, once a minute on its own low-priority thread:
//    Android
//      * code loaded into the game that is neither the system's nor ours
//        (/proc/self/maps): an injector or loader shows up here, and so does a
//        "virtual space" app the game was started inside
//      * names of known tools in the maps and in the thread names (Frida,
//        Xposed / LSPosed, Riru / Zygisk, Substrate, GameGuardian ...)
//      * a debugger attached (TracerPid) - GameGuardian attaches this way
//      * the C library's clock against the kernel's: a speed hack makes the
//        game's clock run fast by hooking the library call; the raw system call
//        cannot be hooked that way
//      * our own code changed in memory (a hash of every page of libran.so)
//    iOS
//      * libraries in the process that are not the system's and not ours (an
//        IPA re-signed with a cheat dylib, iGameGod, H5GG; tweak injection)
//      * a debugger attached (P_TRACED)
//      * mach_absolute_time against the kernel's own clock
//      * our own code changed in memory
//    Both, from the game (GLCharacter.cpp MobileGuardValues)
//      * attack speed, move speed and attack range changed in memory between
//        two of the game's own updates (a memory editor freezing the value)
//  Context only, never a report by itself: root / jailbreak signs (emulators
//  are rooted by default, and players on emulators are welcome).
//
//  The report is text in guard_pending/, uploaded by the platform's crash
//  uploader (RanPlat_UploadCrashReports: Android RanActivity, iOS
//  ran_ios_plat.mm) to crash/upload.php, which files it apart from the crash
//  reports by its first line. One file here, so Android and iOS cannot
//  disagree about what a report says.
//
//  Test the chain: a file named "guardtest" in the diagnostic root gives one
//  report marked "test" at the first check, and is deleted.
//  ===========================================================================
#include "ran_plat.h"

#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <time.h>
#include <unistd.h>
#include <fcntl.h>
#include <dirent.h>
#include <dlfcn.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <sys/resource.h>
#include <vector>
#include <algorithm>
#include <string>

#if defined(__ANDROID__)
#include <sys/syscall.h>
#include <sys/prctl.h>
#elif defined(__APPLE__)
#include <mach-o/dyld.h>
#include <mach-o/getsect.h>
#include <mach/mach_time.h>
#include <sys/sysctl.h>
#include <sys/proc.h>
#endif

namespace {

const int kFirstCheckSec  = 15;     //  after the character is in the world
const int kCheckEverySec  = 60;
const int kMaxReports     = 3;      //  per character per run
const int kMaxFindings    = 40;     //  lines in one report
const float kSpeedTolerance = 0.25f;

pthread_mutex_t g_lock = PTHREAD_MUTEX_INITIALIZER;
volatile unsigned g_userNum = 0, g_charId = 0;
char     g_charName[64] = "";
int      g_started = 0;
char     g_dir[640] = "";               //  guard_pending/, resolved on the game thread
char     g_test[640] = "";              //  the guardtest file
volatile unsigned g_identSerial = 0;    //  bumps when the player changes
std::vector<std::string> g_valueLines;  //  from the game (RanGuard_ReportValue), under g_lock

//  ---- small helpers --------------------------------------------------------

uint32_t Fnv ( const char *s, uint32_t h = 2166136261u )
{
    for ( ; *s; ++s ) h = ( h ^ (unsigned char) *s ) * 16777619u;
    return h;
}

bool HasWord ( const char *s, const char *const *words )
{
    char low[512];
    size_t i = 0;
    for ( ; s[i] && i + 1 < sizeof(low); ++i ) {
        const char c = s[i];
        low[i] = ( c >= 'A' && c <= 'Z' ) ? (char)( c - 'A' + 'a' ) : c;
    }
    low[i] = 0;
    for ( ; *words; ++words )
        if ( strstr ( low, *words ) ) return true;
    return false;
}

bool StartsWith ( const char *s, const char *p ) { return strncmp ( s, p, strlen ( p ) ) == 0; }

//  Tool names. Matched on whole library paths and thread names, lower case.
const char *const kToolWords[] = {
    "frida", "gadget", "gum-js", "linjector", "gmain", "gdbus",
    "xposed", "lsposed", "edxp", "riru", "zygisk", "lspd",
    "substrate", "substitute", "tweakinject", "libhooker", "ellekit", "cydia",
    "gameguardian", "libgg", "igamegod", "h5gg", "speedhack", "cheat",
    "smt", "inject", "hook",
    NULL
};

//  Read a whole small /proc file (maps can be a few hundred KB) without stdio:
//  the shim's fopen goes through the asset resolver.
std::string ReadAll ( const char *path )
{
    std::string s;
    const int fd = open ( path, O_RDONLY | O_CLOEXEC );
    if ( fd < 0 ) return s;
    char buf[16384];
    for ( ;; ) {
        const ssize_t k = read ( fd, buf, sizeof(buf) );
        if ( k <= 0 ) break;
        s.append ( buf, (size_t) k );
        if ( s.size () > 8u * 1024 * 1024 ) break;
    }
    close ( fd );
    return s;
}

struct Findings {
    std::vector<std::string> lines;
    std::string kinds;
    void add ( const char *kind, const std::string &line ) {
        if ( (int) lines.size () >= kMaxFindings ) return;
        lines.push_back ( std::string ( kind ) + ": " + line );
        if ( kinds.find ( kind ) == std::string::npos ) {
            if ( !kinds.empty () ) kinds += ",";
            kinds += kind;
        }
    }
};

//  ---- the clocks -----------------------------------------------------------

struct ClockPair { double hooked, kernel; };

ClockPair ReadClocks ()
{
    ClockPair c = { 0.0, 0.0 };
#if defined(__ANDROID__)
    struct timespec a, b;
    clock_gettime ( CLOCK_MONOTONIC, &a );                          //  the C library (hookable)
    syscall ( __NR_clock_gettime, CLOCK_MONOTONIC, &b );           //  straight to the kernel
    c.hooked = (double) a.tv_sec + a.tv_nsec * 1e-9;
    c.kernel = (double) b.tv_sec + b.tv_nsec * 1e-9;
#elif defined(__APPLE__)
    static mach_timebase_info_data_t tb = { 0, 0 };
    if ( !tb.denom ) mach_timebase_info ( &tb );
    c.hooked = (double) mach_absolute_time () * tb.numer / tb.denom * 1e-9;
    c.kernel = (double) clock_gettime_nsec_np ( CLOCK_UPTIME_RAW ) * 1e-9;
#endif
    return c;
}

ClockPair g_clk0;
int       g_clkSet = 0;
int       g_fastWindows = 0;

void CheckSpeed ( Findings &f )
{
    const ClockPair now = ReadClocks ();
    if ( !g_clkSet ) { g_clk0 = now; g_clkSet = 1; return; }
    const double dk = now.kernel - g_clk0.kernel;
    if ( dk < 20.0 ) return;
    const double dh = now.hooked - g_clk0.hooked;
    g_clk0 = now;
    const double ratio = dh / dk;
    if ( ratio > 1.0 + kSpeedTolerance || ratio < 1.0 - kSpeedTolerance ) {
        //  Two windows in a row, so one odd sample (a suspend in between) is not a report.
        if ( ++g_fastWindows >= 2 ) {
            char b[160];
            snprintf ( b, sizeof(b), "game clock runs x%.2f of the system clock (%.0f s against %.0f s)", ratio, dh, dk );
            f.add ( "speed", b );
        }
    } else {
        g_fastWindows = 0;
    }
}

//  ---- our own code ---------------------------------------------------------

uintptr_t g_codeLo = 0, g_codeHi = 0;
std::vector<uint32_t> g_pageHash;
int g_codeChecked = 0;

uint32_t HashPage ( const unsigned char *p, size_t n )
{
    const uint64_t *w = (const uint64_t *) p;
    uint64_t h = 1469598103934665603ull;
    for ( size_t i = 0; i < n / 8; ++i ) { h ^= w[i]; h = ( h << 7 ) | ( h >> 57 ); h *= 1099511628211ull; }
    return (uint32_t)( h ^ ( h >> 32 ) );
}

void FindCode ()
{
#if defined(__ANDROID__)
    //  The executable mapping that holds this very function.
    const uintptr_t self = (uintptr_t) &FindCode;
    const std::string maps = ReadAll ( "/proc/self/maps" );
    size_t at = 0;
    while ( at < maps.size () ) {
        size_t nl = maps.find ( '\n', at );
        if ( nl == std::string::npos ) nl = maps.size ();
        const std::string line = maps.substr ( at, nl - at );
        at = nl + 1;
        unsigned long lo = 0, hi = 0;
        char perm[8] = "";
        if ( sscanf ( line.c_str (), "%lx-%lx %7s", &lo, &hi, perm ) != 3 ) continue;
        if ( perm[2] != 'x' || self < lo || self >= hi ) continue;
        g_codeLo = lo; g_codeHi = hi;
        break;
    }
#elif defined(__APPLE__)
    Dl_info info;
    if ( dladdr ( (const void *) &FindCode, &info ) && info.dli_fbase ) {
        unsigned long size = 0;
        uint8_t *p = getsectiondata ( (const struct mach_header_64 *) info.dli_fbase, "__TEXT", "__text", &size );
        if ( p && size ) { g_codeLo = (uintptr_t) p; g_codeHi = (uintptr_t) p + size; }
    }
#endif
}

void CheckCode ( Findings &f )
{
    if ( !g_codeChecked ) { g_codeChecked = 1; FindCode (); }
    if ( !g_codeLo || g_codeHi <= g_codeLo ) return;
    const size_t kPage = 4096;
    const size_t pages = ( g_codeHi - g_codeLo ) / kPage;
    if ( g_pageHash.empty () ) {
        g_pageHash.resize ( pages );
        for ( size_t i = 0; i < pages; ++i ) g_pageHash[i] = HashPage ( (const unsigned char *) g_codeLo + i * kPage, kPage );
        RanPlat_Log ( RANLOG_INFO, "RanGuard", "code: %zu pages watched", pages );
        return;
    }
    size_t changed = 0, first = 0;
    for ( size_t i = 0; i < pages; ++i ) {
        const uint32_t h = HashPage ( (const unsigned char *) g_codeLo + i * kPage, kPage );
        if ( h != g_pageHash[i] ) {
            if ( !changed ) first = i;
            ++changed;
            g_pageHash[i] = h;      //  reported once, not every minute after
        }
    }
    if ( changed ) {
        char b[160];
        snprintf ( b, sizeof(b), "%zu page(s) of the game's code changed in memory, first at +0x%zx", changed, first * kPage );
        f.add ( "code", b );
    }
}

//  ---- what is loaded -------------------------------------------------------

#if defined(__ANDROID__)
std::string g_appDir;       //  /data/app/.../com.ran.native-xxx
std::string g_package;

void FindSelf ()
{
    Dl_info info;
    if ( dladdr ( (const void *) &FindSelf, &info ) && info.dli_fname ) {
        std::string p = info.dli_fname;
        size_t cut = p.find ( "/base.apk" );
        if ( cut == std::string::npos ) cut = p.find ( "/lib/" );
        g_appDir = cut != std::string::npos ? p.substr ( 0, cut ) : p.substr ( 0, p.rfind ( '/' ) );
    }
    std::string cmd = ReadAll ( "/proc/self/cmdline" );
    g_package = cmd.c_str ();
    const size_t colon = g_package.find ( ':' );
    if ( colon != std::string::npos ) g_package.resize ( colon );
}

//  Code from these places is the system's (or the WebView / Play services the
//  system hands an app), not something put into the game.
bool SystemPath ( const char *p )
{
    static const char *const kSys[] = {
        "/system/", "/apex/", "/vendor/", "/product/", "/system_ext/", "/odm/",
        "/data/dalvik-cache/", "/data/misc/apexdata/", "/data/misc/shared_relro",
        "/dev/", NULL
    };
    for ( int i = 0; kSys[i]; ++i ) if ( StartsWith ( p, kSys[i] ) ) return true;
    static const char *const kShared[] = {
        "com.google.android.webview", "com.android.webview", "com.android.chrome",
        "com.google.android.trichromelibrary", "com.google.android.gms", "com.huawei.webview",
        NULL
    };
    for ( int i = 0; kShared[i]; ++i ) if ( strstr ( p, kShared[i] ) ) return true;
    return false;
}

void CheckLoaded ( Findings &f )
{
    if ( g_appDir.empty () ) FindSelf ();

    //  Started from inside another app (a "virtual space"): the game's own
    //  library then does not live in the game's own folder.
    if ( !g_package.empty () && g_appDir.find ( g_package ) == std::string::npos )
        f.add ( "container", "the game runs from " + g_appDir + " (package " + g_package + ")" );

    const std::string maps = ReadAll ( "/proc/self/maps" );
    std::vector<std::string> seen;
    size_t at = 0;
    while ( at < maps.size () ) {
        size_t nl = maps.find ( '\n', at );
        if ( nl == std::string::npos ) nl = maps.size ();
        std::string line = maps.substr ( at, nl - at );
        at = nl + 1;
        char perm[8] = "";
        int pathAt = 0;
        unsigned long lo, hi, off;
        char dev[16];
        unsigned long inode;
        if ( sscanf ( line.c_str (), "%lx-%lx %7s %lx %15s %lu %n", &lo, &hi, perm, &off, dev, &inode, &pathAt ) < 6 ) continue;
        if ( pathAt <= 0 || pathAt >= (int) line.size () ) continue;
        const std::string path = line.substr ( pathAt );
        if ( path.empty () ) continue;
        bool dup = false;
        for ( size_t k = 0; k < seen.size () && !dup; ++k ) dup = seen[k] == path;
        if ( dup ) continue;

        const bool exec = perm[2] == 'x';
        //  Tool names count outside the system's folders only: an emulator or a
        //  phone maker ships its own libraries there, and an injector loads
        //  from an app's or a data folder.
        const bool tool = HasWord ( path.c_str (), kToolWords ) && !SystemPath ( path.c_str () ) &&
                          ( g_appDir.empty () || path.find ( g_appDir ) == std::string::npos );
        if ( tool ) {
            seen.push_back ( path );
            f.add ( "inject", path + " (" + perm + ", a known tool's name)" );
            continue;
        }
        if ( !exec ) continue;
        if ( path[0] == '[' ) continue;                                 //  [vdso], [anon:...]
        if ( StartsWith ( path.c_str (), "/memfd:jit" ) || StartsWith ( path.c_str (), "/memfd:/jit" ) ) continue;
        if ( !g_appDir.empty () && StartsWith ( path.c_str (), g_appDir.c_str () ) ) continue;
        if ( SystemPath ( path.c_str () ) ) continue;
        seen.push_back ( path );
        f.add ( "inject", path + " (" + perm + ", code from outside the game and the system)" );
    }

    //  Thread names: Frida's agent runs its own threads inside the game.
    if ( DIR *d = opendir ( "/proc/self/task" ) ) {
        while ( struct dirent *e = readdir ( d ) ) {
            if ( e->d_name[0] == '.' ) continue;
            char p[96];
            snprintf ( p, sizeof(p), "/proc/self/task/%s/comm", e->d_name );
            std::string comm = ReadAll ( p );
            while ( !comm.empty () && ( comm[comm.size () - 1] == '\n' || comm[comm.size () - 1] == 0 ) ) comm.resize ( comm.size () - 1 );
            if ( !comm.empty () && HasWord ( comm.c_str (), kToolWords ) )
                f.add ( "inject", "thread \"" + comm + "\" (a known tool's name)" );
        }
        closedir ( d );
    }
}

void CheckDebugger ( Findings &f )
{
    const std::string st = ReadAll ( "/proc/self/status" );
    const size_t at = st.find ( "TracerPid:" );
    if ( at == std::string::npos ) return;
    const int pid = atoi ( st.c_str () + at + 10 );
    if ( pid <= 0 ) return;
    char p[64];
    snprintf ( p, sizeof(p), "/proc/%d/cmdline", pid );
    const std::string who = ReadAll ( p );
    char b[200];
    snprintf ( b, sizeof(b), "another process is attached to the game (pid %d%s%s)", pid,
               who.empty () ? "" : ", ", who.empty () ? "" : who.c_str () );
    f.add ( "debugger", b );
}

std::string RootInfo ()
{
    static const char *const kSu[] = {
        "/system/bin/su", "/system/xbin/su", "/sbin/su", "/su/bin/su", "/system/sbin/su",
        "/vendor/bin/su", "/system/bin/magisk", "/sbin/.magisk", "/system/app/Superuser.apk", NULL
    };
    std::string r;
    for ( int i = 0; kSu[i]; ++i ) if ( access ( kSu[i], F_OK ) == 0 ) { if ( !r.empty () ) r += ", "; r += kSu[i]; }
    return r.empty () ? "no" : "yes (" + r + ")";
}

#elif defined(__APPLE__)

void CheckLoaded ( Findings &f )
{
    const char *exe = _dyld_get_image_name ( 0 );
    std::string bundle = exe ? exe : "";
    bundle = bundle.substr ( 0, bundle.rfind ( '/' ) );
    const uint32_t n = _dyld_image_count ();
    for ( uint32_t i = 1; i < n; ++i ) {
        const char *name = _dyld_get_image_name ( i );
        if ( !name ) continue;
        const bool tool = HasWord ( name, kToolWords );
        if ( !tool ) {
            if ( StartsWith ( name, "/System/" ) || StartsWith ( name, "/usr/lib/" ) || StartsWith ( name, "/Developer/" ) ) continue;
            //  Swift's runtime, when a build carries it.
            if ( !bundle.empty () && StartsWith ( name, ( bundle + "/Frameworks/libswift" ).c_str () ) ) continue;
        }
        f.add ( "inject", std::string ( name ) + ( tool ? " (a known tool's name)"
                : !bundle.empty () && StartsWith ( name, bundle.c_str () ) ? " (a library added to the app)"
                : " (code from outside the game and the system)" ) );
    }
}

void CheckDebugger ( Findings &f )
{
    struct kinfo_proc info;
    memset ( &info, 0, sizeof(info) );
    int mib[4] = { CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid () };
    size_t size = sizeof(info);
    if ( sysctl ( mib, 4, &info, &size, NULL, 0 ) == 0 && ( info.kp_proc.p_flag & P_TRACED ) )
        f.add ( "debugger", "a debugger is attached to the game" );
}

std::string RootInfo ()
{
    static const char *const kJb[] = {
        "/var/jb", "/Applications/Cydia.app", "/Applications/Sileo.app", "/Applications/Zebra.app",
        "/usr/sbin/sshd", "/bin/bash", "/etc/apt", "/Library/MobileSubstrate", NULL
    };
    std::string r;
    for ( int i = 0; kJb[i]; ++i ) if ( access ( kJb[i], F_OK ) == 0 ) { if ( !r.empty () ) r += ", "; r += kJb[i]; }
    return r.empty () ? "no" : "yes (" + r + ")";
}

#else
void CheckLoaded ( Findings & ) {}
void CheckDebugger ( Findings & ) {}
std::string RootInfo () { return "?"; }
#endif

//  ---- the report -----------------------------------------------------------

std::vector<uint32_t> g_sent;       //  findings already reported for this character
int      g_reports = 0;
unsigned g_reportSerial = 0;        //  the identity the two above belong to

void Send ( const Findings &f, unsigned user, unsigned charId, const char *name )
{
    if ( g_reports >= kMaxReports ) return;

    //  Only what has not been reported for this character yet.
    Findings fresh;
    for ( size_t i = 0; i < f.lines.size (); ++i ) {
        const uint32_t h = Fnv ( f.lines[i].c_str () );
        bool sent = false;
        for ( size_t k = 0; k < g_sent.size () && !sent; ++k ) sent = g_sent[k] == h;
        if ( sent ) continue;
        g_sent.push_back ( h );
        const std::string &l = f.lines[i];
        const size_t colon = l.find ( ':' );
        fresh.add ( l.substr ( 0, colon ).c_str (), l.substr ( colon + 2 ) );
    }
    if ( fresh.lines.empty () ) return;
    ++g_reports;

    std::string t = "RAN LEGACY M guard report\n";
    t += "kind: " + fresh.kinds + "\n";
    char run[1024];
    RanCrash_DescribeRun ( run, sizeof(run) );
    t += run;
#if defined(__ANDROID__)
    t += "package: " + g_package + "\n";
#endif
    char b[256];
    snprintf ( b, sizeof(b), "user: %u\nchar: %u\nname: %s\n", user, charId, name );
    t += b;
    const time_t now = time ( NULL );
    struct tm tm;
    char ts[32] = "";
    if ( localtime_r ( &now, &tm ) ) strftime ( ts, sizeof(ts), "%Y-%m-%d %H:%M:%S", &tm );
    t += std::string ( "seen: " ) + ts + "\n";
    t += "root: " + RootInfo () + "\n";
    t += "\n--- findings ---\n";
    for ( size_t i = 0; i < fresh.lines.size (); ++i ) t += fresh.lines[i] + "\n";

    for ( size_t i = 0; i < fresh.lines.size (); ++i )
        RanPlat_Log ( RANLOG_WARN, "RanGuard", "%s", fresh.lines[i].c_str () );

    mkdir ( g_dir, 0770 );
    chmod ( g_dir, 0770 );
    //  Ten at most waiting: a phone that never reaches the site keeps the newest.
    {
        std::vector<std::string> names;
        if ( DIR *d = opendir ( g_dir ) ) {
            while ( struct dirent *e = readdir ( d ) ) if ( e->d_name[0] != '.' ) names.push_back ( e->d_name );
            closedir ( d );
        }
        std::sort ( names.begin (), names.end () );
        for ( size_t i = 0; i + 9 < names.size (); ++i ) unlink ( ( std::string ( g_dir ) + "/" + names[i] ).c_str () );
    }
    char path[720];
    snprintf ( path, sizeof(path), "%s/%lld_%u_%d.txt", g_dir, (long long) now, charId, g_reports );
    const int fd = open ( path, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0664 );
    if ( fd < 0 ) return;
    fchmod ( fd, 0664 );
    size_t off = 0;
    while ( off < t.size () ) {
        const ssize_t w = write ( fd, t.data () + off, t.size () - off );
        if ( w <= 0 ) break;
        off += (size_t) w;
    }
    close ( fd );
    RanPlat_UploadCrashReports ( g_dir );
}

void CheckOnce ()
{
    pthread_mutex_lock ( &g_lock );
    const unsigned user = g_userNum, charId = g_charId, serial = g_identSerial;
    char name[64];
    snprintf ( name, sizeof(name), "%s", g_charName );
    pthread_mutex_unlock ( &g_lock );

    if ( serial != g_reportSerial ) { g_reportSerial = serial; g_sent.clear (); g_reports = 0; }

    Findings f;
    if ( access ( g_test, F_OK ) == 0 ) {
        unlink ( g_test );
        f.add ( "test", "guardtest file - a test of the report chain, not a cheat" );
    }
    {
        pthread_mutex_lock ( &g_lock );
        for ( size_t i = 0; i < g_valueLines.size (); ++i ) f.add ( "value", g_valueLines[i] );
        g_valueLines.clear ();
        pthread_mutex_unlock ( &g_lock );
    }
    CheckLoaded ( f );
    CheckDebugger ( f );
    CheckSpeed ( f );
    CheckCode ( f );

    if ( f.lines.empty () ) {
        static int s_quiet = 0;
        if ( !s_quiet++ ) RanPlat_Log ( RANLOG_INFO, "RanGuard", "first check: nothing found (root: %s)", RootInfo ().c_str () );
        return;
    }
    Send ( f, user, charId, name );
}

void *GuardThread ( void * )
{
#if defined(__ANDROID__)
    prctl ( PR_SET_NAME, "RanGuardChk", 0, 0, 0 );
    setpriority ( PRIO_PROCESS, 0, 10 );
#elif defined(__APPLE__)
    pthread_setname_np ( "RanGuardChk" );
#endif
    sleep ( kFirstCheckSec );
    for ( ;; ) {
        CheckOnce ();
        sleep ( kCheckEverySec );
    }
    return NULL;
}

}   //  namespace

//  A value the game itself saw changed in memory (attack speed, move speed,
//  range: GLCharacter.cpp MobileGuardValues). Goes out with the next check.
extern "C" void RanGuard_ReportValue ( const char *line )
{
    if ( !line || !*line ) return;
    pthread_mutex_lock ( &g_lock );
    if ( g_valueLines.size () < 8 ) g_valueLines.push_back ( line );
    pthread_mutex_unlock ( &g_lock );
}

extern "C" void RanGuard_SetPlayer ( unsigned int userNum, unsigned int charId, const char *charName )
{
    //  Every frame from the game thread: nothing to do unless the player changed.
    if ( charId == g_charId && userNum == g_userNum && g_started ) return;
    //  A named character: the game stage only calls this in the world. Not the
    //  id - RAN EMU's test characters carry id 0 (live ones never do).
    if ( !charName || !*charName ) return;

    pthread_mutex_lock ( &g_lock );
    g_userNum = userNum;
    g_charId  = charId;
    snprintf ( g_charName, sizeof(g_charName), "%s", charName ? charName : "" );
    ++g_identSerial;
    pthread_mutex_unlock ( &g_lock );

    if ( g_started ) return;
    g_started = 1;
    //  Paths on this thread: RanPlat_DiagPath hands back one shared buffer.
    snprintf ( g_dir, sizeof(g_dir), "%s", RanPlat_DiagPath ( "guard_pending" ) );
    snprintf ( g_test, sizeof(g_test), "%s", RanPlat_DiagPath ( "guardtest" ) );
    //  Reports a previous run could not send go now.
    RanPlat_UploadCrashReports ( g_dir );

    pthread_t th;
    pthread_attr_t at;
    pthread_attr_init ( &at );
    pthread_attr_setdetachstate ( &at, PTHREAD_CREATE_DETACHED );
    if ( pthread_create ( &th, &at, GuardThread, NULL ) != 0 )
        RanPlat_Log ( RANLOG_WARN, "RanGuard", "could not start the check thread" );
    else
        RanPlat_Log ( RANLOG_INFO, "RanGuard", "watching (user %u, char %u)", userNum, charId );
    pthread_attr_destroy ( &at );
}
