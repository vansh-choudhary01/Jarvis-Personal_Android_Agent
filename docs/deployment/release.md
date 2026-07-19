# Release

Jarvis is not production-release-ready yet. Treat current APKs as private sideload development builds.

## Before release

Required work before any real distribution:

- Move Brain lifecycle out of React Native UI runtime.
- Harden foreground/background execution.
- Add production logging and privacy controls.
- Add secure token/key handling.
- Add release signing.
- Remove development tokens.
- Validate permission flows across devices.
- Add crash reporting strategy that does not leak private screen/SMS/call data.
- Define model download licensing and provenance.

## Signing

Do not ship debug-signed APKs. Generate a private signing key and configure Gradle signing outside source control.

Never commit:

- signing keys
- keystore passwords
- API keys
- model download credentials
- private model files

## Distribution constraints

Jarvis uses powerful Android permissions and Accessibility control. The current permission set is intended for a phone the user owns and controls. It is not designed for Play Store distribution in its current form.

## Release checklist

- Build from a clean checkout.
- Run TypeScript checks.
- Run Android release build.
- Install on a physical device.
- Validate permission setup.
- Validate event observation.
- Validate task execution.
- Validate local model import/delete/offline test.
- Confirm logs do not expose secrets.
