//  iOS's half of the audio: an AudioQueue that asks the mixer for frames.
//  The exact counterpart of audio_opensl.cpp, and the only iOS-specific part of
//  the sound system - everything above it is portable.
//
//  AudioQueue rather than AVAudioEngine or a RemoteIO audio unit: the mixing is
//  already ours, so all that is wanted is a callback that hands over PCM, and
//  AudioQueue is the smallest API that does exactly that. It has been there
//  since iOS 2 and is not deprecated.
//
//  NOT YET COMPILED - there is no Mac on this machine.
#ifdef __APPLE__

#import <Foundation/Foundation.h>
#import <AudioToolbox/AudioToolbox.h>
#import <AVFoundation/AVFoundation.h>

#include "audio_mix.h"
#include "ran_plat.h"

#define LOGI(...) RanPlat_Log(RANLOG_INFO,  "RanAudio", __VA_ARGS__)
#define LOGE(...) RanPlat_Log(RANLOG_ERROR, "RanAudio", __VA_ARGS__)

extern "C" int  RanAudioSink_Start ( void );
extern "C" void RanAudioSink_KeepAlive ( int on );

namespace {

//  The same 20 ms as Android, for the same reason: short enough that a sound
//  starts when it is asked for, long enough that a busy frame does not starve
//  the queue. Three buffers rather than two because AudioQueue enqueues ahead.
const int kFramesPerBuffer = 882;
const int kBuffers = 3;

AudioQueueRef       g_queue = NULL;
AudioQueueBufferRef g_buf[kBuffers];
bool g_running = false;
//  Background keep-alive (RanAudioSink_KeepAlive): the queue keeps running but
//  plays silence, which is what lets iOS leave the app - and its connection to
//  the game server - running while the player is in another app.
volatile bool g_silent = false;

void queueCallback ( void *, AudioQueueRef q, AudioQueueBufferRef buf )
{
    const UInt32 bytes = (UInt32) ( kFramesPerBuffer * RANAUDIO_CHANNELS * sizeof(short) );
    if (!g_running || g_silent) {
        memset ( buf->mAudioData, 0, bytes );
    } else {
        RanAudio_Mix ( (short *) buf->mAudioData, kFramesPerBuffer );
    }
    buf->mAudioDataByteSize = bytes;
    AudioQueueEnqueueBuffer ( q, buf, 0, NULL );
}

void setGameCategory ()
{
    NSError *err = nil;
    [[AVAudioSession sharedInstance] setCategory:AVAudioSessionCategoryPlayback
                                     withOptions:AVAudioSessionCategoryOptionMixWithOthers
                                           error:&err];
    if (err) LOGE ( "audio session category: %s", err.localizedDescription.UTF8String );
}

//  A call, Siri, an alarm or another app taking the audio stops the queue, and
//  iOS does not start it again by itself: the game stayed silent until it was
//  restarted. Started again when the interruption ends, and after the media
//  server resets (the session and queue are dead then - built anew).
void restartQueue ( const char *why )
{
    if (!g_queue) return;
    NSError *err = nil;
    [[AVAudioSession sharedInstance] setActive:YES error:&err];
    const OSStatus st = AudioQueueStart ( g_queue, NULL );
    LOGI ( "audio restarted (%s): session %s, queue %d", why,
           err ? err.localizedDescription.UTF8String : "ok", (int) st );
}

void watchSession ()
{
    static bool s_watching = false;
    if (s_watching) return;
    s_watching = true;
    NSNotificationCenter *nc = [NSNotificationCenter defaultCenter];
    [nc addObserverForName:AVAudioSessionInterruptionNotification object:nil queue:nil
                usingBlock:^(NSNotification *n) {
        const NSUInteger type = [n.userInfo[AVAudioSessionInterruptionTypeKey] unsignedIntegerValue];
        if (type == AVAudioSessionInterruptionTypeBegan) { LOGI ( "audio interrupted" ); return; }
        restartQueue ( "interruption ended" );
    }];
    [nc addObserverForName:AVAudioSessionMediaServicesWereResetNotification object:nil queue:nil
                usingBlock:^(NSNotification *) {
        LOGI ( "audio media services reset - rebuilding the queue" );
        if (g_queue) { AudioQueueDispose ( g_queue, true ); g_queue = NULL; }
        g_running = false;
        RanAudioSink_Start ();
        if (g_silent) RanAudioSink_KeepAlive ( 1 );
    }];
}

} // namespace

