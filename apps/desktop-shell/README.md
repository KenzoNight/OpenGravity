# Desktop Shell

This application will eventually host the OpenGravity desktop experience on top of a Tauri 2 shell.

Near-term goals:

- keep shell concerns separate from runtime concerns
- make OpenGravity panels easy to iterate on
- avoid coupling core logic to a specific UI implementation too early
- keep provider and model setup available without crowding the main workbench

Target shape:

- Tauri 2 for windowing, tray, permissions, and IPC
- a React/TypeScript frontend running inside the system webview
- Monaco for the editor surface
- xterm.js for the terminal surface
- Rust core process plus C++ sidecars for heavy local work

Run paths:

- `npm run app:dev` from the repo root launches the native Tauri shell
- `npm run app:check` from the repo root verifies the Rust/Tauri layer
- `npm run app:web-build` from the repo root builds the frontend bundle only

Current shell prototype includes:

- workbench-style window chrome, explorer, editor column, and agent dock
- setup-required state when no provider is configured
- provider settings overlay for BYOK, active model selection, fallback controls, and multi-account pools
- Gemini AI Studio keys through the Gemini OpenAI-compatible route
- desktop-safe local persistence for prototype settings
- workspace file loading and saving through Tauri commands
- external file drag-and-drop with open and save support
- Monaco editor integration with file-aware language detection
- guarded workspace command execution inside the native shell
- xterm-based streaming command sessions with cancel support
- live OpenRouter catalog discovery with free-model selection
- workflow execution tracking for recommended build and repair plans
- Ask, Planning, and Agent chat modes with mode-safe restrictions
- OpenAI-compatible chat routing for OpenRouter and custom endpoints
- workbench menu actions plus a customize-layout dialog
- user-defined local skills for launching external tools
