# Build

## Debug build

Use the Windows split-path setup:

```powershell
subst X: /D 2>$null
subst X: "C:\Users\HP\Documents\Codex\2026-07-11\files-mentioned-by-the-user-build\outputs\jarvis"
```

Start Metro from the real path:

```powershell
cd "C:\Users\HP\Documents\Codex\2026-07-11\files-mentioned-by-the-user-build\outputs\jarvis\mobile"
npm.cmd start -- --reset-cache --port 8081
```

Build from the short path:

```powershell
cd X:\mobile\android
.\gradlew.bat --no-daemon :app:assembleDebug -PreactNativeArchitectures=arm64-v8a
```

Install:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" -s ZD222TQVPK install -r "X:\mobile\android\app\build\outputs\apk\debug\app-debug.apk"
```

## Clean generated artifacts

Only clean generated artifacts. Do not patch Gradle or React Native internals to hide mixed-root problems.

```powershell
cd X:\mobile\android
.\gradlew.bat --stop
Remove-Item -LiteralPath .\build -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath .\app\build -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath .\app\.cxx -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath .\.gradle -Recurse -Force -ErrorAction SilentlyContinue
```

For long generated paths:

```powershell
[System.IO.Directory]::Delete("\\?\X:\mobile\android\app\build", $true)
[System.IO.Directory]::Delete("\\?\X:\mobile\android\app\.cxx", $true)
```

## Common build symptoms

- `Unable to load script`: Metro is not reachable or ADB reverse is missing.
- React Native asks to use `8082`: Metro is already running; use `--no-packager` when installing.
- CMake path errors: build from `X:\mobile`, not the deep `C:\...` path.
- Metro SHA-1/hash errors: start Metro from real `C:\...`, not `X:\...`.