extern "C" int RanAudioSink_Start ( void )
{
    if (g_running) return 1;

    //  Playback, mixable with others (2026-11-01). It was Ambient, which goes
    //  silent with the ring/silent switch or Control Center's silent mode:
    //  players on iPhones and iPads reported no sound while the mixer was
    //  measurably playing (crash-report logs, peak ~20000/32767 on iPad6,4,
    //  iPad7,11, iPad11,2). The game's own sound settings and the volume
    //  buttons still mute it; another app's music keeps playing under it.
    NSError *err = nil;
    setGameCategory ();
    [[AVAudioSession sharedInstance] setActive:YES error:&err];
    if (err) LOGE ( "audio session activate: %s", err.localizedDescription.UTF8String );
    watchSession ();

    AudioStreamBasicDescription fmt;
    memset ( &fmt, 0, sizeof(fmt) );
    fmt.mFormatID         = kAudioFormatLinearPCM;
    fmt.mFormatFlags      = kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked;
    fmt.mSampleRate       = RANAUDIO_RATE;
    fmt.mChannelsPerFrame = RANAUDIO_CHANNELS;
    fmt.mBitsPerChannel   = 16;
    fmt.mFramesPerPacket  = 1;
    fmt.mBytesPerFrame    = RANAUDIO_CHANNELS * sizeof(short);
    fmt.mBytesPerPacket   = fmt.mBytesPerFrame;

    OSStatus st = AudioQueueNewOutput ( &fmt, queueCallback, NULL, NULL, NULL, 0, &g_queue );
    if (st != noErr) { LOGE ( "AudioQueueNewOutput failed: %d", (int) st ); return 0; }

    const UInt32 bytes = (UInt32) ( kFramesPerBuffer * RANAUDIO_CHANNELS * sizeof(short) );
    for (int i = 0; i < kBuffers; ++i) {
        st = AudioQueueAllocateBuffer ( g_queue, bytes, &g_buf[i] );
        if (st != noErr) { LOGE ( "AudioQueueAllocateBuffer failed: %d", (int) st ); return 0; }
    }

    g_running = true;

    //  Primed with silence and enqueued before start: the callback only fires
    //  for a buffer that has been played, so an empty queue never starts.
    for (int i = 0; i < kBuffers; ++i) {
        memset ( g_buf[i]->mAudioData, 0, bytes );
        g_buf[i]->mAudioDataByteSize = bytes;
        AudioQueueEnqueueBuffer ( g_queue, g_buf[i], 0, NULL );
    }

    st = AudioQueueStart ( g_queue, NULL );
    if (st != noErr) { LOGE ( "AudioQueueStart failed: %d", (int) st ); g_running = false; return 0; }

    RanAudio_SetSinkLatency ( kFramesPerBuffer * kBuffers );

    LOGI ( "AudioQueue out: %d Hz stereo, %d x %d frames",
           RANAUDIO_RATE, kBuffers, kFramesPerBuffer );
    return 1;
}

//  The app went to the background. Pausing stops the callback, so the mixer is
//  not run at all - the same trade as the Android sink.
//  In the background: keep the queue playing silence under the Playback
//  category (mixable, so other apps' sound is untouched), which with
//  UIBackgroundModes=audio keeps the process running. Back in front: the game's
//  the same category (setGameCategory) and its own sound again.
extern "C" void RanAudioSink_KeepAlive ( int on )
{
    if (!g_queue) return;
    NSError *err = nil;
    if (on) {
        g_silent = true;
        [[AVAudioSession sharedInstance] setCategory:AVAudioSessionCategoryPlayback
                                         withOptions:AVAudioSessionCategoryOptionMixWithOthers
                                               error:&err];
    } else {
        setGameCategory ();
        g_silent = false;
    }
    if (err) LOGE ( "audio keep-alive category: %s", err.localizedDescription.UTF8String );
    [[AVAudioSession sharedInstance] setActive:YES error:nil];
    AudioQueueStart ( g_queue, NULL );
    LOGI ( "audio keep-alive %s", on ? "on (silent)" : "off" );
}

extern "C" void RanAudioSink_Pause ( int paused )
{
    if (!g_queue) return;
    if (paused) AudioQueuePause ( g_queue );
    else        AudioQueueStart ( g_queue, NULL );
    LOGI ( "audio %s", paused ? "paused" : "resumed" );
}

extern "C" void RanAudioSink_Stop ( void )
{
    g_running = false;
    if (g_queue) {
        AudioQueueStop ( g_queue, true );
        AudioQueueDispose ( g_queue, true );
        g_queue = NULL;
    }
    [[AVAudioSession sharedInstance] setActive:NO error:nil];
}

#endif  //  __APPLE__
