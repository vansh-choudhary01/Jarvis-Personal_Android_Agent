package com.yourname.jarvis

import android.content.Context
import android.os.Debug
import android.os.SystemClock
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileInputStream
import java.io.RandomAccessFile
import java.lang.reflect.Proxy
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max
import kotlin.math.roundToInt

class LocalAiRuntimeModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val prefs = context.getSharedPreferences("jarvis_local_ai_runtime", Context.MODE_PRIVATE)
  private val client = OkHttpClient.Builder().retryOnConnectionFailure(true).build()
  private val worker = Executors.newSingleThreadExecutor()
  private val downloads = ConcurrentHashMap<String, Call>()
  private val paused = ConcurrentHashMap<String, AtomicBoolean>()
  private val modelRoot = File(context.filesDir, "jarvis_models")

  private var llm: Any? = null
  private var loadedModel: ModelRequest? = null
  private var activeGeneration: Future<*>? = null
  private var cancelled = AtomicBoolean(false)
  private var promptTokens = 0
  private var generatedTokens = 0
  private var generationSpeed = 0.0
  private var timeToFirstTokenMs = 0L
  private var loadTimeMs = 0L
  private var temperature = 0.3
  private var peakMemoryBytes = 0L

  override fun getName(): String = "JarvisLocalAiRuntime"

  @ReactMethod
  fun addListener(eventName: String) {
    // Required by NativeEventEmitter on Android.
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    // Required by NativeEventEmitter on Android.
  }

  @ReactMethod
  fun detectMediaPipe(promise: Promise) {
    val map = Arguments.createMap()
    map.putString("provider", "mediapipe")
    try {
      Class.forName("com.google.mediapipe.tasks.genai.llminference.LlmInference")
      map.putBoolean("available", true)
      map.putString("reason", "MediaPipe LLM runtime is packaged.")
    } catch (error: Throwable) {
      map.putBoolean("available", false)
      map.putString("reason", "MediaPipe runtime is not available on this device.")
    }
    promise.resolve(map)
  }

  @ReactMethod
  fun getActiveModelId(promise: Promise) {
    promise.resolve(prefs.getString("active_model_id", null))
  }

  @ReactMethod
  fun setActiveModel(modelId: String, promise: Promise) {
    val status = getStatus(modelId)
    if (status != "ready" && status != "loaded") {
      promise.reject("MODEL_NOT_READY", "Install the model before making it active.")
      return
    }
    prefs.edit().putString("active_model_id", modelId).apply()
    promise.resolve(true)
  }

  @ReactMethod
  fun listInstalledModels(promise: Promise) {
    val rows = Arguments.createArray()
    modelRoot.mkdirs()
    modelRoot.listFiles()?.forEach { dir ->
      if (dir.isDirectory) rows.pushMap(stateMap(dir.name))
    }
    promise.resolve(rows)
  }

  @ReactMethod
  fun getModelState(modelId: String, promise: Promise) {
    promise.resolve(stateMap(modelId))
  }

  @ReactMethod
  fun getStorageUsageBytes(promise: Promise) {
    promise.resolve(directorySize(modelRoot).toDouble())
  }

  @ReactMethod
  fun downloadModel(model: ReadableMap, promise: Promise) {
    val request = ModelRequest.from(model)
    if (request.downloadUrl.isBlank()) {
      modelDir(request.id).mkdirs()
      setFailure(request.id, "No direct MediaPipe .task download URL is configured for this model yet.")
      emitProgress(request, "failed", 0, 0, 0, "No direct MediaPipe .task download URL is configured for this model yet.")
      promise.reject("MODEL_URL_MISSING", "No direct MediaPipe .task download URL is configured for this model yet.")
      return
    }
    startDownload(request)
    promise.resolve(true)
  }

  @ReactMethod
  fun pauseDownload(modelId: String, promise: Promise) {
    paused[modelId]?.set(true)
    downloads.remove(modelId)?.cancel()
    setStatus(modelId, "paused")
    emitProgress(ModelRequest.placeholder(modelId), "paused", partialFile(modelId).length(), expectedBytes(modelId), progressFor(modelId), null)
    promise.resolve(true)
  }

  @ReactMethod
  fun resumeDownload(model: ReadableMap, promise: Promise) {
    startDownload(ModelRequest.from(model))
    promise.resolve(true)
  }

  @ReactMethod
  fun cancelDownload(modelId: String, promise: Promise) {
    paused[modelId]?.set(false)
    downloads.remove(modelId)?.cancel()
    partialFile(modelId).delete()
    setStatus(modelId, "not_installed")
    emitProgress(ModelRequest.placeholder(modelId), "not_installed", 0, expectedBytes(modelId), 0, null)
    promise.resolve(true)
  }

  @ReactMethod
  fun deleteModel(modelId: String, promise: Promise) {
    if (loadedModel?.id == modelId) closeLoadedModel()
    downloads.remove(modelId)?.cancel()
    deleteRecursivelySafe(modelDir(modelId))
    if (prefs.getString("active_model_id", null) == modelId) {
      prefs.edit().remove("active_model_id").apply()
    }
    clearModelPrefs(modelId)
    promise.resolve(true)
  }

  @ReactMethod
  fun loadModel(model: ReadableMap, maxTokens: Int, temp: Double, promise: Promise) {
    val request = ModelRequest.from(model)
    worker.execute {
      try {
        val file = finalFile(request)
        if (!file.exists()) {
          promise.reject("MODEL_MISSING", "Model is not installed: ${request.displayName}")
          return@execute
        }
        setStatus(request.id, "loading")
        val started = SystemClock.elapsedRealtime()
        closeLoadedModel()
        llm = createMediaPipeInference(file.absolutePath, maxTokens, temp.toFloat())
        loadedModel = request
        loadTimeMs = SystemClock.elapsedRealtime() - started
        temperature = temp
        setStatus(request.id, "loaded")
        prefs.edit().putString("active_model_id", request.id).apply()
        snapshotPeakMemory()
        promise.resolve(true)
      } catch (error: Throwable) {
        setFailure(request.id, "Model load failed: ${error.message ?: error.javaClass.simpleName}")
        promise.reject("MODEL_LOAD_FAILED", "Model load failed: ${error.message ?: error.javaClass.simpleName}", error)
      }
    }
  }

  @ReactMethod
  fun generate(prompt: String, maxTokens: Int, temp: Double, promise: Promise) {
    worker.execute {
      try {
        val model = ensureLoaded(maxTokens, temp)
        val started = SystemClock.elapsedRealtime()
        cancelled.set(false)
        promptTokens = estimateTokens(prompt)
        val text = callGenerate(prompt)
        generatedTokens = estimateTokens(text)
        val elapsed = max(1L, SystemClock.elapsedRealtime() - started)
        timeToFirstTokenMs = elapsed
        generationSpeed = generatedTokens * 1000.0 / elapsed
        snapshotPeakMemory()
        val map = Arguments.createMap()
        map.putString("text", text)
        map.putString("modelId", model.id)
        map.putInt("tokensGenerated", generatedTokens)
        promise.resolve(map)
      } catch (error: Throwable) {
        promise.reject("GENERATION_FAILED", "Local generation failed: ${error.message ?: error.javaClass.simpleName}", error)
      }
    }
  }

  @ReactMethod
  fun stream(prompt: String, maxTokens: Int, temp: Double, promise: Promise) {
    worker.execute {
      try {
        ensureLoaded(maxTokens, temp)
        cancelled.set(false)
        promptTokens = estimateTokens(prompt)
        val started = SystemClock.elapsedRealtime()
        val usedNativeStreaming = tryGenerateAsync(prompt)
        if (!usedNativeStreaming) {
          val text = callGenerate(prompt)
          generatedTokens = estimateTokens(text)
          timeToFirstTokenMs = max(1L, SystemClock.elapsedRealtime() - started)
          generationSpeed = generatedTokens * 1000.0 / max(1L, SystemClock.elapsedRealtime() - started)
          emitToken(text)
          emitDone()
        }
        snapshotPeakMemory()
        promise.resolve(true)
      } catch (error: Throwable) {
        emitError("Local streaming failed: ${error.message ?: error.javaClass.simpleName}")
        promise.reject("STREAM_FAILED", "Local streaming failed: ${error.message ?: error.javaClass.simpleName}", error)
      }
    }
  }

  @ReactMethod
  fun cancel(promise: Promise) {
    cancelled.set(true)
    activeGeneration?.cancel(true)
    promise.resolve(true)
  }

  @ReactMethod
  fun unload(promise: Promise) {
    closeLoadedModel()
    promise.resolve(true)
  }

  @ReactMethod
  fun dispose(promise: Promise) {
    closeLoadedModel()
    promise.resolve(true)
  }

  @ReactMethod
  fun isLoaded(promise: Promise) {
    promise.resolve(llm != null && loadedModel != null)
  }

  @ReactMethod
  fun getDiagnostics(promise: Promise) {
    promise.resolve(diagnosticsMap())
  }

  private fun startDownload(model: ModelRequest) {
    modelDir(model.id).mkdirs()
    prefs.edit()
      .putLong("${model.id}:expected_bytes", model.expectedSizeBytes)
      .putString("${model.id}:file_name", model.fileName)
      .remove("${model.id}:error")
      .apply()

    paused[model.id] = AtomicBoolean(false)
    setStatus(model.id, "downloading")

    worker.execute {
      val part = partialFile(model.id)
      val downloaded = if (part.exists()) part.length() else 0L
      val requestBuilder = Request.Builder().url(model.downloadUrl)
      if (downloaded > 0L) requestBuilder.addHeader("Range", "bytes=$downloaded-")
      try {
        client.newCall(requestBuilder.build()).also { downloads[model.id] = it }.execute().use { response ->
          if (!response.isSuccessful && response.code != 206) {
            throw IllegalStateException("Download failed with HTTP ${response.code}")
          }
          val body = response.body ?: throw IllegalStateException("Download response body was empty")
          val total = resolveTotalBytes(model, downloaded, body.contentLength())
          RandomAccessFile(part, "rw").use { output ->
            if (response.code == 206) output.seek(downloaded) else output.setLength(0)
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            var current = if (response.code == 206) downloaded else 0L
            body.byteStream().use { input ->
              while (true) {
                if (paused[model.id]?.get() == true) {
                  setStatus(model.id, "paused")
                  emitProgress(model, "paused", current, total, percent(current, total), null)
                  return@execute
                }
                val read = input.read(buffer)
                if (read == -1) break
                output.write(buffer, 0, read)
                current += read
                emitProgress(model, "downloading", current, total, percent(current, total), null)
              }
            }
          }
          setStatus(model.id, "installing")
          emitProgress(model, "installing", part.length(), total, 99, null)
          validateChecksumIfConfigured(model, part)
          val installed = finalFile(model)
          installed.parentFile?.mkdirs()
          if (installed.exists()) installed.delete()
          if (!part.renameTo(installed)) {
            part.copyTo(installed, overwrite = true)
            part.delete()
          }
          setStatus(model.id, "ready")
          emitProgress(model, "ready", installed.length(), total, 100, null)
        }
      } catch (error: Throwable) {
        if (paused[model.id]?.get() == true) return@execute
        setFailure(model.id, error.message ?: error.javaClass.simpleName)
        emitProgress(model, "failed", part.length(), expectedBytes(model.id), progressFor(model.id), error.message)
      } finally {
        downloads.remove(model.id)
      }
    }
  }

  private fun createMediaPipeInference(modelPath: String, maxTokens: Int, temp: Float): Any {
    val llmClass = Class.forName("com.google.mediapipe.tasks.genai.llminference.LlmInference")
    val optionsClass = Class.forName("com.google.mediapipe.tasks.genai.llminference.LlmInference\$LlmInferenceOptions")
    val builder = optionsClass.getMethod("builder").invoke(null)
      ?: throw IllegalStateException("MediaPipe options builder was not created")
    invokeIfPresent(builder, "setModelPath", arrayOf(String::class.java), modelPath)
    invokeIfPresent(builder, "setMaxTokens", arrayOf(Integer.TYPE), maxTokens)
    invokeIfPresent(builder, "setTemperature", arrayOf(java.lang.Float.TYPE), temp)
    invokeIfPresent(builder, "setTopK", arrayOf(Integer.TYPE), 40)
    val options = builder.javaClass.getMethod("build").invoke(builder)
      ?: throw IllegalStateException("MediaPipe options were not created")
    return llmClass.getMethod("createFromOptions", Context::class.java, optionsClass).invoke(null, context, options)
      ?: throw IllegalStateException("MediaPipe inference runtime was not created")
  }

  private fun tryGenerateAsync(prompt: String): Boolean {
    val instance = llm ?: throw IllegalStateException("No model is loaded")
    val listenerClass = Class.forName("com.google.mediapipe.tasks.genai.llminference.ProgressListener")
    var lastPartial = ""
    var callbackProducedText = false
    val doneSent = AtomicBoolean(false)
    val started = SystemClock.elapsedRealtime()
    val listener = Proxy.newProxyInstance(listenerClass.classLoader, arrayOf(listenerClass)) { _, method, args ->
      if (method.name == "run" && args != null && args.size >= 2) {
        val partial = args[0]?.toString() ?: ""
        val done = args[1] as? Boolean ?: false
        val delta = if (partial.startsWith(lastPartial)) partial.substring(lastPartial.length) else partial
        if (delta.isNotEmpty()) {
          if (!callbackProducedText) timeToFirstTokenMs = max(1L, SystemClock.elapsedRealtime() - started)
          callbackProducedText = true
          emitToken(delta)
        }
        lastPartial = partial
        if (done && doneSent.compareAndSet(false, true)) emitDone()
      }
      null
    }
    val future = instance.javaClass
      .getMethod("generateResponseAsync", String::class.java, listenerClass)
      .invoke(instance, prompt, listener) as Future<*>
    activeGeneration = future
    val result = future.get()?.toString() ?: lastPartial
    generatedTokens = estimateTokens(result)
    generationSpeed = generatedTokens * 1000.0 / max(1L, SystemClock.elapsedRealtime() - started)
    if (!callbackProducedText && result.isNotEmpty()) {
      timeToFirstTokenMs = max(1L, SystemClock.elapsedRealtime() - started)
      emitToken(result)
    }
    if (doneSent.compareAndSet(false, true)) emitDone()
    activeGeneration = null
    return true
  }

  private fun callGenerate(prompt: String): String {
    if (cancelled.get()) throw IllegalStateException("Generation cancelled")
    val instance = llm ?: throw IllegalStateException("No model is loaded")
    val result = instance.javaClass.getMethod("generateResponse", String::class.java).invoke(instance, prompt)
    if (cancelled.get()) throw IllegalStateException("Generation cancelled")
    return result?.toString() ?: ""
  }

  private fun ensureLoaded(maxTokens: Int, temp: Double): ModelRequest {
    val model = loadedModel
    if (llm != null && model != null) return model
    val activeId = prefs.getString("active_model_id", null) ?: throw IllegalStateException("No active model is selected")
    val fileName = prefs.getString("${activeId}:file_name", "$activeId.task") ?: "$activeId.task"
    val request = ModelRequest(activeId, activeId, "", fileName, "", expectedBytes(activeId))
    val final = finalFile(request)
    if (!final.exists()) throw IllegalStateException("Active model file is missing")
    llm = createMediaPipeInference(final.absolutePath, maxTokens, temp.toFloat())
    loadedModel = request
    return request
  }

  private fun closeLoadedModel() {
    val modelId = loadedModel?.id
    try {
      llm?.javaClass?.methods?.firstOrNull { it.name == "close" && it.parameterCount == 0 }?.invoke(llm)
    } catch (_: Throwable) {
      // Ignore close errors; unloading should never crash the app.
    }
    llm = null
    loadedModel = null
    if (modelId != null && getStatus(modelId) == "loaded") setStatus(modelId, "ready")
  }

  private fun validateChecksumIfConfigured(model: ModelRequest, file: File) {
    if (model.checksumSha256.isBlank()) return
    val actual = sha256(file)
    if (!actual.equals(model.checksumSha256, ignoreCase = true)) {
      file.delete()
      throw IllegalStateException("Checksum mismatch. Expected ${model.checksumSha256}, got $actual")
    }
  }

  private fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { input ->
      val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
      while (true) {
        val read = input.read(buffer)
        if (read == -1) break
        digest.update(buffer, 0, read)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  private fun stateMap(modelId: String): WritableMap {
    val map = Arguments.createMap()
    val status = getStatus(modelId)
    val expected = expectedBytes(modelId)
    val fileName = prefs.getString("${modelId}:file_name", "$modelId.task") ?: "$modelId.task"
    val final = File(modelDir(modelId), fileName)
    val partial = partialFile(modelId)
    val downloaded = when {
      final.exists() -> final.length()
      partial.exists() -> partial.length()
      else -> 0L
    }
    map.putString("modelId", modelId)
    map.putString("status", status)
    map.putInt("progress", progressFor(modelId))
    map.putBoolean("active", prefs.getString("active_model_id", null) == modelId)
    map.putDouble("installedSizeBytes", if (final.exists()) final.length().toDouble() else 0.0)
    map.putDouble("downloadedBytes", downloaded.toDouble())
    map.putDouble("totalBytes", expected.toDouble())
    prefs.getString("${modelId}:error", null)?.let { map.putString("error", it) }
    return map
  }

  private fun diagnosticsMap(): WritableMap {
    val map = Arguments.createMap()
    val model = loadedModel
    val runtime = Runtime.getRuntime()
    val usedBytes = runtime.totalMemory() - runtime.freeMemory()
    map.putString("provider", "mediapipe")
    map.putString("currentModel", model?.displayName ?: "")
    map.putInt("contextLength", 8192)
    map.putString("inferenceDevice", "Auto")
    map.putString("accelerator", "MediaPipe backend selection")
    map.putDouble("memoryUsageBytes", usedBytes.toDouble())
    map.putDouble("peakMemoryBytes", max(peakMemoryBytes, usedBytes).toDouble())
    map.putDouble("modelSizeBytes", model?.let { finalFile(it).length().toDouble() } ?: 0.0)
    map.putInt("promptTokens", promptTokens)
    map.putInt("generatedTokens", generatedTokens)
    map.putDouble("generationSpeedTokPerSec", generationSpeed)
    map.putDouble("temperature", temperature)
    map.putBoolean("loaded", llm != null)
    map.putString("hardwareAccelerationStatus", "Automatic when supported by MediaPipe")
    map.putString("cpuUsage", "Process CPU not sampled")
    map.putDouble("timeToFirstTokenMs", timeToFirstTokenMs.toDouble())
    map.putDouble("loadTimeMs", loadTimeMs.toDouble())
    return map
  }

  private fun emitProgress(model: ModelRequest, status: String, downloaded: Long, total: Long, progress: Int, error: String?) {
    val payload = Arguments.createMap()
    payload.putString("modelId", model.id)
    payload.putString("status", status)
    payload.putDouble("downloadedBytes", downloaded.toDouble())
    payload.putDouble("totalBytes", total.toDouble())
    payload.putInt("progress", progress)
    if (error != null) payload.putString("error", error)
    JarvisEventBus.emit("local_ai_model_progress", payload)
  }

  private fun emitToken(text: String) {
    JarvisEventBus.emit("local_ai_token", Arguments.createMap().apply { putString("text", text) })
  }

  private fun emitDone() {
    JarvisEventBus.emit("local_ai_done", Arguments.createMap())
  }

  private fun emitError(message: String) {
    JarvisEventBus.emit("local_ai_error", Arguments.createMap().apply { putString("message", message) })
  }

  private fun invokeIfPresent(target: Any, name: String, parameterTypes: Array<Class<*>>, vararg args: Any) {
    try {
      target.javaClass.getMethod(name, *parameterTypes).invoke(target, *args)
    } catch (_: NoSuchMethodException) {
      // Option is not supported by this MediaPipe version.
    }
  }

  private fun percent(current: Long, total: Long): Int {
    if (total <= 0L) return 0
    return ((current.toDouble() / total.toDouble()) * 100).roundToInt().coerceIn(0, 100)
  }

  private fun progressFor(modelId: String): Int = percent(
    if (finalFile(ModelRequest.placeholder(modelId)).exists()) expectedBytes(modelId) else partialFile(modelId).length(),
    expectedBytes(modelId),
  )

  private fun resolveTotalBytes(model: ModelRequest, alreadyDownloaded: Long, contentLength: Long): Long {
    val total = if (contentLength > 0L) alreadyDownloaded + contentLength else model.expectedSizeBytes
    prefs.edit().putLong("${model.id}:expected_bytes", total).apply()
    return total
  }

  private fun expectedBytes(modelId: String): Long = prefs.getLong("${modelId}:expected_bytes", 0L)
  private fun getStatus(modelId: String): String = prefs.getString("${modelId}:status", null) ?: inferStatus(modelId)
  private fun setStatus(modelId: String, status: String) = prefs.edit().putString("${modelId}:status", status).remove("${modelId}:error").apply()
  private fun setFailure(modelId: String, error: String) = prefs.edit().putString("${modelId}:status", "failed").putString("${modelId}:error", error).apply()
  private fun clearModelPrefs(modelId: String) = prefs.edit()
    .remove("${modelId}:status")
    .remove("${modelId}:error")
    .remove("${modelId}:expected_bytes")
    .remove("${modelId}:file_name")
    .apply()

  private fun inferStatus(modelId: String): String {
    val dir = modelDir(modelId)
    val hasTask = dir.listFiles()?.any { it.isFile && it.extension.lowercase(Locale.US) == "task" } == true
    return if (hasTask) "ready" else "not_installed"
  }

  private fun modelDir(modelId: String) = File(modelRoot, modelId)
  private fun partialFile(modelId: String) = File(modelDir(modelId), "download.partial")
  private fun finalFile(model: ModelRequest) = File(modelDir(model.id), model.fileName)

  private fun directorySize(file: File): Long {
    if (!file.exists()) return 0L
    if (file.isFile) return file.length()
    return file.listFiles()?.sumOf { directorySize(it) } ?: 0L
  }

  private fun deleteRecursivelySafe(file: File) {
    if (!file.exists()) return
    file.listFiles()?.forEach { deleteRecursivelySafe(it) }
    file.delete()
  }

  private fun estimateTokens(text: String): Int = text.trim().split(Regex("\\s+")).filter { it.isNotBlank() }.size

  private fun snapshotPeakMemory() {
    peakMemoryBytes = max(peakMemoryBytes, Debug.getNativeHeapAllocatedSize())
  }

  private data class ModelRequest(
    val id: String,
    val displayName: String,
    val downloadUrl: String,
    val fileName: String,
    val checksumSha256: String,
    val expectedSizeBytes: Long,
  ) {
    companion object {
      fun from(map: ReadableMap): ModelRequest {
        val id = map.getString("id") ?: throw IllegalArgumentException("Model id is required")
        val fileName = map.getString("fileName") ?: "$id.task"
        return ModelRequest(
          id = id,
          displayName = map.getString("displayName") ?: id,
          downloadUrl = map.getString("downloadUrl") ?: "",
          fileName = fileName,
          checksumSha256 = map.getString("checksumSha256") ?: "",
          expectedSizeBytes = if (map.hasKey("expectedSizeBytes")) map.getDouble("expectedSizeBytes").toLong() else 0L,
        )
      }

      fun placeholder(modelId: String) = ModelRequest(modelId, modelId, "", "$modelId.task", "", 0L)
    }
  }
}
