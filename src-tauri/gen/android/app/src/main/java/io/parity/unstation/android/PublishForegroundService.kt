package io.parity.unstation.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Foreground service that keeps a live camera broadcast running while the app is
 * backgrounded. Without it, Android reclaims camera access (and eventually the
 * process) the moment the user switches apps — the headline "my stream died when I
 * checked a message" failure. Declared with `foregroundServiceType="camera"` (API 34
 * requires the typed FOREGROUND_SERVICE_CAMERA permission); started/stopped in
 * lockstep with [CameraPlugin]'s capture engine, always from the foreground.
 */
class PublishForegroundService : Service() {
    companion object {
        private const val CHANNEL_ID = "unstation_live"
        private const val NOTIFICATION_ID = 42

        fun start(ctx: Context) {
            val i = Intent(ctx, PublishForegroundService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i)
            else ctx.startService(i)
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, PublishForegroundService::class.java))
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "Live broadcast",
                    NotificationManager.IMPORTANCE_LOW, // silent, persistent
                )
            )
        }
        val tapBack = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val notification: Notification =
            (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL_ID)
             else @Suppress("DEPRECATION") Notification.Builder(this))
                .setContentTitle("You’re live on Unstation")
                .setContentText("Broadcasting your camera — tap to return.")
                .setSmallIcon(R.mipmap.ic_launcher)
                .setOngoing(true)
                .setContentIntent(tapBack)
                .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        return START_NOT_STICKY // if the system kills us the stream is over — don't fake-restart
    }
}
