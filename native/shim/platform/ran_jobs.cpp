//  See ran_jobs.h.
#include "ran_jobs.h"
#include "ran_plat.h"
#include <pthread.h>
#include <unistd.h>
#ifdef __APPLE__
#include <pthread/qos.h>
#endif

namespace {

//  The phone's cores less the game thread and the GL/driver work it causes,
//  at most 4 helpers: a pose loop is a few milliseconds, and more threads than
//  that only add wake-up cost. iPhone 15 (6 cores) -> 4, LDPlayer (4) -> 2.
int pickHelpers () {
    long n = sysconf ( _SC_NPROCESSORS_ONLN );
    long h = n - 2;
    if ( h < 1 ) h = 1;
    if ( h > 4 ) h = 4;
    return (int) h;
}

struct Pool {
    pthread_mutex_t lock;
    pthread_cond_t  wake;       //  a new loop is ready
    pthread_cond_t  done;       //  the last helper finished its share
    int             helpers = 0;
    unsigned        generation = 0;
    int             busy = 0;   //  helpers still inside the current loop
    //  the current loop
    int             count = 0;
    volatile int    next = 0;   //  claimed with __sync_fetch_and_add
    void          (*fn)(void *, int, int) = 0;
    void           *ctx = 0;
};

Pool g_pool;
bool g_started = false;

void runShare ( int thread ) {
    for ( ;; ) {
        const int i = __sync_fetch_and_add ( &g_pool.next, 1 );
        if ( i >= g_pool.count ) break;
        g_pool.fn ( g_pool.ctx, i, thread );
    }
}

void *helperMain ( void *arg ) {
    const int thread = (int)(long) arg;
#ifdef __APPLE__
    //  The game loop's own class: a pose loop sits inside the frame, so a
    //  helper at a lower class would make the frame wait for it.
    pthread_set_qos_class_self_np ( QOS_CLASS_USER_INTERACTIVE, 0 );
    pthread_setname_np ( "RanPose" );
#else
    pthread_setname_np ( pthread_self (), "RanPose" );
#endif
    unsigned seen = 0;
    for ( ;; ) {
        pthread_mutex_lock ( &g_pool.lock );
        while ( g_pool.generation == seen ) pthread_cond_wait ( &g_pool.wake, &g_pool.lock );
        seen = g_pool.generation;
        pthread_mutex_unlock ( &g_pool.lock );

        runShare ( thread );

        pthread_mutex_lock ( &g_pool.lock );
        if ( --g_pool.busy == 0 ) pthread_cond_signal ( &g_pool.done );
        pthread_mutex_unlock ( &g_pool.lock );
    }
    return 0;
}

void start () {
    if ( g_started ) return;
    g_started = true;
    pthread_mutex_init ( &g_pool.lock, 0 );
    pthread_cond_init ( &g_pool.wake, 0 );
    pthread_cond_init ( &g_pool.done, 0 );
    const int want = pickHelpers ();
    for ( int i = 0; i < want; ++i ) {
        pthread_t t;
        if ( pthread_create ( &t, 0, helperMain, (void *)(long)( g_pool.helpers + 1 ) ) == 0 ) {
            pthread_detach ( t );
            ++g_pool.helpers;
        }
    }
    RanPlat_Log ( RANLOG_INFO, "RanJobs", "pool: %d helper thread(s) + the game thread (%ld cores online)",
                  g_pool.helpers, sysconf ( _SC_NPROCESSORS_ONLN ) );
}

}   // namespace

extern "C" int RanJobs_ThreadCount ( void ) {
    start ();
    return g_pool.helpers + 1;
}

extern "C" void RanJobs_ParallelFor ( int count, void (*fn)(void *, int, int), void *ctx ) {
    if ( count <= 0 || !fn ) return;
    start ();
    if ( g_pool.helpers == 0 || count == 1 ) {
        for ( int i = 0; i < count; ++i ) fn ( ctx, i, 0 );
        return;
    }
    pthread_mutex_lock ( &g_pool.lock );
    g_pool.count = count;
    g_pool.next  = 0;
    g_pool.fn    = fn;
    g_pool.ctx   = ctx;
    g_pool.busy  = g_pool.helpers;
    ++g_pool.generation;
    pthread_cond_broadcast ( &g_pool.wake );
    pthread_mutex_unlock ( &g_pool.lock );

    runShare ( 0 );

    pthread_mutex_lock ( &g_pool.lock );
    while ( g_pool.busy > 0 ) pthread_cond_wait ( &g_pool.done, &g_pool.lock );
    pthread_mutex_unlock ( &g_pool.lock );
}
