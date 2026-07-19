package com.yourname.jarvis

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.BluetoothAdapter
import android.content.BroadcastReceiver
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.PackageManager.NameNotFoundException
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.CallLog
import android.telephony.TelephonyManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class JarvisForegroundService : Service() {
  companion object {
    const val CHANNEL_ID = "jarvis_connection"
    const val NOTIFICATION_ID = 1407
    const val EXTRA_BRAIN_URL = "brain_url"
    const val EXTRA_AUTH_TOKEN = "auth_token"
    const val LOCAL_BRAIN_URL = "local://embedded-brain"
    @Volatile var instance: JarvisForegroundService? = null
      private set
  }

  private val handler = Handler(Looper.getMainLooper())
  private val client = OkHttpClient.Builder().pingInterval(20, TimeUnit.SECONDS).build()
  private var socket: WebSocket? = null
  private var brainUrl = ""
  private var authToken = ""
  private var reconnect: Runnable? = null
  private var stopped = false
  private var localMode = false
  private var currentStatus = "Not started"
  private var taskActive = false
  private var lastBatteryPercent: Int? = null
  private var lastCharging: Boolean? = null
  private var lastPhoneState = TelephonyManager.EXTRA_STATE_IDLE
  private var screenSnapshotQueued = false
  private var systemReceiverRegistered = false
  private var packageReceiverRegistered = false
  private var clipboardListener: ClipboardManager.OnPrimaryClipChangedListener? = null

  private val systemReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      when (intent.action) {
        Intent.ACTION_BATTERY_CHANGED -> publishBatteryChanged(intent)
        Intent.ACTION_BATTERY_LOW -> publishAndroidEvent("battery.low", "android.battery", "high", mapOf("percent" to (lastBatteryPercent ?: -1)))
        Intent.ACTION_POWER_CONNECTED -> publishAndroidEvent("charging.started", "android.power", "normal", batteryPayload(intent, true))
        Intent.ACTION_POWER_DISCONNECTED -> publishAndroidEvent("charging.stopped", "android.power", "normal", batteryPayload(intent, false))
        Intent.ACTION_SCREEN_OFF -> publishAndroidEvent("screen.locked", "android.screen", "high", mapOf("interactive" to false))
        Intent.ACTION_SCREEN_ON -> publishAndroidEvent("screen.unlocked", "android.screen", "normal", mapOf("interactive" to true, "reason" to "screen_on"))
        Intent.ACTION_USER_PRESENT -> publishAndroidEvent("screen.unlocked", "android.screen", "high", mapOf("interactive" to true, "reason" to "user_present"))
        BluetoothAdapter.ACTION_CONNECTION_STATE_CHANGED -> publishBluetoothEvent(intent)
        ConnectivityManager.CONNECTIVITY_ACTION -> publishWifiEvent()
        TelephonyManager.ACTION_PHONE_STATE_CHANGED -> publishCallState(intent)
      }
    }
  }

  private val packageReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      when (intent.action) {
        Intent.ACTION_PACKAGE_ADDED -> publishPackageEvent("package.installed", intent)
        Intent.ACTION_PACKAGE_REMOVED -> publishPackageEvent("package.removed", intent)
      }
    }
  }

  override fun onCreate() {
    super.onCreate()
    instance = this
    getSystemService(NotificationManager::class.java).createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Jarvis connection", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Keeps the Jarvis phone connection active"
        setShowBadge(false)
      },
    )
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val prefs = getSharedPreferences("jarvis", MODE_PRIVATE)
    val explicitBrainUrl = intent?.getStringExtra(EXTRA_BRAIN_URL)
    brainUrl = explicitBrainUrl ?: LOCAL_BRAIN_URL
    authToken = if (explicitBrainUrl == null) "" else intent?.getStringExtra(EXTRA_AUTH_TOKEN) ?: ""
    localMode = brainUrl.startsWith("local://")
    if (localMode) {
      prefs.edit().putString(EXTRA_BRAIN_URL, LOCAL_BRAIN_URL).putString(EXTRA_AUTH_TOKEN, "").apply()
      brainUrl = LOCAL_BRAIN_URL
      authToken = ""
    } else if (brainUrl.isNotBlank() && authToken.isNotBlank()) {
      prefs.edit().putString(EXTRA_BRAIN_URL, brainUrl).putString(EXTRA_AUTH_TOKEN, authToken).apply()
    }

    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
    val pendingIntent = PendingIntent.getActivity(
      this, 0, launchIntent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    startForeground(
      NOTIFICATION_ID,
      NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(R.mipmap.ic_launcher)
        .setContentTitle("Jarvis is running")
        .setContentText(if (localMode) "Embedded brain is running on this phone" else "Connected device automation is available")
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setOngoing(true)
        .setContentIntent(pendingIntent)
        .build(),
    )
    stopped = false
    registerSystemEventPublishers()
    if (localMode) {
      socket?.close(1000, "Switching to embedded brain")
      socket = null
      reconnect?.let(handler::removeCallbacks)
      reconnect = null
      emitStatus("Embedded brain running on phone")
    } else {
      connect()
      if (socket != null) emitStatus(currentStatus)
    }
    return START_STICKY
  }

  private fun connect() {
    if (localMode || stopped || brainUrl.isBlank() || authToken.isBlank() || socket != null) return
    emitStatus("Connecting…")
    val separator = if (brainUrl.contains('?')) "&" else "?"
    val request = Request.Builder()
      .url("$brainUrl${separator}token=${Uri.encode(authToken)}")
      .build()
    socket = client.newWebSocket(request, object : WebSocketListener() {
      override fun onOpen(webSocket: WebSocket, response: Response) {
        emitStatus("Connected")
        sendScreenState(null)
      }

      override fun onMessage(webSocket: WebSocket, text: String) = handleMessage(text)

      override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = disconnected(webSocket)
      override fun onFailure(webSocket: WebSocket, error: Throwable, response: Response?) {
        JarvisEventBus.error("Connection: ${error.message}")
        disconnected(webSocket)
      }
    })
  }

  private fun disconnected(webSocket: WebSocket) {
    if (socket !== webSocket) return
    socket = null
    if (stopped) return
    emitStatus("Disconnected — retrying")
    reconnect?.let(handler::removeCallbacks)
    reconnect = Runnable { connect() }.also { handler.postDelayed(it, 3000) }
  }

  private fun handleMessage(raw: String) {
    val message = runCatching { JSONObject(raw) }.getOrElse {
      JarvisEventBus.error("Invalid brain message")
      return
    }
    when (message.optString("type")) {
      "request_screen_state" -> handler.post { sendScreenState(null) }
      "task_status" -> {
        val status = message.optString("status")
        val detail = message.optString("detail", status)
        if (status == "started") {
          taskActive = true
          JarvisAccessibilityService.instance?.overlayTaskStarted(detail)
        }
        emitStatus(detail)
      }
      "action" -> handler.post { execute(message) }
    }
  }

  private fun execute(action: JSONObject) {
    val service = JarvisAccessibilityService.instance
    val name = action.optString("action")
    if (name == "task_complete" || name == "task_failed") {
      taskActive = false
      val success = name == "task_complete"
      val detail = if (success) action.optString("summary") else action.optString("reason")
      JarvisAccessibilityService.instance?.overlayFinished(detail, success)
      emitStatus(if (success) "Complete: $detail" else "Failed: $detail")
      return
    }
    JarvisAccessibilityService.instance?.overlayAction(
      name,
      action.optString("status").takeIf(String::isNotBlank),
      if (action.has("progress")) action.optInt("progress") else null,
    )

    fun finish(result: String, delayMs: Long = settleDelayFor(name)) {
      if (delayMs <= 0L) sendScreenState(result) else handler.postDelayed({ sendScreenState(result) }, delayMs)
    }
    try {
      when (name) {
        "list_apps" -> {
          val apps = JSONArray()
          packageManager.getInstalledPackages(0).forEach { pkg ->
            val label = runCatching { packageManager.getApplicationLabel(pkg.applicationInfo!!).toString() }.getOrDefault(pkg.packageName)
            apps.put(JSONObject().put("packageName", pkg.packageName).put("label", label))
          }
          finish("success: $apps")
        }
        "resolve_app" -> finish("success: ${resolveApp(action.getString("appName"))}", 0L)
        "open_app" -> {
          val target = action.getString("packageName")
          val resolved = resolveLaunchablePackage(target)
          val launchIntent = packageManager.getLaunchIntentForPackage(resolved)
            ?: Intent(Intent.ACTION_VIEW, Uri.parse("https://")).apply { `package` = resolved }
          launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          startActivity(launchIntent)
          finish("success")
        }
        "tap" -> serviceOrThrow(service).tap(action.getInt("x"), action.getInt("y")) { finish(if (it) "success" else "failed: Tap was rejected") }
        "swipe" -> serviceOrThrow(service).swipe(action.getInt("x1"), action.getInt("y1"), action.getInt("x2"), action.getInt("y2")) { finish(if (it) "success" else "failed: Swipe was rejected") }
        "find_and_tap" -> serviceOrThrow(service).findAndTap(action.getString("targetText")) { finish(if (it) "success" else "failed: No matching node was found") }
        "type" -> finish(if (serviceOrThrow(service).type(action.getString("text"))) "success" else "failed: No editable input is focused")
        "wait" -> handler.postDelayed({ sendScreenState("success") }, action.optLong("ms", 1000))
        "call" -> {
          startActivity(Intent(Intent.ACTION_CALL, Uri.parse("tel:${action.getString("number")}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
          finish("success")
        }
        "get_recent_calls" -> {
          if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CALL_LOG) != PackageManager.PERMISSION_GRANTED) {
            throw SecurityException("READ_CALL_LOG permission is required")
          }
          val calls = JSONArray()
          val projection = arrayOf(
            CallLog.Calls.CACHED_NAME,
            CallLog.Calls.NUMBER,
            CallLog.Calls.TYPE,
            CallLog.Calls.DATE,
            CallLog.Calls.DURATION,
          )
          contentResolver.query(
            CallLog.Calls.CONTENT_URI,
            projection,
            null,
            null,
            "${CallLog.Calls.DATE} DESC",
          )?.use { cursor ->
            val limit = action.optInt("limit", 10).coerceIn(1, 50)
            var count = 0
            while (cursor.moveToNext() && count++ < limit) {
              calls.put(JSONObject()
                .put("name", cursor.getString(0).orEmpty())
                .put("number", cursor.getString(1).orEmpty())
                .put("type", cursor.getInt(2))
                .put("timestamp", cursor.getLong(3))
                .put("durationSeconds", cursor.getLong(4)))
            }
          }
          finish("success: ${calls}")
        }
        else -> finish("failed: Unsupported action $name")
      }
    } catch (error: Throwable) {
      finish("failed: ${error.message}")
    }
  }

  fun onAccessibilityChanged() {
    if (screenSnapshotQueued) return
    screenSnapshotQueued = true
    handler.postDelayed({
      screenSnapshotQueued = false
      sendScreenState(null)
    }, 350L)
  }

  fun sendNotification(packageName: String, title: String, text: String, timestamp: Long) {
    socket?.send(JSONObject()
      .put("type", "notification")
      .put("packageName", packageName)
      .put("title", title)
      .put("text", text)
      .put("timestamp", timestamp)
      .toString())
  }

  fun sendDeviceObservation(kind: String, packageName: String, className: String, eventType: String, timestamp: Long) {
    val label = appLabel(packageName)
    JarvisEventBus.emit("device_observation", Arguments.createMap().apply {
      putString("kind", kind)
      putString("packageName", packageName)
      putString("appLabel", label)
      putString("className", className)
      putString("eventType", eventType)
      putDouble("timestamp", timestamp.toDouble())
    })
    socket?.send(JSONObject()
      .put("type", "device_observation")
      .put("kind", kind)
      .put("packageName", packageName)
      .put("appLabel", label)
      .put("className", className)
      .put("eventType", eventType)
      .put("timestamp", timestamp)
      .toString())
  }

  private fun sendScreenState(lastActionResult: String?) {
    val service = JarvisAccessibilityService.instance
    val tree = runCatching { JSONArray(service?.currentTree() ?: "[]") }.getOrDefault(JSONArray())
    val message = JSONObject()
      .put("type", "screen_state")
      .put("nodeTree", tree)
      .put("packageName", service?.currentPackageName().orEmpty())
      .put("lastActionResult", lastActionResult ?: JSONObject.NULL)
    JarvisEventBus.emit("screen_state", Arguments.createMap().apply {
      putString("nodeTreeJson", tree.toString())
      putString("packageName", service?.currentPackageName().orEmpty())
    })
    socket?.send(message.toString())
  }

  private fun emitStatus(status: String) {
    currentStatus = status
    JarvisAccessibilityService.instance?.overlayConnection(status)
    JarvisEventBus.emit("connection_status", Arguments.createMap().apply { putString("status", status) })
  }

  private fun serviceOrThrow(service: JarvisAccessibilityService?) =
    service ?: throw IllegalStateException("Accessibility service is unavailable")

  private fun settleDelayFor(action: String): Long = when (action) {
    "list_apps", "resolve_app", "get_recent_calls" -> 0L
    "tap", "find_and_tap", "type" -> 120L
    "swipe" -> 220L
    "open_app", "call" -> 700L
    else -> 120L
  }

  private fun registerSystemEventPublishers() {
    if (!systemReceiverRegistered) {
      val filter = IntentFilter().apply {
        addAction(Intent.ACTION_BATTERY_CHANGED)
        addAction(Intent.ACTION_BATTERY_LOW)
        addAction(Intent.ACTION_POWER_CONNECTED)
        addAction(Intent.ACTION_POWER_DISCONNECTED)
        addAction(Intent.ACTION_SCREEN_OFF)
        addAction(Intent.ACTION_SCREEN_ON)
        addAction(Intent.ACTION_USER_PRESENT)
      }
      registerReceiver(systemReceiver, filter)

      registerReceiver(systemReceiver, IntentFilter().apply {
        addAction(BluetoothAdapter.ACTION_CONNECTION_STATE_CHANGED)
        addAction(ConnectivityManager.CONNECTIVITY_ACTION)
        addAction(TelephonyManager.ACTION_PHONE_STATE_CHANGED)
      })
      systemReceiverRegistered = true
    }

    if (!packageReceiverRegistered) {
      registerReceiver(packageReceiver, IntentFilter().apply {
        addAction(Intent.ACTION_PACKAGE_ADDED)
        addAction(Intent.ACTION_PACKAGE_REMOVED)
        addDataScheme("package")
      })
      packageReceiverRegistered = true
    }

    if (clipboardListener == null) {
      val clipboard = getSystemService(ClipboardManager::class.java)
      clipboardListener = ClipboardManager.OnPrimaryClipChangedListener {
        val text = clipboard.primaryClip?.getItemAt(0)?.coerceToText(this)?.toString().orEmpty()
        publishAndroidEvent("clipboard.changed", "android.clipboard", "normal", mapOf("text" to text.take(500)))
      }.also { clipboard.addPrimaryClipChangedListener(it) }
    }
  }

  private fun publishBatteryChanged(intent: Intent) {
    val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
    val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
    val percent = if (level >= 0 && scale > 0) level * 100 / scale else -1
    val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, BatteryManager.BATTERY_STATUS_UNKNOWN)
    val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
    if (lastBatteryPercent == percent && lastCharging == charging) return
    lastBatteryPercent = percent
    lastCharging = charging
    publishAndroidEvent("battery.changed", "android.battery", "low", batteryPayload(intent, charging) + mapOf("percent" to percent))
  }

  private fun batteryPayload(intent: Intent, charging: Boolean): Map<String, Any?> {
    val plugged = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0)
    val source = when (plugged) {
      BatteryManager.BATTERY_PLUGGED_USB -> "usb"
      BatteryManager.BATTERY_PLUGGED_AC -> "ac"
      BatteryManager.BATTERY_PLUGGED_WIRELESS -> "wireless"
      else -> ""
    }
    return mapOf("charging" to charging, "powerSource" to source)
  }

  private fun publishPackageEvent(eventType: String, intent: Intent) {
    val packageName = intent.data?.schemeSpecificPart.orEmpty()
    if (packageName.isBlank() || packageName == this.packageName) return
    publishAndroidEvent(eventType, "android.package_manager", "normal", mapOf("packageName" to packageName, "replacing" to intent.getBooleanExtra(Intent.EXTRA_REPLACING, false)))
  }

  private fun publishBluetoothEvent(intent: Intent) {
    val state = intent.getIntExtra(BluetoothAdapter.EXTRA_CONNECTION_STATE, BluetoothAdapter.STATE_DISCONNECTED)
    val eventType = if (state == BluetoothAdapter.STATE_CONNECTED) "bluetooth.connected" else if (state == BluetoothAdapter.STATE_DISCONNECTED) "bluetooth.disconnected" else return
    publishAndroidEvent(eventType, "android.bluetooth", "normal", mapOf("state" to state))
  }

  private fun publishWifiEvent() {
    val connectivity = getSystemService(ConnectivityManager::class.java)
    val network = connectivity.activeNetwork
    val capabilities = connectivity.getNetworkCapabilities(network)
    val connected = capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
    publishAndroidEvent(if (connected) "wifi.connected" else "wifi.lost", "android.connectivity", "normal", mapOf("connected" to connected))
  }

  private fun publishCallState(intent: Intent) {
    val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE).orEmpty()
    if (state == lastPhoneState) return
    lastPhoneState = state
    val eventType = when (state) {
      TelephonyManager.EXTRA_STATE_RINGING -> "call.incoming"
      TelephonyManager.EXTRA_STATE_IDLE -> "call.ended"
      else -> return
    }
    publishAndroidEvent(eventType, "android.telephony", "high", mapOf("state" to state, "number" to intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER).orEmpty()))
  }

  private fun publishAndroidEvent(eventType: String, source: String, priority: String, payload: Map<String, Any?>) {
    val payloadJson = JSONObject()
    val payloadMap = Arguments.createMap()
    payload.forEach { (key, value) ->
      payloadJson.put(key, value)
      when (value) {
        null -> payloadMap.putNull(key)
        is Boolean -> payloadMap.putBoolean(key, value)
        is Int -> payloadMap.putInt(key, value)
        is Long -> payloadMap.putDouble(key, value.toDouble())
        is Double -> payloadMap.putDouble(key, value)
        is Float -> payloadMap.putDouble(key, value.toDouble())
        else -> payloadMap.putString(key, value.toString())
      }
    }
    val timestamp = System.currentTimeMillis()
    JarvisEventBus.emit("android_event", Arguments.createMap().apply {
      putString("eventType", eventType)
      putString("source", source)
      putString("priority", priority)
      putDouble("timestamp", timestamp.toDouble())
      putMap("payload", payloadMap)
    })
    socket?.send(JSONObject()
      .put("type", "android_event")
      .put("eventType", eventType)
      .put("source", source)
      .put("priority", priority)
      .put("timestamp", timestamp)
      .put("payload", payloadJson)
      .toString())
  }

  private fun appLabel(packageName: String): String =
    try {
      val info = packageManager.getApplicationInfo(packageName, 0)
      packageManager.getApplicationLabel(info).toString()
    } catch (_: NameNotFoundException) {
      packageName
    }

  private fun resolveApp(query: String): JSONObject {
    val apps = installedLaunchableApps()
    val visibleLabels = visibleNodeLabels()
    val normalizedQuery = normalizeAppText(query)
    val scored = linkedMapOf<String, JSONObject>()

    apps.forEach { app ->
      val label = app.getString("label")
      val packageName = app.getString("packageName")
      val normalizedLabel = normalizeAppText(label)
      val normalizedPackage = normalizeAppText(packageName)
      var score = appScore(normalizedQuery, normalizedLabel, normalizedPackage)
      var source = "installed_apps"

      if (visibleLabels.any { normalizeAppText(it) == normalizedLabel }) {
        score += 8
        source = "installed_apps+visible_node"
      }

      if (score > 0) {
        scored[packageName] = JSONObject()
          .put("label", label)
          .put("packageName", packageName)
          .put("score", score)
          .put("source", source)
      }
    }

    val matches = scored.values
      .sortedByDescending { it.optInt("score") }
      .take(8)
    val matchesJson = JSONArray().also { array -> matches.forEach(array::put) }
    val best = matches.firstOrNull()
    return JSONObject()
      .put("query", query)
      .put("bestMatch", best ?: JSONObject.NULL)
      .put("matches", matchesJson)
      .put("visibleLauncherLabels", JSONArray(visibleLabels.take(80)))
  }

  private fun resolveLaunchablePackage(requestedPackage: String): String {
    val requested = requestedPackage.trim()
    if (packageManager.getLaunchIntentForPackage(requested) != null) return requested
    val normalized = normalizeAppText(requested)
    installedLaunchableApps()
      .maxByOrNull { appScore(normalized, normalizeAppText(it.getString("label")), normalizeAppText(it.getString("packageName"))) }
      ?.takeIf { appScore(normalized, normalizeAppText(it.getString("label")), normalizeAppText(it.getString("packageName"))) >= 64 }
      ?.let { return it.getString("packageName") }
    return requested
  }

  private fun installedLaunchableApps(): List<JSONObject> {
    val launcherIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    return packageManager.queryIntentActivities(launcherIntent, 0)
      .map { app ->
        JSONObject()
          .put("label", app.loadLabel(packageManager).toString())
          .put("packageName", app.activityInfo.packageName)
      }
      .sortedBy { it.getString("label").lowercase() }
  }

  private fun visibleNodeLabels(): List<String> {
    val service = JarvisAccessibilityService.instance ?: return emptyList()
    val tree = runCatching { JSONArray(service.currentTree()) }.getOrDefault(JSONArray())
    val labels = linkedSetOf<String>()
    for (index in 0 until tree.length()) {
      val node = tree.optJSONObject(index) ?: continue
      listOf(node.optString("text"), node.optString("contentDescription"))
        .map { it.trim() }
        .filter { it.isNotBlank() && it.length <= 80 }
        .filterNot { setOf("apps", "newsfeed", "search", "more options").contains(normalizeAppText(it)) }
        .forEach(labels::add)
    }
    return labels.toList()
  }

  private fun appScore(query: String, label: String, packageName: String): Int {
    if (query.isBlank()) return 0
    if (label == query || packageName == query) return 95
    if (packageName.endsWith(".$query")) return 90
    if (label.startsWith(query)) return 82
    if (label.contains(query)) return 72
    if (packageName.contains(query)) return 64
    val words = query.split(" ").filter { it.isNotBlank() }
    if (words.size > 1 && words.all { label.contains(it) || packageName.contains(it) }) return 76
    if (words.any { it.length > 2 && (label.contains(it) || packageName.contains(it)) }) return 48
    val distance = levenshtein(query, label)
    val maxLen = maxOf(query.length, label.length)
    if (maxLen > 0 && distance.toDouble() / maxLen <= 0.32) return 50
    return 0
  }

  private fun normalizeAppText(value: String): String =
    value.lowercase()
      .replace("&", " and ")
      .replace(Regex("[^a-z0-9]+"), " ")
      .trim()
      .replace(Regex("\\s+"), " ")

  private fun levenshtein(a: String, b: String): Int {
    val previous = IntArray(b.length + 1) { it }
    for (i in 1..a.length) {
      var last = i - 1
      previous[0] = i
      for (j in 1..b.length) {
        val old = previous[j]
        previous[j] = minOf(
          previous[j] + 1,
          previous[j - 1] + 1,
          last + if (a[i - 1] == b[j - 1]) 0 else 1,
        )
        last = old
      }
    }
    return previous[b.length]
  }

  override fun onDestroy() {
    stopped = true
    reconnect?.let(handler::removeCallbacks)
    if (systemReceiverRegistered) {
      runCatching { unregisterReceiver(systemReceiver) }
      systemReceiverRegistered = false
    }
    if (packageReceiverRegistered) {
      runCatching { unregisterReceiver(packageReceiver) }
      packageReceiverRegistered = false
    }
    clipboardListener?.let { listener ->
      runCatching { getSystemService(ClipboardManager::class.java).removePrimaryClipChangedListener(listener) }
      clipboardListener = null
    }
    socket?.close(1000, "Service stopped")
    socket = null
    if (instance === this) instance = null
    client.dispatcher.executorService.shutdown()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
