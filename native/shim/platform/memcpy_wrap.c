/*  Profiling only (build.sh WRAPMEMCPY=1): every memcpy our own code calls goes
 *  through here, which a sampling profiler can unwind, so it names the caller.
 *  bionic's memcpy is hand-written assembly the unwinder cannot get out of, so
 *  without this a profile shows "memcpy 40%" and nothing above it. Never in a
 *  shipped build. */
#include <stddef.h>
void *__real_memcpy(void *d, const void *s, size_t n);
__attribute__((noinline, used)) void *__wrap_memcpy(void *d, const void *s, size_t n)
{
    void *r = __real_memcpy(d, s, n);
    __asm__ volatile("" ::: "memory");
    return r;
}
