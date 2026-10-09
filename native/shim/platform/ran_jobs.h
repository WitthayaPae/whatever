#pragma once
//  A small persistent worker pool for data-parallel loops (pose workers first:
//  DxSkinChar::MobilePoseBatch). Shared by Android and iOS.
//
//  RanJobs_ParallelFor runs fn(ctx, item, thread) for item in [0, count) and
//  returns when every item is done. The calling thread works too, as thread 0;
//  the pool's threads are 1..RanJobs_ThreadCount()-1. Items are handed out one
//  at a time from a shared counter, so a slow item does not stall the rest.
//  Workers sleep on a condition variable between loops - never a Sleep() poll.
//  Not re-entrant: one loop at a time, started from the game thread.
#ifdef __cplusplus
extern "C" {
#endif

int  RanJobs_ThreadCount ( void );
void RanJobs_ParallelFor ( int count, void (*fn)(void *ctx, int item, int thread), void *ctx );

#ifdef __cplusplus
}
#endif
