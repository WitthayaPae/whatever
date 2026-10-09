//  A sampling profiler for the game thread, for an iPhone with no Mac.
//
//  Instruments needs Xcode. This does what its Time Profiler does, inside the
//  app: a helper thread wakes about every millisecond, pauses the game thread
//  (thread_suspend), reads its registers (thread_get_state), walks the frame
//  pointer chain - arm64 iOS code always keeps frame pointers - and resumes it.
//  Each sample is the pc plus the return addresses up the stack.
//
//  Start: put a file named "sampler" in Documents/ran (tools/ios-device.sh flag
//  sampler [seconds], default 10). When the time is up it writes
//  Documents/ran/samples.bin and deletes "sampler" (a diagnostic must reset
//  itself). Decode with tools/ios-sampler.py, which symbolises against the
//  build's own binary. Nothing here runs unless the file is there.
//
//  While the game thread is paused nothing here may allocate, lock or log: the
//  thread might be holding the malloc lock. The sample buffer is allocated
//  before the first pause.
#include "../../shim/platform/ran_plat.h"
#import <Foundation/Foundation.h>
#include <mach/mach.h>
#include <mach-o/dyld.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

namespace {

const int kMaxDepth = 64;

struct Sampler {
    mach_port_t target = MACH_PORT_NULL;
    uintptr_t   stackLo = 0, stackHi = 0;
    int         seconds = 10;
    //  Flat buffer: [depth, addr0, addr1, ...] per sample.
    uint64_t   *buf = 0;
    size_t      cap = 0, used = 0;
    unsigned    samples = 0, misses = 0;
};

Sampler g_s;
volatile int g_running = 0;

void writeOut () {
    char path[1024];
    snprintf ( path, sizeof(path), "%s", RanPlat_DiagPath ( "samples.bin" ) );
    FILE *f = fopen ( path, "wb" );
    if ( !f ) return;
    //  Header: magic, version, slide of the main executable, sample count, words.
    const uint32_t magic = 0x52534D50, ver = 1;     //  "RSMP"
    const uint64_t slide = (uint64_t) _dyld_get_image_vmaddr_slide ( 0 );
    const uint64_t n = g_s.samples, words = g_s.used;
    fwrite ( &magic, 4, 1, f ); fwrite ( &ver, 4, 1, f );
    fwrite ( &slide, 8, 1, f ); fwrite ( &n, 8, 1, f ); fwrite ( &words, 8, 1, f );
    fwrite ( g_s.buf, 8, g_s.used, f );
    fclose ( f );
    RanPlat_Log ( RANLOG_INFO, "RanSampler", "wrote %u samples (%u missed) to samples.bin, slide 0x%llx",
                  g_s.samples, g_s.misses, (unsigned long long) slide );
}

void *samplerMain ( void * ) {
    pthread_set_qos_class_self_np ( QOS_CLASS_USER_INTERACTIVE, 0 );
    struct timespec t0; clock_gettime ( CLOCK_MONOTONIC, &t0 );
    for ( ;; ) {
        struct timespec now; clock_gettime ( CLOCK_MONOTONIC, &now );
        if ( now.tv_sec - t0.tv_sec >= g_s.seconds ) break;
        if ( g_s.used + kMaxDepth + 2 > g_s.cap ) break;

        if ( thread_suspend ( g_s.target ) != KERN_SUCCESS ) { ++g_s.misses; usleep ( 1000 ); continue; }
        arm_thread_state64_t st;
        mach_msg_type_number_t cnt = ARM_THREAD_STATE64_COUNT;
        if ( thread_get_state ( g_s.target, ARM_THREAD_STATE64, (thread_state_t) &st, &cnt ) == KERN_SUCCESS ) {
            uint64_t *rec = g_s.buf + g_s.used;
            int depth = 0;
            rec[1 + depth++] = (uint64_t) arm_thread_state64_get_pc ( st );
            //  The caller of a leaf that has not pushed a frame yet is only in lr.
            rec[1 + depth++] = (uint64_t) arm_thread_state64_get_lr ( st );
            uintptr_t fp = (uintptr_t) arm_thread_state64_get_fp ( st );
            while ( depth < kMaxDepth && fp >= g_s.stackLo && fp + 16 <= g_s.stackHi && ( fp & 7 ) == 0 ) {
                const uintptr_t next = ( (uintptr_t *) fp )[0];
                const uintptr_t ret  = ( (uintptr_t *) fp )[1];
                if ( !ret ) break;
                rec[1 + depth++] = (uint64_t) ret;
                if ( next <= fp ) break;
                fp = next;
            }
            rec[0] = (uint64_t) depth;
            g_s.used += 1 + depth;
            ++g_s.samples;
        } else {
            ++g_s.misses;
        }
        thread_resume ( g_s.target );
        usleep ( 1000 );
    }
    writeOut ();
    unlink ( RanPlat_DiagPath ( "sampler" ) );
    free ( g_s.buf ); g_s.buf = 0;
    g_running = 0;
    return 0;
}

}   // namespace

//  From the display-link tick, on the game thread. One cached check a frame.
extern "C" void RanSampler_Tick ( void ) {
    if ( g_running || !RanPlat_DiagExists ( "sampler" ) ) return;
    int seconds = 10;
    if ( FILE *f = RanPlat_DiagOpen ( "sampler" ) ) {
        char b[16] = { 0 };
        if ( fread ( b, 1, sizeof(b) - 1, f ) > 0 ) { const int v = atoi ( b ); if ( v >= 1 && v <= 120 ) seconds = v; }
        fclose ( f );
    }
    g_s = Sampler ();
    g_s.seconds = seconds;
    g_s.target = mach_thread_self ();       //  this thread: the game thread
    pthread_t self = pthread_self ();
    g_s.stackHi = (uintptr_t) pthread_get_stackaddr_np ( self );
    g_s.stackLo = g_s.stackHi - (uintptr_t) pthread_get_stacksize_np ( self );
    g_s.cap = (size_t) seconds * 1100 * ( kMaxDepth + 2 );
    g_s.buf = (uint64_t *) malloc ( g_s.cap * sizeof(uint64_t) );
    if ( !g_s.buf ) return;
    g_running = 1;
    pthread_t t;
    if ( pthread_create ( &t, 0, samplerMain, 0 ) != 0 ) { free ( g_s.buf ); g_s.buf = 0; g_running = 0; return; }
    pthread_detach ( t );
    RanPlat_Log ( RANLOG_INFO, "RanSampler", "sampling the game thread for %d s", seconds );
}
