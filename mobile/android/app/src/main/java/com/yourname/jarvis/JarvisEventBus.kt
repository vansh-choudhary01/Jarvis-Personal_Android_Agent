package com.yourname.jarvis

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.lang.ref.WeakReference

object JarvisEventBus {
  private var reactContext = WeakReference<ReactApplicationContext>(null)

  fun attach(context: ReactApplicationContext) {
    reactContext = WeakReference(context)
  }

  fun emit(name: String, payload: WritableMap) {
    val context = reactContext.get() ?: return
    if (!context.hasActiveReactInstance()) return
    context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(name, payload)
  }

  fun error(message: String) {
    emit("jarvis_error", Arguments.createMap().apply { putString("message", message) })
  }
}
