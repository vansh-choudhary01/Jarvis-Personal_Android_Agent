package com.yourname.jarvis

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.CallLog
import android.provider.Telephony
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class TelephonyModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "JarvisTelephony"

  @ReactMethod fun getRecentCalls(limit: Double, promise: Promise) {
    if (!granted(Manifest.permission.READ_CALL_LOG)) return promise.reject("PERMISSION_DENIED", "READ_CALL_LOG is required")
    runCatching {
      val rows = Arguments.createArray()
      val projection = arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.TYPE, CallLog.Calls.DATE, CallLog.Calls.DURATION)
      context.contentResolver.query(
        CallLog.Calls.CONTENT_URI,
        projection,
        null,
        null,
        "${CallLog.Calls.DATE} DESC",
      )?.use { cursor ->
        val max = limit.toInt().coerceIn(1, 100)
        var count = 0
        while (cursor.moveToNext() && count++ < max) {
          rows.pushMap(Arguments.createMap().apply {
            putString("number", cursor.getString(0).orEmpty())
            putInt("type", cursor.getInt(1))
            putDouble("timestamp", cursor.getLong(2).toDouble())
            putDouble("durationSeconds", cursor.getLong(3).toDouble())
          })
        }
      }
      promise.resolve(rows)
    }.onFailure { promise.reject("CALL_LOG_FAILED", it) }
  }

  @ReactMethod fun getRecentSms(limit: Double, promise: Promise) {
    if (!granted(Manifest.permission.READ_SMS)) return promise.reject("PERMISSION_DENIED", "READ_SMS is required")
    runCatching {
      val rows = Arguments.createArray()
      val projection = arrayOf(Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE, Telephony.Sms.TYPE)
      context.contentResolver.query(
        Telephony.Sms.CONTENT_URI,
        projection,
        null,
        null,
        "${Telephony.Sms.DATE} DESC",
      )?.use { cursor ->
        val max = limit.toInt().coerceIn(1, 100)
        var count = 0
        while (cursor.moveToNext() && count++ < max) {
          rows.pushMap(Arguments.createMap().apply {
            putString("address", cursor.getString(0).orEmpty())
            putString("body", cursor.getString(1).orEmpty())
            putDouble("timestamp", cursor.getLong(2).toDouble())
            putInt("type", cursor.getInt(3))
          })
        }
      }
      promise.resolve(rows)
    }.onFailure { promise.reject("SMS_READ_FAILED", it) }
  }

  @ReactMethod fun call(number: String, promise: Promise) {
    if (!granted(Manifest.permission.CALL_PHONE)) return promise.reject("PERMISSION_DENIED", "CALL_PHONE is required")
    runCatching {
      val intent = Intent(Intent.ACTION_CALL, Uri.parse("tel:${Uri.encode(number)}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      promise.resolve(true)
    }.onFailure { promise.reject("CALL_FAILED", it) }
  }

  @ReactMethod fun addListener(eventName: String) = Unit
  @ReactMethod fun removeListeners(count: Double) = Unit

  private fun granted(permission: String) = ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
}
