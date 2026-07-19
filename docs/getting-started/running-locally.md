# Running locally

## Windows path rule

Use different paths for Metro and Gradle:

- Metro runs from the real `C:\...` project path.
- Gradle/CMake builds run from a short `subst` path such as `X:\mobile`.

This avoids two separate Windows issues:

- Metro can fail on `subst` drives because the file hasher resolves real paths internally.
- Gradle/CMake can fail from the deep real path because generated native paths exceed Windows path limits.

Create the short drive once per terminal session:

```powershell
subst X: /D 2>$null
subst X: "C:\Users\HP\Documents\Codex\2026-07-11\files-mentioned-by-the-user-build\outputs\jarvis"
```

## Start Metro

Start Metro from the real path:

```powershell
cd "C:\Users\HP\Documents\Codex\2026-07-11\files-mentioned-by-the-user-build\outputs\jarvis\mobile"
npm.cmd start -- --reset-cache --port 8081
```

Do not start Metro from `X:\...`.

## Build and install Android

In a second terminal:

```powershell
subst X: /D 2>$null
subst X: "C:\Users\HP\Documents\Codex\2026-07-11\files-mentioned-by-the-user-build\outputs\jarvis"
cd X:\mobile
$env:Path = "$env:LOCALAPPDATA\Android\Sdk\platform-tools;$env:Path"
npm.cmd run android -- --device ZD222TQVPK --port 8081 --no-packager
```

Replace `ZD222TQVPK` with the id from:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices
```

`--no-packager` is intentional because Metro is already running.

## Embedded Android mode

Embedded mode uses the Brain bundled into the app:

```ts
// mobile/src/config.ts
brainWebSocketUrl: 'local://embedded-brain',
phoneAuthToken: '',
```

The app starts the embedded Brain after required permissions are ready.

## Laptop Brain mode

Laptop Brain mode connects the phone to `localhost:3000` through ADB reverse:

```ts
// mobile/src/config.ts
brainWebSocketUrl: 'ws://127.0.0.1:3000/phone',
phoneAuthToken: 'jarvis-local-emulator-dev-token-2026',
```

Start the Brain:

```powershell
cd "C:\Users\HP\Documents\Codex\2026-07-11\files-mentioned-by-the-user-build\outputs\jarvis\brain"
npm.cmd run build
npm.cmd start
```

Reverse ports:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" -s ZD222TQVPK reverse tcp:3000 tcp:3000
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" -s ZD222TQVPK reverse tcp:8081 tcp:8081
```

Verify:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3000/health
Invoke-WebRequest -UseBasicParsing http://localhost:8081/status
```

## Port cleanup

Inspect common development ports:

```powershell
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { 3000,8081,8082,8083,19000,19001,5037 -contains $_.LocalPort } |
  Select-Object LocalPort, OwningProcess
```

Only stop a process if you recognize it as stale Metro, Node, or ADB.
