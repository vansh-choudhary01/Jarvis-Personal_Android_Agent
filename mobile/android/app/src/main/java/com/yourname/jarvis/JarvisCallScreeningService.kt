package com.yourname.jarvis

import android.telecom.Call
import android.telecom.CallScreeningService

// Scaffold only. Register this service and request the call-screening role when screening is enabled later.
class JarvisCallScreeningService : CallScreeningService() {
  override fun onScreenCall(callDetails: Call.Details) {
    respondToCall(callDetails, CallResponse.Builder().build())
  }
}
