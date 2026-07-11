package com.yourname.jarvis

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class AccessibilityModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  init { JarvisEventBus.attach(context) }
  override fun getName() = "JarvisAccessibility"

  @ReactMethod fun tap(x: Double, y: Double, promise: Promise) = withService(promise) {
    it.tap(x.toInt(), y.toInt()) { ok -> settle(promise, ok, "Tap was rejected") }
  }

  @ReactMethod fun type(text: String, promise: Promise) = withService(promise) {
    settle(promise, it.type(text), "No editable input is focused")
  }

  @ReactMethod fun swipe(x1: Double, y1: Double, x2: Double, y2: Double, promise: Promise) = withService(promise) {
    it.swipe(x1.toInt(), y1.toInt(), x2.toInt(), y2.toInt()) { ok -> settle(promise, ok, "Swipe was rejected") }
  }

  @ReactMethod fun findAndTap(targetText: String, promise: Promise) = withService(promise) {
    it.findAndTap(targetText) { ok -> settle(promise, ok, "No matching node was found") }
  }

  @ReactMethod fun getCurrentNodeTree(promise: Promise) = withService(promise) {
    promise.resolve(it.currentTree())
  }

  @ReactMethod fun addListener(eventName: String) = Unit
  @ReactMethod fun removeListeners(count: Double) = Unit

  private fun withService(promise: Promise, block: (JarvisAccessibilityService) -> Unit) {
    val service = JarvisAccessibilityService.instance
    if (service == null) promise.reject("ACCESSIBILITY_DISABLED", "Enable Jarvis in Accessibility settings")
    else block(service)
  }

  private fun settle(promise: Promise, success: Boolean, reason: String) {
    if (success) promise.resolve(true) else promise.reject("ACTION_FAILED", reason)
  }
}
