package com.yourname.jarvis

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import kotlin.math.abs

class JarvisOverlayController(
  private val context: Context,
  private val windowType: Int = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
) {
  private val windowManager = context.getSystemService(WindowManager::class.java)
  private val prefs = context.getSharedPreferences("jarvis_overlay", Context.MODE_PRIVATE)
  private var bubble: TextView? = null
  private var panel: LinearLayout? = null
  private var bubbleParams: WindowManager.LayoutParams? = null
  private lateinit var taskText: TextView
  private lateinit var statusText: TextView
  private lateinit var stepText: TextView
  private lateinit var progress: ProgressBar
  private var progressValue = 0
  private var task = "No active task"
  private var status = "Waiting"

  fun show() {
    if (windowType == WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY && !Settings.canDrawOverlays(context)) return
    if (bubble != null) return
    val size = dp(54)
    val view = TextView(context).apply {
      text = "J"
      textSize = 20f
      setTextColor(Color.WHITE)
      gravity = Gravity.CENTER
      typeface = Typeface.DEFAULT_BOLD
      elevation = dp(12).toFloat()
      background = rounded(Color.argb(225, 20, 22, 26), size / 2f, Color.argb(90, 255, 255, 255))
    }
    val params = WindowManager.LayoutParams(
      size,
      size,
      windowType,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = prefs.getInt("x", dp(16))
      y = prefs.getInt("y", dp(180))
    }
    installDrag(view, params)
    windowManager.addView(view, params)
    bubble = view
    bubbleParams = params
  }

  fun hide() {
    panel?.let { runCatching { windowManager.removeView(it) } }
    bubble?.let { runCatching { windowManager.removeView(it) } }
    panel = null
    bubble = null
    bubbleParams = null
  }

  fun taskStarted(instruction: String) {
    task = instruction
    status = "Starting"
    progressValue = 0
    refresh()
  }

  fun action(action: String, activity: String?, progress: Int?) {
    progressValue = (progress ?: progressValue).coerceIn(0, 99)
    status = activity?.takeIf(String::isNotBlank) ?: humanAction(action)
    refresh()
  }

  fun taskFinished(message: String, success: Boolean) {
    status = if (success) "Complete · $message" else "Failed · $message"
    progressValue = 100
    refresh()
  }

  fun connection(status: String) {
    if (task == "No active task") this.status = status
    refresh()
  }

  private fun togglePanel() {
    if (panel != null) {
      windowManager.removeView(panel)
      panel = null
      return
    }
    val root = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(18), dp(16), dp(18), dp(16))
      elevation = dp(18).toFloat()
      background = rounded(Color.argb(205, 24, 26, 30), dp(22).toFloat(), Color.argb(75, 255, 255, 255))
    }
    root.addView(TextView(context).apply {
      text = "JARVIS · LIVE TASK"
      textSize = 10f
      letterSpacing = .14f
      setTextColor(Color.argb(185, 255, 255, 255))
      typeface = Typeface.DEFAULT_BOLD
    })
    taskText = TextView(context).apply {
      textSize = 16f
      setTextColor(Color.WHITE)
      typeface = Typeface.DEFAULT_BOLD
      setPadding(0, dp(10), 0, dp(7))
      maxLines = 3
    }
    root.addView(taskText)
    statusText = TextView(context).apply {
      textSize = 13f
      setTextColor(Color.argb(220, 226, 231, 239))
      setPadding(0, 0, 0, dp(12))
      maxLines = 3
    }
    root.addView(statusText)
    progress = ProgressBar(context, null, android.R.attr.progressBarStyleHorizontal).apply {
      max = 100
      minimumHeight = dp(4)
    }
    root.addView(progress, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(5)))
    stepText = TextView(context).apply {
      textSize = 10f
      setTextColor(Color.argb(165, 255, 255, 255))
      gravity = Gravity.END
      setPadding(0, dp(7), 0, 0)
    }
    root.addView(stepText)

    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      windowType,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
        WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP
      x = dp(14)
      y = dp(70)
      width = windowManager.currentWindowMetrics.bounds.width() - dp(28)
    }
    windowManager.addView(root, params)
    panel = root
    moveBubbleToFront()
    refresh()
  }

  private fun moveBubbleToFront() {
    val view = bubble ?: return
    val params = bubbleParams ?: return
    runCatching { windowManager.removeView(view) }
    windowManager.addView(view, params)
  }

  private fun installDrag(view: View, params: WindowManager.LayoutParams) {
    var startX = 0
    var startY = 0
    var touchX = 0f
    var touchY = 0f
    var moved = false
    view.setOnTouchListener { _, event ->
      when (event.action) {
        MotionEvent.ACTION_DOWN -> {
          startX = params.x
          startY = params.y
          touchX = event.rawX
          touchY = event.rawY
          moved = false
          true
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = (event.rawX - touchX).toInt()
          val dy = (event.rawY - touchY).toInt()
          moved = moved || abs(dx) > dp(4) || abs(dy) > dp(4)
          params.x = startX + dx
          params.y = startY + dy
          windowManager.updateViewLayout(view, params)
          true
        }
        MotionEvent.ACTION_UP -> {
          if (moved) prefs.edit().putInt("x", params.x).putInt("y", params.y).apply()
          else togglePanel()
          true
        }
        else -> false
      }
    }
  }

  private fun refresh() {
    if (panel == null) return
    taskText.text = task
    statusText.text = status
    progress.progress = progressValue
    stepText.text = if (progressValue == 0) "READY" else "$progressValue% COMPLETE"
  }

  private fun humanAction(action: String) = when (action) {
    "open_app" -> "Opening app"
    "find_and_tap" -> "Finding and tapping a visible control"
    "tap" -> "Tapping the screen"
    "type" -> "Entering text"
    "swipe" -> "Scrolling"
    "wait" -> "Waiting for the screen"
    "get_recent_calls" -> "Reading recent calls"
    "call" -> "Starting a call"
    else -> action.replace('_', ' ').replaceFirstChar(Char::uppercase)
  }

  private fun rounded(color: Int, radius: Float, stroke: Int) = GradientDrawable().apply {
    setColor(color)
    cornerRadius = radius
    setStroke(dp(1), stroke)
  }

  private fun dp(value: Int) = (value * context.resources.displayMetrics.density).toInt()
}
