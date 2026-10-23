package com.ran.launcher;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

/*  Keeps the game process alive while the player is in another app (2026-10-24).
 *
 *  Crash reports of 2026-10-23 (build 279): OPPO phones killed the game about one
 *  second after it left the screen - ApplicationExitInfo REASON_OTHER "o-kill(40)",
 *  importance 400 - seven times, and an Infinix "Swipe-up clean" once. The socket
 *  died with the process, which players see as "swap app = instant disconnect".
 *  A foreground service (importance 125, with its notification) is the documented
 *  way to keep a process from those background killers.
 *
 *  Security: the service is not exported (manifest), so no other app can start,
 *  stop or bind it; it reads nothing from the Intent it is started with; and the
 *  notification's tap opens our own launcher through an explicit, immutable
 *  PendingIntent, so nobody can redirect it or fill in extras.
 *
 *  Started by RanActivity while the game is on screen (a foreground start is
 *  always allowed), stopped when the game activity goes away. When the process
 *  dies (background grace over, swipe away) the service goes with it.            */
public class RanSessionService extends Service {

    private static final String TAG = "RanSession";
    private static final String CHANNEL = "ran_session";
    private static final int    NOTIFY_ID = 7101;

    /*  Started once per game session. Android 12+ throws
     *  ForegroundServiceDidNotStartInTimeException at an app whose
     *  onStartCommand does not reach startForeground within about 10 s, and
     *  onStartCommand runs on the UI thread - which, coming back to the game
     *  during a map load, can be waiting for the game thread to take the new
     *  window. So only the first resume (nothing is loading yet) starts it.  */
    static volatile boolean sRunning = false;

    static void start(Context ctx) {
        if (sRunning) return;
        try {
            Intent i = new Intent(ctx, RanSessionService.class);
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
            else                             ctx.startService(i);
        } catch (Throwable t) {
            //  A refused start must never take the game down with it.
            Log.w(TAG, "start refused: " + t);
        }
    }

    static void stop(Context ctx) {
        try {
            ctx.stopService(new Intent(ctx, RanSessionService.class));
        } catch (Throwable t) {
            Log.w(TAG, "stop refused: " + t);
        }
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public void onDestroy() {
        sRunning = false;
        super.onDestroy();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        sRunning = true;
        try {
            Notification n = build();
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(NOTIFY_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            } else {
                startForeground(NOTIFY_ID, n);
            }
        } catch (Throwable t) {
            Log.w(TAG, "startForeground refused: " + t);
            sRunning = false;
            stopSelf();
        }
        //  Not restarted by the system after a kill: a restarted service with no
        //  game behind it would only be an empty notification.
        return START_NOT_STICKY;
    }

    private Notification build() {
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL,
                        "เกมกำลังทำงาน", NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("ทำให้เกมไม่หลุดเมื่อสลับไปใช้แอปอื่น");
                ch.setShowBadge(false);
                ch.setSound(null, null);
                ch.enableVibration(false);
                nm.createNotificationChannel(ch);
            }
            b = new Notification.Builder(this, CHANNEL);
        } else {
            b = new Notification.Builder(this);
            b.setPriority(Notification.PRIORITY_LOW);
        }

        //  Explicit component (our launcher, which brings the running game to the
        //  front) and immutable: the intent cannot be changed by whoever fires it.
        Intent open = new Intent(this, RanLauncher.class);
        open.setAction(Intent.ACTION_MAIN);
        open.addCategory(Intent.CATEGORY_LAUNCHER);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) piFlags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, piFlags);

        b.setSmallIcon(getApplicationInfo().icon)
         .setContentTitle("Ran Legacy M กำลังทำงาน")
         .setContentText("กดเพื่อกลับเข้าเกม")
         .setContentIntent(pi)
         .setOngoing(true)
         .setShowWhen(false);
        if (Build.VERSION.SDK_INT >= 31) {
            b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        }
        return b.build();
    }
}
