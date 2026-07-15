package com.yourname.jarvis

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Debug
import android.os.SystemClock
import android.provider.OpenableColumns
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
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
import java.time.Instant
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max
import kotlin.math.roundToInt

class LocalAiRuntimeModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val importRequestCode = 9217
  private val prefs = context.getSharedPreferences("jarvis_local_ai_runtime", Context.MODE_PRIVATE)
  private val client = OkHttpClient.Builder().retryOnConnectionFailure(true).build()
  private val worker = Executors.newSingleThreadExecutor()
  private val downloads = ConcurrentHashMap<String, Call>()
  private val paused = ConcurrentHashMap<String, AtomicBoolean>()
  private val lastProgressEmitAt = ConcurrentHashMap<String, Long>()
  private val lastProgressEmitPercent = ConcurrentHashMap<String, Int>()
  private val modelRoot = File(context.filesDir, "jarvis_models")

  private var llm: Any? = null
  private var liteRtEngine: Any? = null
  private var loadedModel: ModelRequest? = null
  private var loadedProvider = "mediapipe"
  private var activeGeneration: Future<*>? = null
  private var cancelled = AtomicBoolean(false)
  private var promptTokens = 0
  private var generatedTokens = 0
  private var generationSpeed = 0.0
  private var timeToFirstTokenMs = 0L
  private var loadTimeMs = 0L
  private var temperature = 0.3
  private var peakMemoryBytes = 0L
  private var pendingImportPromise: Promise? = null
  private var pendingImportModel: ModelRequest? = null

  private val activityListener = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode != importRequestCode) return
      val promise = pendingImportPromise ?: return
      val model = pendingImportModel
      pendingImportPromise = null
      pendingImportModel = null

      if (resultCode != Activity.RESULT_OK || data?.data == null || model == null) {
        promise.reject("IMPORT_CANCELLED", "Model import was cancelled.")
        return
      }
      importModelUri(model, data.data!!, promise)
    }
  }

  init {
    context.addActivityEventListener(activityListener)
  }

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
    map.putString("provider", "local-ai")
    try {
      Class.forName("com.google.mediapipe.tasks.genai.llminference.LlmInference")
      Class.forName("com.google.ai.edge.litertlm.Engine")
      map.putBoolean("available", true)
      map.putString("reason", "MediaPipe LLM Inference and LiteRT-LM runtimes are packaged.")
    } catch (error: Throwable) {
      map.putBoolean("available", false)
      map.putString("reason", "Local AI runtime is not available on this device: ${rootCauseMessage(error)}")
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
  fun getHuggingFaceTokenConfigured(promise: Promise) {
    promise.resolve(!prefs.getString("huggingface_token", "").isNullOrBlank())
  }

  @ReactMethod
  fun setHuggingFaceToken(token: String, promise: Promise) {
    val clean = token.trim()
    if (!clean.startsWith("hf_")) {
      promise.reject("INVALID_HF_TOKEN", "Hugging Face token should start with hf_.")
      return
    }
    prefs.edit().putString("huggingface_token", clean).apply()
    promise.resolve(true)
  }

  @ReactMethod
  fun clearHuggingFaceToken(promise: Promise) {
    prefs.edit().remove("huggingface_token").apply()
    promise.resolve(true)
  }

  @ReactMethod
  fun downloadModel(model: ReadableMap, promise: Promise) {
    val request = ModelRequest.from(model)
    if (request.downloadUrl.isBlank()) {
      modelDir(request.id).mkdirs()
      if (request.licenseRequired) {
        setFailure(request.id, "This official Google model requires license acceptance before download. Open the model page, accept the license, download the .${request.format} file, then import it here.", "needs_license_acceptance")
        emitProgress(request, "needs_license_acceptance", 0, 0, 0, "License acceptance is required before Jarvis can import this model.")
        promise.reject("LICENSE_REQUIRED", "This model requires license acceptance. Open the model page, download the .${request.format} file, then import it in Jarvis.")
      } else {
        setFailure(request.id, "No direct MediaPipe .task/.litertlm download URL is configured for this model yet.", "missing")
        emitProgress(request, "missing", 0, 0, 0, "No direct MediaPipe .task/.litertlm download URL is configured for this model yet.")
        promise.reject("MODEL_URL_MISSING", "No direct MediaPipe .task/.litertlm download URL is configured for this model yet.")
      }
      return
    }
    startDownload(request)
    promise.resolve(true)
  }

  @ReactMethod
  fun openModelPage(url: String, promise: Promise) {
    try {
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject("OPEN_MODEL_PAGE_FAILED", "Could not open model page: ${error.message ?: error.javaClass.simpleName}", error)
    }
  }

  @ReactMethod
  fun importModelFromPicker(model: ReadableMap, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "Jarvis must be open to import a model.")
      return
    }
    if (pendingImportPromise != null) {
      promise.reject("IMPORT_IN_PROGRESS", "Another model import is already waiting for a file.")
      return
    }
    val request = ModelRequest.from(model)
    pendingImportPromise = promise
    pendingImportModel = request
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "*/*"
      putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/octet-stream", "application/x-mediapipe-model", "application/x-litertlm"))
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    activity.startActivityForResult(intent, importRequestCode)
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
          setFailure(request.id, "Model file is missing from private storage.", "missing")
          promise.reject("MODEL_MISSING", "Model is not installed: ${request.displayName}")
          return@execute
        }
        setStatus(request.id, "loading")
        val started = SystemClock.elapsedRealtime()
        closeLoadedModel()
        if (request.usesLiteRtLm()) {
          liteRtEngine = createLiteRtLmEngine(file.absolutePath)
          loadedProvider = "litert-lm"
        } else {
          llm = createMediaPipeInference(file.absolutePath, maxTokens, temp.toFloat())
          loadedProvider = "mediapipe"
        }
        loadedModel = request
        loadTimeMs = SystemClock.elapsedRealtime() - started
        temperature = temp
        setStatus(request.id, "loaded")
        prefs.edit().putString("active_model_id", request.id).apply()
        snapshotPeakMemory()
        promise.resolve(true)
      } catch (error: Throwable) {
        val message = rootCauseMessage(error)
        setFailure(request.id, "Model load failed: $message")
        promise.reject("MODEL_LOAD_FAILED", "Model load failed: $message", error)
      }
    }
  }

  @ReactMethod
  fun generate(prompt: String, maxTokens: Int, temp: Double, promise: Promise) {
    worker.execute {
      var model: ModelRequest? = null
      try {
        model = ensureLoaded(maxTokens, temp)
        setStatus(model!!.id, "running")
        val started = SystemClock.elapsedRealtime()
        cancelled.set(false)
        promptTokens = estimateTokens(prompt)
        val text = if (model!!.usesLiteRtLm()) {
          callLiteRtLmGenerateWithTimeout(prompt, liteRtGenerationTimeoutMs(model))
        } else {
          callGenerate(prompt)
        }
        generatedTokens = estimateTokens(text)
        val elapsed = max(1L, SystemClock.elapsedRealtime() - started)
        timeToFirstTokenMs = elapsed
        generationSpeed = generatedTokens * 1000.0 / elapsed
        snapshotPeakMemory()
        val map = Arguments.createMap()
        map.putString("text", text)
        map.putString("modelId", model!!.id)
        map.putInt("tokensGenerated", generatedTokens)
        setStatus(model!!.id, "loaded")
        promise.resolve(map)
      } catch (error: Throwable) {
        model?.id?.let { setStatus(it, "loaded") }
        promise.reject("GENERATION_FAILED", "Local generation failed: ${rootCauseMessage(error)}", error)
      }
    }
  }

  @ReactMethod
  fun stream(prompt: String, maxTokens: Int, temp: Double, promise: Promise) {
    worker.execute {
      var model: ModelRequest? = null
      try {
        model = ensureLoaded(maxTokens, temp)
        setStatus(model!!.id, "running")
        cancelled.set(false)
        promptTokens = estimateTokens(prompt)
        val started = SystemClock.elapsedRealtime()
        val usedNativeStreaming = if (model?.usesLiteRtLm() == true) {
          val text = callLiteRtLmGenerateWithTimeout(prompt, liteRtGenerationTimeoutMs(model))
          generatedTokens = estimateTokens(text)
          timeToFirstTokenMs = max(1L, SystemClock.elapsedRealtime() - started)
          generationSpeed = generatedTokens * 1000.0 / max(1L, SystemClock.elapsedRealtime() - started)
          emitToken(text)
          emitDone()
          true
        } else {
          tryGenerateAsync(prompt)
        }
        if (!usedNativeStreaming) {
          val text = callGenerate(prompt)
          generatedTokens = estimateTokens(text)
          timeToFirstTokenMs = max(1L, SystemClock.elapsedRealtime() - started)
          generationSpeed = generatedTokens * 1000.0 / max(1L, SystemClock.elapsedRealtime() - started)
          emitToken(text)
          emitDone()
        }
        snapshotPeakMemory()
        model?.id?.let { setStatus(it, "loaded") }
        promise.resolve(true)
      } catch (error: Throwable) {
        val message = rootCauseMessage(error)
        model?.id?.let { setStatus(it, "loaded") }
        emitError("Local streaming failed: $message")
        promise.reject("STREAM_FAILED", "Local streaming failed: $message", error)
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
    promise.resolve((llm != null || liteRtEngine != null) && loadedModel != null)
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
      .putString("${model.id}:runtime", model.runtime)
      .remove("${model.id}:error")
      .apply()

    paused[model.id] = AtomicBoolean(false)
    setStatus(model.id, "downloading")

    worker.execute {
      val part = partialFile(model.id)
      val downloaded = if (part.exists()) part.length() else 0L
      emitProgress(model, "downloading", downloaded, model.expectedSizeBytes, percent(downloaded, model.expectedSizeBytes), null)
      val requestBuilder = Request.Builder().url(model.downloadUrl)
      if (downloaded > 0L) requestBuilder.addHeader("Range", "bytes=$downloaded-")
      prefs.getString("huggingface_token", null)?.takeIf { it.isNotBlank() }?.let {
        requestBuilder.addHeader("Authorization", "Bearer $it")
      }
      try {
        client.newCall(requestBuilder.build()).also { downloads[model.id] = it }.execute().use { response ->
          if (response.code == 401 || response.code == 403) {
            throw LicenseRequiredException("Hugging Face blocked this gated model. Accept the model license and save a Hugging Face access token in Jarvis, then tap Download again.")
          }
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
          benchmarkAndValidate(model, installed)
          emitProgress(model, "ready", installed.length(), total, 100, null)
        }
      } catch (error: Throwable) {
        if (paused[model.id]?.get() == true) return@execute
        val root = rootCause(error)
        val message = rootCauseMessage(error)
        val status = if (root is LicenseRequiredException) "needs_license_acceptance" else modelStatusForError(message)
        setFailure(model.id, message, status)
        emitProgress(model, "failed", part.length(), expectedBytes(model.id), progressFor(model.id), message)
      } finally {
        downloads.remove(model.id)
      }
    }
  }

  private fun importModelUri(model: ModelRequest, uri: Uri, promise: Promise) {
    worker.execute {
      val displayName = displayNameForUri(uri)
      val extension = displayName.substringAfterLast('.', "").lowercase(Locale.US)
      if (extension != "task" && extension != "litertlm") {
        modelDir(model.id).mkdirs()
        setFailure(model.id, "Unsupported model format .$extension. Jarvis only accepts MediaPipe .task or LiteRT-LM .litertlm files.", "unsupported")
        promise.reject("UNSUPPORTED_MODEL_FORMAT", "Unsupported model format .$extension. Select a .task or .litertlm file.")
        return@execute
      }

      try {
        modelDir(model.id).mkdirs()
        setStatus(model.id, "installing")
        val targetFileName = importedModelFileName(model, displayName, extension)
        val importModel = model.copy(fileName = targetFileName, format = extension)
        val target = finalFile(importModel)
        if (target.exists()) target.delete()
        context.contentResolver.openInputStream(uri).use { input ->
          if (input == null) throw IllegalStateException("Could not open selected model file")
          target.outputStream().use { output -> input.copyTo(output) }
        }
        prefs.edit()
          .putLong("${model.id}:expected_bytes", target.length())
          .putString("${model.id}:file_name", targetFileName)
          .putString("${model.id}:runtime", importModel.runtime)
          .putString("${model.id}:format", extension)
          .putString("${model.id}:imported_file_name", displayName)
          .putString("${model.id}:storage_path", target.absolutePath)
          .remove("${model.id}:error")
          .apply()
        validateChecksumIfConfigured(importModel, target)
        benchmarkAndValidate(importModel, target)
        promise.resolve(stateMap(model.id))
      } catch (error: Throwable) {
        val message = rootCauseMessage(error)
        setFailure(model.id, "Invalid model: $message", modelStatusForError(message))
        promise.reject("MODEL_IMPORT_FAILED", "Model import failed: $message", error)
      }
    }
  }

  private fun benchmarkAndValidate(model: ModelRequest, file: File) {
    setStatus(model.id, "benchmarking")
    if (model.usesLiteRtLm() && file.length() >= 3L * 1024L * 1024L * 1024L) {
      prefs.edit()
        .putString("${model.id}:runtime", model.runtime)
        .putString("${model.id}:format", model.format)
        .putString("${model.id}:storage_path", file.absolutePath)
        .putString("active_model_id", model.id)
        .apply()
      setStatus(model.id, "ready")
      return
    }
    val initializedAt = SystemClock.elapsedRealtime()
    val beforeLoad = Debug.getNativeHeapAllocatedSize()
    val engineOrInference = try {
      if (model.usesLiteRtLm()) createLiteRtLmEngine(file.absolutePath) else createMediaPipeInference(file.absolutePath, 128, 0.3f)
    } catch (error: Throwable) {
      val message = rootCauseMessage(error)
      setFailure(model.id, "Unsupported or invalid model: $message", modelStatusForError(message))
      throw error
    }
    val loadMs = SystemClock.elapsedRealtime() - initializedAt
    try {
      val generationStarted = SystemClock.elapsedRealtime()
      val text = if (model.usesLiteRtLm()) {
        callLiteRtLmGenerate(engineOrInference, "Hello")
      } else {
        engineOrInference.javaClass.getMethod("generateResponse", String::class.java).invoke(engineOrInference, "Hello")?.toString() ?: ""
      }
      val totalMs = max(1L, SystemClock.elapsedRealtime() - generationStarted)
      val tokens = estimateTokens(text)
      val currentRam = Debug.getNativeHeapAllocatedSize()
      val peak = max(peakMemoryBytes, max(beforeLoad, currentRam))
      peakMemoryBytes = peak
      promptTokens = 1
      generatedTokens = tokens
      loadTimeMs = loadMs
      timeToFirstTokenMs = totalMs
      generationSpeed = tokens * 1000.0 / totalMs
      val backendLabel = if (model.usesLiteRtLm()) "LiteRT-LM CPU" else "MediaPipe Auto"
      val benchmarkJson = """
        {"loadTimeMs":$loadMs,"timeToFirstTokenMs":$totalMs,"tokensPerSecond":$generationSpeed,"peakRamBytes":$peak,"currentRamBytes":$currentRam,"backend":"$backendLabel","initializationTimeMs":$loadMs,"generatedTokens":$tokens,"validatedAt":"${Instant.now()}"}
      """.trimIndent()
      prefs.edit()
        .putString("${model.id}:benchmark_json", benchmarkJson)
        .putString("${model.id}:runtime", model.runtime)
        .putString("${model.id}:format", model.format)
        .putString("${model.id}:storage_path", file.absolutePath)
        .putString("active_model_id", model.id)
        .apply()
      setStatus(model.id, "ready")
    } finally {
      try {
        if (model.usesLiteRtLm()) {
          closeReflective(engineOrInference)
        } else {
          engineOrInference.javaClass.methods.firstOrNull { it.name == "close" && it.parameterCount == 0 }?.invoke(engineOrInference)
        }
      } catch (_: Throwable) {
        // Ignore close failures after validation.
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

  private fun createLiteRtLmEngine(modelPath: String): Any {
    val backendBaseClass = Class.forName("com.google.ai.edge.litertlm.Backend")
    val cpuBackendClass = Class.forName("com.google.ai.edge.litertlm.Backend\$CPU")
    val engineConfigClass = Class.forName("com.google.ai.edge.litertlm.EngineConfig")
    val engineClass = Class.forName("com.google.ai.edge.litertlm.Engine")
    val cpuBackend = cpuBackendClass.getConstructor().newInstance()
    val config = engineConfigClass
      .getConstructor(
        String::class.java,
        backendBaseClass,
        backendBaseClass,
        backendBaseClass,
        Integer::class.java,
        Integer::class.java,
        String::class.java,
      )
      .newInstance(
        modelPath,
        cpuBackend,
        null,
        null,
        null,
        null,
        context.cacheDir.absolutePath,
      )
    val engine = engineClass.getConstructor(engineConfigClass).newInstance(config)
    engineClass.getMethod("initialize").invoke(engine)
    return engine
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

  private fun callLiteRtLmGenerate(prompt: String): String {
    if (cancelled.get()) throw IllegalStateException("Generation cancelled")
    val engine = liteRtEngine ?: throw IllegalStateException("No LiteRT-LM model is loaded")
    val result = callLiteRtLmGenerate(engine, prompt)
    if (cancelled.get()) throw IllegalStateException("Generation cancelled")
    return result
  }

  private fun callLiteRtLmGenerateWithTimeout(prompt: String, timeoutMs: Long): String {
    if (cancelled.get()) throw IllegalStateException("Generation cancelled")
    val executor = Executors.newSingleThreadExecutor()
    val future = executor.submit<String> { callLiteRtLmGenerate(prompt) }
    activeGeneration = future
    return try {
      future.get(timeoutMs, TimeUnit.MILLISECONDS)
    } catch (error: TimeoutException) {
      future.cancel(true)
      throw IllegalStateException("LiteRT-LM generation timed out after ${timeoutMs / 1000}s. This model is still too slow on the current backend; try a smaller LiteRT-LM model or a shorter prompt.")
    } finally {
      activeGeneration = null
      executor.shutdownNow()
    }
  }

  private fun liteRtGenerationTimeoutMs(model: ModelRequest?): Long {
    val sizeBytes = model?.expectedSizeBytes?.takeIf { it > 0L } ?: model?.let { finalFile(it).length() } ?: 0L
    return if (sizeBytes >= 3L * 1024L * 1024L * 1024L) 10L * 60L * 1000L else 3L * 60L * 1000L
  }

  private fun callLiteRtLmGenerate(engine: Any, prompt: String): String {
    val conversationConfigClass = Class.forName("com.google.ai.edge.litertlm.ConversationConfig")
    val conversationConfig = conversationConfigClass.getConstructor().newInstance()
    val conversation = engine.javaClass.getMethod("createConversation", conversationConfigClass).invoke(engine, conversationConfig)
      ?: throw IllegalStateException("LiteRT-LM conversation was not created")
    return try {
      val emptyContext = emptyMap<String, Any>()
      val message = conversation.javaClass
        .getMethod("sendMessage", String::class.java, Map::class.java)
        .invoke(conversation, prompt, emptyContext)
        ?: return ""
      val rendered = conversation.javaClass
        .getMethod("renderMessageIntoString", message.javaClass, Map::class.java)
        .invoke(conversation, message, emptyContext)
      rendered?.toString() ?: message.toString()
    } finally {
      closeReflective(conversation)
    }
  }

  private fun closeReflective(target: Any?) {
    if (target == null) return
    try {
      target.javaClass.methods.firstOrNull { it.name == "close" && it.parameterCount == 0 }?.invoke(target)
    } catch (_: Throwable) {
      // Ignore close failures; unloading should never crash the app.
    }
  }

  private fun ensureLoaded(maxTokens: Int, temp: Double): ModelRequest {
    val model = loadedModel
    if (llm != null && model != null) return model
    val activeId = prefs.getString("active_model_id", null) ?: throw IllegalStateException("No active model is selected")
    val fileName = prefs.getString("${activeId}:file_name", "$activeId.task") ?: "$activeId.task"
    val request = ModelRequest(
      activeId,
      activeId,
      "",
      "",
      fileName,
      prefs.getString("${activeId}:runtime", if (fileName.endsWith(".litertlm")) "litert-lm" else "mediapipe") ?: "mediapipe",
      prefs.getString("${activeId}:format", fileName.substringAfterLast('.', "task")) ?: "task",
      "",
      expectedBytes(activeId),
      false,
    )
    val final = finalFile(request)
    if (!final.exists()) throw IllegalStateException("Active model file is missing")
    if (request.usesLiteRtLm()) {
      liteRtEngine = createLiteRtLmEngine(final.absolutePath)
      loadedProvider = "litert-lm"
    } else {
      llm = createMediaPipeInference(final.absolutePath, maxTokens, temp.toFloat())
      loadedProvider = "mediapipe"
    }
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
    try {
      closeReflective(liteRtEngine)
    } catch (_: Throwable) {
      // Ignore close errors; unloading should never crash the app.
    }
    llm = null
    liteRtEngine = null
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
    map.putString("runtime", prefs.getString("${modelId}:runtime", if (final.extension.lowercase(Locale.US) == "litertlm") "litert-lm" else "mediapipe"))
    map.putString("format", prefs.getString("${modelId}:format", final.extension.lowercase(Locale.US)))
    map.putString("storagePath", prefs.getString("${modelId}:storage_path", final.absolutePath))
    map.putString("importedFileName", prefs.getString("${modelId}:imported_file_name", null))
    map.putString("benchmarkJson", prefs.getString("${modelId}:benchmark_json", null))
    prefs.getString("${modelId}:error", null)?.let { map.putString("error", it) }
    return map
  }

  private fun diagnosticsMap(): WritableMap {
    val map = Arguments.createMap()
    val model = loadedModel
    val runtime = Runtime.getRuntime()
    val usedBytes = runtime.totalMemory() - runtime.freeMemory()
    map.putString("provider", loadedProvider)
    map.putString("currentModel", model?.displayName ?: "")
    map.putInt("contextLength", 8192)
    map.putString("inferenceDevice", if (loadedProvider == "litert-lm") "LiteRT-LM CPU" else "MediaPipe Auto")
    map.putString("backend", if (loadedProvider == "litert-lm") "LiteRT-LM CPU" else "MediaPipe Auto")
    map.putString("accelerator", if (loadedProvider == "litert-lm") "LiteRT-LM backend selection" else "MediaPipe backend selection")
    map.putDouble("memoryUsageBytes", usedBytes.toDouble())
    map.putDouble("peakMemoryBytes", max(peakMemoryBytes, usedBytes).toDouble())
    map.putDouble("modelSizeBytes", model?.let { finalFile(it).length().toDouble() } ?: 0.0)
    map.putInt("promptTokens", promptTokens)
    map.putInt("generatedTokens", generatedTokens)
    map.putDouble("generationSpeedTokPerSec", generationSpeed)
    map.putDouble("temperature", temperature)
    map.putBoolean("loaded", llm != null || liteRtEngine != null)
    map.putString("hardwareAccelerationStatus", if (loadedProvider == "litert-lm") "LiteRT-LM backend configured to CPU for compatibility" else "Automatic when supported by MediaPipe")
    map.putString("cpuUsage", "Process CPU not sampled")
    map.putDouble("timeToFirstTokenMs", timeToFirstTokenMs.toDouble())
    map.putDouble("loadTimeMs", loadTimeMs.toDouble())
    map.putDouble("initializationTimeMs", loadTimeMs.toDouble())
    map.putString("modelFormat", model?.format ?: "")
    map.putString("storagePath", model?.let { finalFile(it).absolutePath } ?: "")
    map.putBoolean("streamingEnabled", true)
    return map
  }

  private fun emitProgress(model: ModelRequest, status: String, downloaded: Long, total: Long, progress: Int, error: String?) {
    if (status == "downloading") {
      val now = SystemClock.elapsedRealtime()
      val lastAt = lastProgressEmitAt[model.id] ?: 0L
      val lastPercent = lastProgressEmitPercent[model.id] ?: -1
      val enoughTimePassed = now - lastAt >= 500L
      val meaningfulProgress = progress != lastPercent
      if (!enoughTimePassed && !meaningfulProgress) return
      lastProgressEmitAt[model.id] = now
      lastProgressEmitPercent[model.id] = progress
    } else {
      lastProgressEmitAt.remove(model.id)
      lastProgressEmitPercent.remove(model.id)
    }
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

  private fun rootCause(error: Throwable): Throwable {
    var current = error
    val seen = mutableSetOf<Throwable>()
    while (current.cause != null && current.cause !== current && !seen.contains(current.cause)) {
      seen.add(current)
      current = current.cause!!
    }
    return current
  }

  private fun rootCauseMessage(error: Throwable): String {
    val root = rootCause(error)
    val message = root.message?.takeIf { it.isNotBlank() } ?: root.javaClass.simpleName
    if (message.contains("SentencePiece tokenizer is not found", ignoreCase = true)) {
      return "Unsupported model package: tokenizer missing. Import a complete MediaPipe .task or LiteRT-LM .litertlm package that includes tokenizer assets."
    }
    return if (root === error) message else "$message (${error.javaClass.simpleName})"
  }

  private fun modelStatusForError(message: String): String = when {
    message.contains("Checksum", ignoreCase = true) -> "corrupted"
    message.contains("tokenizer missing", ignoreCase = true) -> "unsupported"
    message.contains("unsupported", ignoreCase = true) -> "unsupported"
    else -> "failed"
  }

  private fun importedModelFileName(model: ModelRequest, displayName: String, extension: String): String {
    val base = displayName.substringBeforeLast('.', model.id)
      .replace(Regex("[^A-Za-z0-9._-]+"), "-")
      .trim('-', '.', '_')
      .takeIf { it.isNotBlank() }
      ?: model.id
    return "$base.$extension"
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
  private fun getStatus(modelId: String): String {
    val stored = prefs.getString("${modelId}:status", null)
    if (stored == "downloading" && !downloads.containsKey(modelId)) {
      return if (partialFile(modelId).exists()) "paused" else inferStatus(modelId)
    }
    if ((stored == "benchmarking" || stored == "loading" || stored == "running") && loadedModel?.id != modelId && inferStatus(modelId) == "ready") {
      return "ready"
    }
    return stored ?: inferStatus(modelId)
  }
  private fun setStatus(modelId: String, status: String) = prefs.edit().putString("${modelId}:status", status).remove("${modelId}:error").apply()
  private fun setFailure(modelId: String, error: String, status: String = "failed") =
    prefs.edit().putString("${modelId}:status", status).putString("${modelId}:error", error).apply()
  private fun clearModelPrefs(modelId: String) = prefs.edit()
    .remove("${modelId}:status")
    .remove("${modelId}:error")
    .remove("${modelId}:expected_bytes")
    .remove("${modelId}:file_name")
    .remove("${modelId}:format")
    .remove("${modelId}:imported_file_name")
    .remove("${modelId}:storage_path")
    .remove("${modelId}:benchmark_json")
    .apply()

  private fun inferStatus(modelId: String): String {
    val dir = modelDir(modelId)
    val hasTask = dir.listFiles()?.any {
      it.isFile && (it.extension.lowercase(Locale.US) == "task" || it.extension.lowercase(Locale.US) == "litertlm")
    } == true
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

  private fun displayNameForUri(uri: Uri): String {
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
      if (cursor.moveToFirst()) {
        val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (index >= 0) return cursor.getString(index)
      }
    }
    return uri.lastPathSegment ?: "selected-model"
  }

  private fun snapshotPeakMemory() {
    peakMemoryBytes = max(peakMemoryBytes, Debug.getNativeHeapAllocatedSize())
  }

  private data class ModelRequest(
    val id: String,
    val displayName: String,
    val downloadUrl: String,
    val modelPageUrl: String,
    val fileName: String,
    val runtime: String,
    val format: String,
    val checksumSha256: String,
    val expectedSizeBytes: Long,
    val licenseRequired: Boolean,
  ) {
    fun usesLiteRtLm(): Boolean = runtime == "litert-lm" || format == "litertlm"

    companion object {
      fun from(map: ReadableMap): ModelRequest {
        val id = map.getString("id") ?: throw IllegalArgumentException("Model id is required")
        val fileName = map.getString("fileName") ?: "$id.task"
        return ModelRequest(
          id = id,
          displayName = map.getString("displayName") ?: id,
          downloadUrl = map.getString("downloadUrl") ?: "",
          modelPageUrl = map.getString("modelPageUrl") ?: "",
          fileName = fileName,
          runtime = map.getString("runtime") ?: if (fileName.endsWith(".litertlm")) "litert-lm" else "mediapipe",
          format = map.getString("format") ?: fileName.substringAfterLast('.', "task"),
          checksumSha256 = map.getString("checksumSha256") ?: "",
          expectedSizeBytes = if (map.hasKey("expectedSizeBytes")) map.getDouble("expectedSizeBytes").toLong() else 0L,
          licenseRequired = map.hasKey("licenseRequired") && map.getBoolean("licenseRequired"),
        )
      }

      fun placeholder(modelId: String) = ModelRequest(modelId, modelId, "", "", "$modelId.task", "mediapipe", "task", "", 0L, false)
    }
  }

  private class LicenseRequiredException(message: String) : Exception(message)
}
