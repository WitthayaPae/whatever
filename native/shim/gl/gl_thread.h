//  GL on its own thread ("GLT").
//
//  The game thread used to make every GL call itself. On an iPhone 15 in a
//  250-player crowd that was most of the frame: with every GL call dropped
//  (`nulldraw`) the same scene held 60 fps, against 25-31 with them, and
//  halving the GPU's work moved it 1.5 fps - the calls cost CPU on the calling
//  thread, not GPU time (STATUS 2026-10-10).
//
//  So while the game runs, the context lives on a thread of its own and the
//  game thread only RECORDS what it would have called: gl_thunks.h turns each
//  gl* call in the renderer, the touch HUD and the splash into a few bytes in a
//  command queue, and this thread replays them in the same order. One frame may
//  be in flight: the game records frame N+1 while frame N is executed.
//
//  What cannot be recorded is anything that answers: glGet*, glCreate*, a
//  status check, a mapped pointer. Those run on the GL thread while the caller
//  waits (RanGLT_RunSync), which drains the queue first - correct but slow, so
//  the ones that happen every frame are answered without asking GL (shadow
//  state in gl_thunks.h, names generated ahead in batches) and the counter in
//  the FRAME report says how many still happen.
//
//  It is only on during the ordinary game loop on the main thread. The loading
//  screen's thread, a lost or resized surface, the app going to the background
//  and shutdown all stop it first - the queue is drained and the context comes
//  back to the main thread - so those paths run exactly as they always did.
//  "noglthread" keeps it off (and turns it off within a second); it is the A/B
//  switch.
#pragma once
#include <pthread.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

//  Non-zero while commands are being queued.
extern volatile int g_ranGLTOn;
extern pthread_t    g_ranGLTThread;

//  True when a gl* call must be made directly: the thread is off, or this IS
//  the GL thread (a RanGLT_RunSync body, or a queued closure).
static inline int RanGLT_Direct(void) {
    return !g_ranGLTOn || pthread_equal(pthread_self(), g_ranGLTThread);
}

//  Room for one command's arguments (and optionally a payload copied after
//  them), run later on the GL thread as exec(args). NULL when the calling
//  thread is not the one allowed to issue GL - the call is dropped, as a GL
//  call from a thread without the context always was.
void *RanGLT_Cmd(unsigned argBytes, void (*exec)(void *args));
void *RanGLT_CmdPayload(unsigned argBytes, unsigned payloadBytes,
                        void (*exec)(void *args), void **payload);

//  Run fn(ctx) on the GL thread after everything queued so far, and wait.
void RanGLT_RunSyncFn(void (*fn)(void *), void *ctx);

//  The frame is recorded: hand it over, and wait while the GL thread is more
//  than a frame behind. Seconds waited are added to *waited.
void RanGLT_FrameEnd(double *waited);

//  Called at the end of a main-thread Present: starts the thread when it is
//  wanted and the main thread holds the context with a surface.
void RanGLT_MaybeStart(void);
//  Drain everything, give the context back to the calling thread. Must be
//  called from the producer (the main thread) or with the producer stopped.
void RanGLT_Stop(void);

//  Name generation ahead of need: kind 0 textures, 1 buffers, 2 vertex arrays,
//  3 framebuffers, 4 renderbuffers.
unsigned RanGLT_GenName(int kind);

//  Bookkeeping for the FRAME report.
void RanGLT_NoteSync(void);
void RanGLT_TakeStats(unsigned long *syncs, unsigned long *bytes, double *glBusy,
                      double *waited, unsigned long *frames);

//  "glprof": the GL thread times every command and logs the most expensive
//  every two seconds, named on the device (dladdr). Commands queued by
//  RanGLT_Call carry a tag naming the GL function, because their closure is
//  shared by every function of the same signature; the rest are named by
//  their closure. Set by the producer once a second.
extern volatile int g_ranGLTProf;
unsigned RanGLT_TagFor(const void *fn);
//  The header's spare word, just before the arguments (see Hdr in gl_thread.cpp).
static inline void RanGLT_TagCmd(void *args, unsigned tag) { ((uint32_t *)args)[-3] = tag; }

//  Platform: make the context current (1) or not (0) on the calling thread.
//  gl_context.cpp / gl_context_ios.mm.
int  RanGL_PlatMakeCurrent(int on);

#ifdef __cplusplus
}

#include <new>
#include <string.h>
#include <type_traits>
#include <utility>

//  A closure queued for the GL thread. F is copied into the queue and must not
//  hold references to anything the caller will change or free.
template <class F> struct RanGLTClosure {
    static void run(void *p) { F *f = (F *)p; (*f)(); f->~F(); }
};
template <class F> inline bool RanGLT_Post(F f) {
    void *p = RanGLT_Cmd((unsigned)sizeof(F), &RanGLTClosure<F>::run);
    if (!p) return false;
    new (p) F(std::move(f));
    return true;
}
//  The same with a copy of `bytes` bytes of `data` that the closure reads
//  through its argument.
template <class F> struct RanGLTClosureP {
    F f; const void *payload;
    static void run(void *p) { RanGLTClosureP *c = (RanGLTClosureP *)p; c->f(c->payload); c->~RanGLTClosureP(); }
};
template <class F> inline bool RanGLT_PostData(const void *data, unsigned bytes, F f) {
    void *pl = 0;
    void *p = RanGLT_CmdPayload((unsigned)sizeof(RanGLTClosureP<F>), bytes,
                                &RanGLTClosureP<F>::run, &pl);
    if (!p) return false;
    if (bytes) memcpy(pl, data, bytes);
    RanGLTClosureP<F> *c = new (p) RanGLTClosureP<F>{ std::move(f), pl };
    (void)c;
    return true;
}

//  Run f on the GL thread now and wait. Direct when already there or off.
template <class F> inline void RanGLT_RunSync(F &&f) {
    if (RanGLT_Direct()) { f(); return; }
    struct T { static void run(void *p) { (*(typename std::remove_reference<F>::type *)p)(); } };
    RanGLT_RunSyncFn(&T::run, (void *)&f);
}
#endif
