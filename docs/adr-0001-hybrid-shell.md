# ADR 0001: Hybrid Shell Direction

## Status

Accepted

## Decision

OpenGravity will use a hybrid desktop architecture built around:

- Tauri 2 as the desktop shell
- a TypeScript frontend rendered in the OS webview
- Monaco Editor for the editor experience
- xterm.js for terminal rendering
- a Rust core process for shell orchestration and secure IPC
- C++ sidecars for heavy local execution

## Why

We want something more sensible than Electron without paying the full cost of building a desktop IDE shell completely from scratch.

This gives us:

- a lighter shell than Electron
- a cleaner native boundary for heavy logic
- room to keep the UI flexible
- an easier path to native performance where it actually matters

## Rejected Options

### Electron / Code-OSS fork

Rejected because the Chromium-based shell is heavier than we want and would push us back toward an Electron-first product identity.

### Full native Qt IDE

Rejected for now because it would force us to spend too much time rebuilding editor-shell fundamentals before differentiating on agent capability.

### Qt WebView / Qt WebEngine hybrid

Rejected as the primary path because the cross-platform story is uneven. Qt WebView avoids a full browser stack only where native APIs exist, but on Linux it depends on Qt WebEngine. Qt WebEngine itself is based on Chromium.

## Consequences

- We are no longer targeting a VS Code fork as the shell baseline
- The current TypeScript packages remain useful as product logic references and prototypes
- The future desktop app should evolve toward a Tauri app with a native-core-friendly boundary
