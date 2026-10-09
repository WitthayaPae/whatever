//  See gl_thread.h.
#include "gl_thread.h"
#include "gl_platform.h"
#include "../platform/ran_plat.h"

#include <pthread.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <vector>
#include <deque>
#ifdef __APPLE__
#include <pthread/qos.h>
#endif

#define LOGI(...) RanPlat_Log(RANLOG_INFO,  "RanGLT", __VA_ARGS__)
#define LOGW(...) RanPlat_Log(RANLOG_WARN,  "RanGLT", __VA_ARGS__)

void RanGLT_InitShadows(void);     //  gl_thunks.cpp

volatile int g_ranGLTOn = 0;
pthread_t    g_ranGLTThread;

namespace {

double nowSeconds() {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec + (double)ts.tv_nsec * 1e-9;
}

//  A command: a 16-byte header, then its arguments, then any payload, the
//  whole rounded to 16 so the next header is aligned for anything.
struct Hdr { uint32_t total; uint32_t pad; void (*exec)(void *); };
static_assert(sizeof(Hdr) == 16, "command header must stay 16 bytes");

inline unsigned round16(unsigned n) { return (n + 15u) & ~15u; }

struct Block {
    unsigned char *data;
    size_t cap, used;
};

const size_t kBlockBytes = 1u << 20;

pthread_mutex_t g_lock = PTHREAD_MUTEX_INITIALIZER;
pthread_cond_t  g_wakeGL = PTHREAD_COND_INITIALIZER;    //  a block is ready
pthread_cond_t  g_wakeProducer = PTHREAD_COND_INITIALIZER;
std::deque<Block *> g_ready;
std::vector<Block *> g_free;
Block *g_cur = 0;                   //  the producer's block (producer only)
bool g_threadStarted = false;
pthread_t g_producer;

//  Frames handed over and frames the GL thread has finished, under g_lock.
unsigned long g_sentFrames = 0, g_doneFrames = 0;

//  Stats, reset by RanGLT_TakeStats.
unsigned long g_statSyncs = 0, g_statBytes = 0, g_statFrames = 0;
double g_statWaited = 0.0;
double g_glBusy = 0.0;              //  under g_lock

Block *takeBlock(size_t need) {
    Block *b = 0;
    if (need <= kBlockBytes) {
        pthread_mutex_lock(&g_lock);
        if (!g_free.empty()) { b = g_free.back(); g_free.pop_back(); }
        pthread_mutex_unlock(&g_lock);
    }
    if (!b) {
        b = new Block;
        b->cap = need > kBlockBytes ? need : kBlockBytes;
        //  16-aligned so every header and argument block is.
        void *mem = 0;
        if (posix_memalign(&mem, 16, b->cap) != 0) mem = malloc(b->cap);
        b->data = (unsigned char *)mem;
    }
    b->used = 0;
    return b;
}

//  Hand the producer's block to the GL thread (if it holds anything).
void publish() {
    if (!g_cur || !g_cur->used) return;
    g_statBytes += g_cur->used;
    pthread_mutex_lock(&g_lock);
    g_ready.push_back(g_cur);
    pthread_cond_signal(&g_wakeGL);
    pthread_mutex_unlock(&g_lock);
    g_cur = 0;
}

void *alloc(unsigned argBytes, unsigned payloadBytes, void (*exec)(void *), void **payload) {
    const unsigned args = round16(argBytes);
    const unsigned total = (unsigned)sizeof(Hdr) + args + round16(payloadBytes);
    if (g_cur && g_cur->used + total > g_cur->cap) publish();
    if (!g_cur) g_cur = takeBlock(total);
    Hdr *h = (Hdr *)(g_cur->data + g_cur->used);
    h->total = total; h->pad = 0; h->exec = exec;
    unsigned char *a = (unsigned char *)(h + 1);
    if (payload) *payload = a + args;
    g_cur->used += total;
    return a;
}

void *glThreadMain(void *) {
#ifdef __APPLE__
    pthread_set_qos_class_self_np(QOS_CLASS_USER_INTERACTIVE, 0);
    pthread_setname_np("RanGL");
#else
    pthread_setname_np(pthread_self(), "RanGL");
#endif
    for (;;) {
        pthread_mutex_lock(&g_lock);
        while (g_ready.empty()) pthread_cond_wait(&g_wakeGL, &g_lock);
        Block *b = g_ready.front();
        g_ready.pop_front();
        pthread_mutex_unlock(&g_lock);

        const double t0 = nowSeconds();
        unsigned char *p = b->data, *end = b->data + b->used;
        while (p < end) {
            Hdr *h = (Hdr *)p;
            h->exec(h + 1);
            p += h->total;
        }
        const double dt = nowSeconds() - t0;

        pthread_mutex_lock(&g_lock);
        g_glBusy += dt;
        if (b->cap == kBlockBytes && g_free.size() < 16) g_free.push_back(b);
        else { free(b->data); delete b; }
        pthread_mutex_unlock(&g_lock);
    }
    return 0;
}

void startThread() {
    if (g_threadStarted) return;
    pthread_attr_t attr;
    pthread_attr_init(&attr);
    //  The driver's own frames go deep on some GPUs; be generous.
    pthread_attr_setstacksize(&attr, 1 << 20);
    pthread_t t;
    if (pthread_create(&t, &attr, glThreadMain, 0) == 0) {
        g_ranGLTThread = t;
        g_threadStarted = true;
        pthread_detach(t);
    }
    pthread_attr_destroy(&attr);
}

//  ---- markers executed on the GL thread
struct SyncArgs { void (*fn)(void *); void *ctx; volatile int *done; };
void execSync(void *p) {
    SyncArgs *a = (SyncArgs *)p;
    if (a->fn) a->fn(a->ctx);
    pthread_mutex_lock(&g_lock);
    *a->done = 1;
    pthread_cond_broadcast(&g_wakeProducer);
    pthread_mutex_unlock(&g_lock);
}

void execFrameDone(void *) {
    pthread_mutex_lock(&g_lock);
    ++g_doneFrames;
    pthread_cond_broadcast(&g_wakeProducer);
    pthread_mutex_unlock(&g_lock);
}

//  ---- names generated ahead
//  The producer takes from `pool`; when it runs low it queues a closure that
//  generates a batch into `incoming`, which arrives a frame later. Only if the
//  pool is empty AND nothing has arrived does it wait (one sync).
struct NamePool {
    std::vector<GLuint> pool;               //  producer only
    std::vector<GLuint> incoming;           //  under g_lock
    bool requested = false;                 //  producer only
};
NamePool g_names[5];
const int kNameBatch = 256;

void genBatch(int kind, GLuint *out, int n) {
    switch (kind) {
        case 0: glGenTextures(n, out); break;
        case 1: glGenBuffers(n, out); break;
        case 2: glGenVertexArrays(n, out); break;
        case 3: glGenFramebuffers(n, out); break;
        default: glGenRenderbuffers(n, out); break;
    }
}

struct GenArgs { int kind; };
void execGenBatch(void *p) {
    const int kind = ((GenArgs *)p)->kind;
    GLuint names[kNameBatch];
    genBatch(kind, names, kNameBatch);
    pthread_mutex_lock(&g_lock);
    g_names[kind].incoming.insert(g_names[kind].incoming.end(), names, names + kNameBatch);
    pthread_mutex_unlock(&g_lock);
}

void requestBatch(int kind) {
    NamePool &np = g_names[kind];
    if (np.requested) return;
    GenArgs *a = (GenArgs *)RanGLT_Cmd(sizeof(GenArgs), execGenBatch);
    if (!a) return;
    a->kind = kind;
    np.requested = true;
}

void takeIncoming(int kind) {
    NamePool &np = g_names[kind];
    pthread_mutex_lock(&g_lock);
    if (!np.incoming.empty()) {
        np.pool.insert(np.pool.end(), np.incoming.begin(), np.incoming.end());
        np.incoming.clear();
        np.requested = false;
    }
    pthread_mutex_unlock(&g_lock);
}

bool wantedNow() {
    //  Opt-in while it is being proven; "noglthread" always wins.
    if (RanPlat_DiagExists("noglthread")) return false;
    return RanPlat_DiagExists("glthread") != 0;
}

}  // namespace

