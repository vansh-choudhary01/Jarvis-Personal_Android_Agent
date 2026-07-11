package com.yourname.jarvis

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.CallLog
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
    brainUrl = intent?.getStringExtra(EXTRA_BRAIN_URL) ?: prefs.getString(EXTRA_BRAIN_URL, "").orEmpty()
    authToken = intent?.getStringExtra(EXTRA_AUTH_TOKEN) ?: prefs.getString(EXTRA_AUTH_TOKEN, "").orEmpty()
    if (brainUrl.isNotBlank() && authToken.isNotBlank()) {
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
        .setContentText("Connected device automation is available")
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setOngoing(true)
        .setContentIntent(pendingIntent)
        .build(),
    )
    stopped = false
    connect()
    return START_STICKY
  }

  private fun connect() {
    if (stopped || brainUrl.isBlank() || authToken.isBlank() || socket != null) return
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
      "task_status" -> emitStatus(message.optString("detail", message.optString("status")))
      "action" -> handler.post { execute(message) }
    }
  }

  private fun execute(action: JSONObject) {
    val service = JarvisAccessibilityService.instance
    val name = action.optString("action")
    if (name == "task_complete" || name == "task_failed") {
      emitStatus(if (name == "task_complete") "Complete: ${action.optString("summary")}" else "Failed: ${action.optString("reason")}")
      return
    }

    fun finish(result: String) = handler.postDelayed({ sendScreenState(result) }, 450)
    try {
      when (name) {
        "open_app" -> {
          val target = action.getString("packageName")
          val launch = packageManager.getLaunchIntentForPackage(target) ?: throw IllegalStateException("App not found: $target")
          launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          startActivity(launch)
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
    if (socket != null) sendScreenState(null)
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

  private fun sendScreenState(lastActionResult: String?) {
    val service = JarvisAccessibilityService.instance
    val tree = runCatching { JSONArray(service?.currentTree() ?: "[]") }.getOrDefault(JSONArray())
    val message = JSONObject()
      .put("type", "screen_state")
      .put("nodeTree", tree)
      .put("packageName", service?.currentPackageName().orEmpty())
      .put("lastActionResult", lastActionResult ?: JSONObject.NULL)
    socket?.send(message.toString())
  }

  private fun emitStatus(status: String) {
    JarvisEventBus.emit("connection_status", Arguments.createMap().apply { putString("status", status) })
  }

  private fun serviceOrThrow(service: JarvisAccessibilityService?) =
    service ?: throw IllegalStateException("Accessibility service is unavailable")

  override fun onDestroy() {
    stopped = true
    reconnect?.let(handler::removeCallbacks)
    socket?.close(1000, "Service stopped")
    socket = null
    if (instance === this) instance = null
    client.dispatcher.executorService.shutdown()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
