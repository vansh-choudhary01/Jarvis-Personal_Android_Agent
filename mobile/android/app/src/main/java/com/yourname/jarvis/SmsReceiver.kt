package com.yourname.jarvis

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import com.facebook.react.bridge.Arguments

class SmsReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
    for (message in Telephony.Sms.Intents.getMessagesFromIntent(intent)) {
      JarvisEventBus.emit(
        "sms_received",
        Arguments.createMap().apply {
          putString("sender", message.originatingAddress.orEmpty())
          putString("body", message.messageBody.orEmpty())
          putDouble("timestamp", message.timestampMillis.toDouble())
        },
      )
    }
  }
}