extern "C" void *RanGLT_Cmd(unsigned argBytes, void (*exec)(void *)) {
    if (!pthread_equal(pthread_self(), g_producer)) {
        static int said = 0;
        if (!said) { said = 1; LOGW("GL call from a thread that is not recording - dropped"); }
        return 0;
    }
    return alloc(argBytes, 0, exec, 0);
}

extern "C" void *RanGLT_CmdPayload(unsigned argBytes, unsigned payloadBytes,
                                   void (*exec)(void *), void **payload) {
    if (!pthread_equal(pthread_self(), g_producer)) {
        static int said = 0;
        if (!said) { said = 1; LOGW("GL call from a thread that is not recording - dropped"); }
        return 0;
    }
    return alloc(argBytes, payloadBytes, exec, payload);
}

extern "C" void RanGLT_RunSyncFn(void (*fn)(void *), void *ctx) {
    if (RanGLT_Direct()) { if (fn) fn(ctx); return; }
    volatile int done = 0;
    SyncArgs *a = (SyncArgs *)RanGLT_Cmd(sizeof(SyncArgs), execSync);
    if (!a) return;
    a->fn = fn; a->ctx = ctx; a->done = &done;
    ++g_statSyncs;
    publish();
    const double t0 = nowSeconds();
    pthread_mutex_lock(&g_lock);
    while (!done) pthread_cond_wait(&g_wakeProducer, &g_lock);
    pthread_mutex_unlock(&g_lock);
    g_statWaited += nowSeconds() - t0;
}

