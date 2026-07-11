package com.yourname.jarvis

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.facebook.react.bridge.Arguments

class JarvisNotificationListenerService : NotificationListenerService() {
  override fun onListenerConnected() {
    super.onListenerConnected()
    activeNotifications?.forEach(::forward)
  }

  override fun onNotificationPosted(notification: StatusBarNotification) {
    forward(notification)
  }

  private fun forward(notification: StatusBarNotification) {
    val extras = notification.notification.extras
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
    val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty()
    JarvisForegroundService.instance?.sendNotification(
      notification.packageName,
      title,
      text,
      notification.postTime,
    )
    JarvisEventBus.emit(
      "notification",
      Arguments.createMap().apply {
        putString("packageName", notification.packageName)
        putString("title", title)
        putString("text", text)
        putDouble("timestamp", notification.postTime.toDouble())
      },
    )
  }
}
