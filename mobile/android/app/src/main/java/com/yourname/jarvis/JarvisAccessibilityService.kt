package com.yourname.jarvis

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.facebook.react.bridge.Arguments
import org.json.JSONArray
import org.json.JSONObject

class JarvisAccessibilityService : AccessibilityService() {
  companion object {
    @Volatile var instance: JarvisAccessibilityService? = null
      private set
  }

  @Volatile private var latestTree = "[]"

  override fun onServiceConnected() {
    instance = this
    refreshAndEmit()
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) = refreshAndEmit()
  override fun onInterrupt() = Unit

  override fun onDestroy() {
    if (instance === this) instance = null
    super.onDestroy()
  }

  fun currentTree(): String {
    refreshTree()
    return latestTree
  }

  fun currentPackageName(): String = rootInActiveWindow?.packageName?.toString().orEmpty()

  fun tap(x: Int, y: Int, callback: (Boolean) -> Unit) {
    dispatch(Path().apply { moveTo(x.toFloat(), y.toFloat()) }, 1L, 80L, callback)
  }

  fun swipe(x1: Int, y1: Int, x2: Int, y2: Int, callback: (Boolean) -> Unit) {
    val path = Path().apply {
      moveTo(x1.toFloat(), y1.toFloat())
      lineTo(x2.toFloat(), y2.toFloat())
    }
    dispatch(path, 1L, 450L, callback)
  }

  fun type(text: String): Boolean {
    val focused = rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return false
    if (!focused.isEditable) return false
    val args = Bundle().apply {
      putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
    }
    return focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
  }

  fun findAndTap(targetText: String, callback: (Boolean) -> Unit) {
    val match = rootInActiveWindow?.findAccessibilityNodeInfosByText(targetText)?.firstOrNull {
      val shown = it.text?.toString() ?: it.contentDescription?.toString().orEmpty()
      shown.contains(targetText, ignoreCase = true)
    }
    if (match == null) {
      callback(false)
      return
    }

    var clickable: AccessibilityNodeInfo? = match
    while (clickable != null && !clickable.isClickable) clickable = clickable.parent
    if (clickable?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true) {
      callback(true)
      return
    }
    val bounds = Rect().also { match.getBoundsInScreen(it) }
    tap(bounds.centerX(), bounds.centerY(), callback)
  }

  private fun dispatch(path: Path, start: Long, duration: Long, callback: (Boolean) -> Unit) {
    val gesture = GestureDescription.Builder()
      .addStroke(GestureDescription.StrokeDescription(path, start, duration))
      .build()
    val accepted = dispatchGesture(
      gesture,
      object : GestureResultCallback() {
        override fun onCompleted(gestureDescription: GestureDescription?) = callback(true)
        override fun onCancelled(gestureDescription: GestureDescription?) = callback(false)
      },
      null,
    )
    if (!accepted) callback(false)
  }

  private fun refreshAndEmit() {
    refreshTree()
    val root = rootInActiveWindow
    JarvisEventBus.emit(
      "screen_state",
      Arguments.createMap().apply {
        putString("nodeTreeJson", latestTree)
        putString("packageName", root?.packageName?.toString().orEmpty())
      },
    )
    JarvisForegroundService.instance?.onAccessibilityChanged()
  }

  private fun refreshTree() {
    val nodes = JSONArray()
    walk(rootInActiveWindow, nodes, 0)
    latestTree = nodes.toString()
  }

  private fun walk(node: AccessibilityNodeInfo?, output: JSONArray, depth: Int) {
    if (node == null || depth > 60 || output.length() >= 1500) return
    val bounds = Rect().also { node.getBoundsInScreen(it) }
    output.put(JSONObject().apply {
      put("text", node.text?.toString().orEmpty())
      put("contentDescription", node.contentDescription?.toString().orEmpty())
      put("className", node.className?.toString().orEmpty())
      put("packageName", node.packageName?.toString().orEmpty())
      put("bounds", JSONArray(listOf(bounds.left, bounds.top, bounds.right, bounds.bottom)))
      put("clickable", node.isClickable)
      put("editable", node.isEditable)
    })
    for (index in 0 until node.childCount) walk(node.getChild(index), output, depth + 1)
  }
}
