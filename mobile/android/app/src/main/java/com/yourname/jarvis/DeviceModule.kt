package com.yourname.jarvis

import android.Manifest
import android.app.ActivityManager
import android.content.Context
import android.content.ComponentName
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.os.StatFs
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONObject

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
    runCatching {
      val resolved = resolveLaunchablePackage(packageName)
      val intent = context.packageManager.getLaunchIntentForPackage(resolved)
        ?: throw IllegalArgumentException("No launchable app for $packageName")
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      promise.resolve(true)
    }.onFailure { promise.reject("APP_NOT_FOUND", it.message, it) }
  }

  @ReactMethod fun listApps(promise: Promise) {
    runCatching {
      val launcherIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
      val apps = context.packageManager
        .queryIntentActivities(launcherIntent, 0)
        .sortedBy { it.loadLabel(context.packageManager).toString().lowercase() }
      promise.resolve(Arguments.createArray().apply {
        apps.forEach { app ->
          pushMap(Arguments.createMap().apply {
            putString("label", app.loadLabel(context.packageManager).toString())
            putString("packageName", app.activityInfo.packageName)
          })
        }
      })
    }.onFailure { promise.reject("LIST_APPS_FAILED", it) }
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

  @ReactMethod fun getDeviceProfile(promise: Promise) {
    runCatching {
      val activity = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      val memory = ActivityManager.MemoryInfo().also(activity::getMemoryInfo)
      val stat = StatFs(context.filesDir.absolutePath)
      val power = context.getSystemService(PowerManager::class.java)
      val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
      val batteryStatus = battery?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
      val batteryLevel = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
      val batteryScale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
      val batteryPercent = if (batteryLevel >= 0 && batteryScale > 0) (batteryLevel * 100 / batteryScale) else -1
      val features = context.packageManager.systemAvailableFeatures.mapNotNull { it.name }
      val hasVulkan = features.any { it.contains("vulkan", ignoreCase = true) }
      val hasGpu = context.packageManager.hasSystemFeature(PackageManager.FEATURE_OPENGLES_EXTENSION_PACK) || hasVulkan
      val hasNpu = features.any {
        it.contains("neural", ignoreCase = true) ||
          it.contains("npu", ignoreCase = true) ||
          it.contains("ai", ignoreCase = true) ||
          it.contains("hexagon", ignoreCase = true)
      }
      val profile = JSONObject()
        .put("manufacturer", Build.MANUFACTURER.orEmpty())
        .put("model", Build.MODEL.orEmpty())
        .put("ramMB", (memory.totalMem / 1024L / 1024L).toInt())
        .put("cpuCores", Runtime.getRuntime().availableProcessors())
        .put("architecture", System.getProperty("os.arch").orEmpty())
        .put("abi", Build.SUPPORTED_ABIS.firstOrNull().orEmpty())
        .put("androidVersion", Build.VERSION.RELEASE.orEmpty())
        .put("sdk", Build.VERSION.SDK_INT)
        .put("storageAvailableMB", (stat.availableBytes / 1024L / 1024L).toInt())
        .put("batteryState", batteryStateName(batteryStatus))
        .put("batteryPercent", batteryPercent)
        .put("thermalStatus", thermalStatusName(if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) power.currentThermalStatus else -1))
        .put("supportsGPUAcceleration", hasGpu)
        .put("supportsNPUAcceleration", hasNpu)

      context.getSharedPreferences("jarvis", Context.MODE_PRIVATE)
        .edit()
        .putString("device_profile", profile.toString())
        .apply()

      promise.resolve(Arguments.createMap().apply {
        putString("manufacturer", profile.getString("manufacturer"))
        putString("model", profile.getString("model"))
        putInt("ramMB", profile.getInt("ramMB"))
        putInt("cpuCores", profile.getInt("cpuCores"))
        putString("architecture", profile.getString("architecture"))
        putString("abi", profile.getString("abi"))
        putString("androidVersion", profile.getString("androidVersion"))
        putInt("sdk", profile.getInt("sdk"))
        putInt("storageAvailableMB", profile.getInt("storageAvailableMB"))
        putString("batteryState", profile.getString("batteryState"))
        putInt("batteryPercent", profile.getInt("batteryPercent"))
        putString("thermalStatus", profile.getString("thermalStatus"))
        putBoolean("supportsGPUAcceleration", profile.getBoolean("supportsGPUAcceleration"))
        putBoolean("supportsNPUAcceleration", profile.getBoolean("supportsNPUAcceleration"))
      })
    }.onFailure { promise.reject("DEVICE_PROFILE_FAILED", it) }
  }

  @ReactMethod fun addListener(eventName: String) = Unit
  @ReactMethod fun removeListeners(count: Double) = Unit

  private fun openSettings(action: String) {
    context.startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }

  private fun granted(permission: String) = ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

  private fun resolveLaunchablePackage(requestedPackage: String): String {
    val requested = requestedPackage.trim()
    if (context.packageManager.getLaunchIntentForPackage(requested) != null) return requested

    val aliases = when (requested.lowercase()) {
      "calculator", "calc", "com.calculator" -> listOf(
        "com.google.android.calculator",
        "com.android.calculator2",
        "com.sec.android.app.popupcalculator",
        "com.miui.calculator",
        "com.coloros.calculator",
        "com.oneplus.calculator",
      )
      "settings", "android settings" -> listOf("com.android.settings")
      "chrome", "browser" -> listOf("com.android.chrome", "com.google.android.apps.chrome")
      "whatsapp", "whats app" -> listOf("com.whatsapp")
      "whatsapp business" -> listOf("com.whatsapp.w4b")
      else -> emptyList()
    }

    aliases.firstOrNull { context.packageManager.getLaunchIntentForPackage(it) != null }?.let { return it }

    val launcherIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    val requestedWords = requested.lowercase().split(Regex("[^a-z0-9]+")).filter { it.isNotBlank() }
    if (requestedWords.isNotEmpty()) {
      context.packageManager.queryIntentActivities(launcherIntent, 0)
        .firstOrNull { app ->
          val label = app.loadLabel(context.packageManager).toString().lowercase()
          val pkg = app.activityInfo.packageName.lowercase()
          requestedWords.all { word -> label.contains(word) || pkg.contains(word) }
        }
        ?.let { return it.activityInfo.packageName }
    }

    throw IllegalArgumentException("No launchable app for $requestedPackage")
  }

  private fun batteryStateName(status: Int) = when (status) {
    BatteryManager.BATTERY_STATUS_CHARGING -> "charging"
    BatteryManager.BATTERY_STATUS_DISCHARGING -> "discharging"
    BatteryManager.BATTERY_STATUS_FULL -> "full"
    BatteryManager.BATTERY_STATUS_NOT_CHARGING -> "not_charging"
    else -> "unknown"
  }

  private fun thermalStatusName(status: Int) = when (status) {
    PowerManager.THERMAL_STATUS_NONE -> "none"
    PowerManager.THERMAL_STATUS_LIGHT -> "light"
    PowerManager.THERMAL_STATUS_MODERATE -> "moderate"
    PowerManager.THERMAL_STATUS_SEVERE -> "severe"
    PowerManager.THERMAL_STATUS_CRITICAL -> "critical"
    PowerManager.THERMAL_STATUS_EMERGENCY -> "emergency"
    PowerManager.THERMAL_STATUS_SHUTDOWN -> "shutdown"
    else -> "unknown"
  }
}
