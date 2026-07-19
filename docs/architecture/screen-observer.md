# Screen Observer

## Purpose

Screen Observer converts Android Accessibility snapshots into a semantic screen model.

Primary implementation: `brain/src/screenObserver.ts`.

## Input

Android Accessibility can provide many low-level nodes:

- text
- content descriptions
- class names
- bounds
- clickability
- editability
- scrollability
- package names

## Output

The planner-facing model is concise:

```json
{
  "packageName": "com.android.settings",
  "title": "Settings",
  "buttons": ["Search settings"],
  "textFields": [],
  "text": ["Network & Internet", "Apps"],
  "dialogs": [],
  "scrollable": true
}
```

## Why the planner never parses raw nodes

Raw Accessibility trees are Android-specific, noisy, and unstable. If the planner learns raw node details, every future input source becomes harder to support.

The Screen Observer keeps the planner independent from Android. Later, a vision model, desktop automation layer, browser DOM observer, or PC companion can produce the same semantic screen model shape.

## Normalization rules

The observer should:

- remove empty/noisy nodes
- promote useful labels
- identify buttons, fields, lists, dialogs, and scroll state
- preserve bounds only where actions may need them
- summarize the screen for diagnostics

## Current limitation

Accessibility remains primary. Vision is planned only as a supplement for canvases, games, image-only UIs, maps, and custom controls.
