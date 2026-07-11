package com.yourname.jarvis

import android.Manifest
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class DeviceModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  init { JarvisEventBus.attach(context) }
  override fun getName() = "JarvisDevice"

  @ReactMethod fun startForegroundService(brainUrl: String, authToken: String, promise: Promise) {
    runCatching {
      ContextCompat.startForegroundService(
        context,
        Intent(context, JarvisForegroundService::class.java).apply {
          putExtra(JarvisForegroundService.EXTRA_BRAIN_URL, brainUrl)
          putExtra(JarvisForegroundService.EXTRA_AUTH_TOKEN, authToken)
        },
      )
      promise.resolve(true)
    }.onFailure { promise.reject("SERVICE_START_FAILED", it) }
  }

  @ReactMethod fun stopForegroundService(promise: Promise) {
    context.stopService(Intent(context, JarvisForegroundService::class.java))
    promise.resolve(true)
  }

  @ReactMethod fun openApp(packageName: String, promise: Promise) {
    val intent = context.packageManager.getLaunchIntentForPackage(packageName)
    if (intent == null) return promise.reject("APP_NOT_FOUND", "No launchable app for $packageName")
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
    promise.resolve(true)
  }

  @ReactMethod fun openAccessibilitySettings() = openSettings(Settings.ACTION_ACCESSIBILITY_SETTINGS)
  @ReactMethod fun openNotificationSettings() = openSettings("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")
  @ReactMethod fun openBatterySettings() = openSettings(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)

  @ReactMethod fun getPermissionStatus(promise: Promise) {
    val enabledAccessibility = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES).orEmpty()
    val component = ComponentName(context, JarvisAccessibilityService::class.java).flattenToString()
    val enabledListeners = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners").orEmpty()
    val power = context.getSystemService(PowerManager::class.java)
    promise.resolve(Arguments.createMap().apply {
      putBoolean("accessibility", enabledAccessibility.contains(component, ignoreCase = true))
      putBoolean("notifications", enabledListeners.contains(context.packageName, ignoreCase = true))
      putBoolean("batteryExempt", power.isIgnoringBatteryOptimizations(context.packageName))
      putBoolean("callLog", granted(Manifest.permission.READ_CALL_LOG))
      putBoolean("sms", granted(Manifest.permission.READ_SMS) && granted(Manifest.permission.RECEIVE_SMS))
      putBoolean("callPhone", granted(Manifest.permission.CALL_PHONE))
      putBoolean("postNotifications", Build.VERSION.SDK_INT < 33 || granted(Manifest.permission.POST_NOTIFICATIONS))
    })
  }

  @ReactMethod fun addListener(eventName: String) = Unit
  @ReactMethod fun removeListeners(count: Double) = Unit

  private fun openSettings(action: String) {
    context.startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }

  private fun granted(permission: String) = ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
}