extern "C" void RanGLT_NoteSync(void) { ++g_statSyncs; }

extern "C" void RanGLT_FrameEnd(double *waited) {
    if (!g_ranGLTOn) return;
    RanGLT_Cmd(0, execFrameDone);
    publish();
    ++g_statFrames;
    const double t0 = nowSeconds();
    pthread_mutex_lock(&g_lock);
    ++g_sentFrames;
    //  One frame may be executing while the next is recorded; no more, or the
    //  picture lags the input and the queue grows without bound.
    while (g_sentFrames - g_doneFrames > 1) pthread_cond_wait(&g_wakeProducer, &g_lock);
    pthread_mutex_unlock(&g_lock);
    const double dt = nowSeconds() - t0;
    g_statWaited += dt;
    if (waited) *waited += dt;

    //  Name batches that arrived while the frame ran.
    for (int k = 0; k < 5; ++k) if (g_names[k].requested) takeIncoming(k);

    //  Re-read the switch once a second (the diag lookup is cached that long).
    static double s_lastCheck = 0.0;
    const double now = t0 + dt;
    if (now - s_lastCheck > 1.0) {
        s_lastCheck = now;
        if (!wantedNow()) { LOGI("switched off"); RanGLT_Stop(); }
    }
}

extern "C" unsigned RanGLT_GenName(int kind) {
    if (kind < 0 || kind > 4) return 0;
    NamePool &np = g_names[kind];
    if (np.pool.empty()) takeIncoming(kind);
    if (np.pool.empty()) {
        //  Nothing arrived in time: make a batch now and wait for it.
        GLuint names[kNameBatch];
        struct Ctx { int kind; GLuint *out; } c = { kind, names };
        RanGLT_RunSyncFn([](void *p) { Ctx *c = (Ctx *)p; genBatch(c->kind, c->out, kNameBatch); }, &c);
        np.pool.insert(np.pool.end(), names, names + kNameBatch);
    }
    const GLuint n = np.pool.back();
    np.pool.pop_back();
    if (np.pool.size() < kNameBatch / 2) requestBatch(kind);
    return n;
}

extern "C" void RanGLT_MaybeStart(void) {
    if (g_ranGLTOn) return;
    static double s_lastCheck = 0.0;
    const double now = nowSeconds();
    if (now - s_lastCheck < 1.0) return;
    s_lastCheck = now;
    if (!wantedNow()) return;

    startThread();
    if (!g_threadStarted) return;
    //  The context moves: off this thread, onto the GL thread as the first
    //  thing it does. Nothing can be queued in between - this thread is the
    //  only producer and it is here.
    RanGL_PlatMakeCurrent(0);
    g_producer = pthread_self();
    pthread_mutex_lock(&g_lock);
    g_sentFrames = g_doneFrames = 0;
    pthread_mutex_unlock(&g_lock);
    __atomic_store_n(&g_ranGLTOn, 1, __ATOMIC_SEQ_CST);
    int ok = 0;
    RanGLT_RunSyncFn([](void *p) { *(int *)p = RanGL_PlatMakeCurrent(1); }, &ok);
    if (!ok) {
        LOGW("could not move the context to the GL thread - staying direct");
        __atomic_store_n(&g_ranGLTOn, 0, __ATOMIC_SEQ_CST);
        RanGL_PlatMakeCurrent(1);
        return;
    }
    RanGLT_InitShadows();
    LOGI("GL thread on");
}

extern "C" void RanGLT_Stop(void) {
    if (!g_ranGLTOn) return;
    if (pthread_equal(pthread_self(), g_ranGLTThread)) return;      //  never from inside
    RanGLT_RunSyncFn([](void *) { glFinish(); RanGL_PlatMakeCurrent(0); }, 0);
    __atomic_store_n(&g_ranGLTOn, 0, __ATOMIC_SEQ_CST);
    RanGL_PlatMakeCurrent(1);
    //  Names still in the pools stay valid and are used next time.
    for (int k = 0; k < 5; ++k) g_names[k].requested = false;
    LOGI("GL thread off (context back on the calling thread)");
}

extern "C" void RanGLT_TakeStats(unsigned long *syncs, unsigned long *bytes, double *glBusy,
                                 double *waited, unsigned long *frames) {
    if (syncs) *syncs = g_statSyncs;
    if (bytes) *bytes = g_statBytes;
    if (waited) *waited = g_statWaited;
    if (frames) *frames = g_statFrames;
    pthread_mutex_lock(&g_lock);
    if (glBusy) *glBusy = g_glBusy;
    g_glBusy = 0.0;
    pthread_mutex_unlock(&g_lock);
    g_statSyncs = g_statBytes = g_statFrames = 0;
    g_statWaited = 0.0;
}
