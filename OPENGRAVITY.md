# OpenGravity Code - OSS Fork

OpenGravity is now built as a real Code - OSS based IDE. The old Tauri shell is kept as a reference prototype only; the production path is this fork.

## Product Direction

- Base: upstream `microsoft/vscode` Code - OSS, MIT licensed.
- Distribution name: `OpenGravity`.
- Application name: `opengravity`.
- Data folder: `.opengravity`.
- URL protocol: `opengravity://`.
- Extension gallery: Open VSX by default.
- First platform: Windows x64.
- Reverse engineering tooling: postponed until the base IDE is stable.

The goal is to keep VS Code's real editor, terminal, debugger, Git, tasks, extension host, settings, keybindings, and extension management intact while adding OpenGravity's provider-agnostic agent layer as a first-party built-in module.

## Current Patch Layer

This initial patch keeps the fork deliberately small:

- `product.json` contains OpenGravity identity, Windows app IDs, Open VSX gallery URLs, and no default Copilot/Microsoft chat agent configuration.
- `extensions/opengravity-agent` contributes the right-side `Agent` view in the Secondary Side Bar.
- Provider accounts are captured through VS Code SecretStorage and can be saved as multiple accounts per provider.
- The provider catalog is explicit and provider-agnostic: Gemini, OpenRouter, Groq, DeepSeek, Anthropic, OpenAI-compatible, Ollama, and custom endpoints are first-class entries.
- The first provider runtime path can send non-streaming BYOK chat requests through Gemini, Anthropic, Ollama, and OpenAI-compatible protocols.
- Chat history is stored in VS Code workspace storage.
- Settings use the `opengravity.*` namespace.
- Ask and Planning modes block mutating actions. Agent mode requires explicit approval.
- Upstream Copilot/VS Code first-run onboarding is disabled by default; OpenGravity owns provider setup through the Agent dock.

## Build Bootstrap

Use the Node version from `.nvmrc`:

```powershell
node -v
Get-Content .nvmrc
npm install
npm run compile
.\scripts\code.bat
```

The upstream tree currently requires Node `22.22.1` or newer within Node major `22`, and npm `< 11.2.0`. This repo no longer supports Yarn for bootstrap. If local Node or npm differs, install compatible versions before the full build.

The OpenGravity fork also carries small Windows bootstrap hardening patches:

- `build/npm/preinstall.ts` calls `node-gyp.js` through the active Node executable instead of launching `node-gyp.cmd` through a shell.
- `build/lib/tsgo.ts` calls `tsgo.js` through the active Node executable instead of launching `npx.cmd` through a shell.

These keep bootstrap and compile working when the checkout path contains spaces.

## OpenGravity Agent Smoke Checks

Run the local mode-safety tests:

```powershell
npm --prefix extensions/opengravity-agent test
```

Run syntax checks for the built-in module:

```powershell
node --check extensions/opengravity-agent/extension.js
node --check extensions/opengravity-agent/lib/modeSafety.js
node --check extensions/opengravity-agent/lib/providerCatalog.js
node --check extensions/opengravity-agent/lib/providerRuntime.js
```

Validate the fork bootstrap invariants:

```powershell
node scripts/opengravity/validate-bootstrap.js
```

## Near-Term Port Order

1. Confirm upstream Code - OSS compiles and launches on Windows x64.
2. Verify OpenGravity branding, data folder, protocol, and Open VSX extension search.
3. Port provider router and multi-account account selection into the built-in Agent module.
4. Move API keys fully through SecretStorage-backed account IDs.
5. Port session continuity, context compaction, artifact ledger, and failover.
6. Add diff preview and approval-backed file edits through VS Code workspace edit APIs.
7. Add task and terminal execution through VS Code task/terminal APIs.
8. Verify C++ compile/test smoke through real tasks and terminal.
9. Package a Windows x64 build.

## Guardrails

- Keep OpenGravity changes small and documented so upstream Code - OSS merges remain practical.
- Do not hardcode user-specific paths or provider assumptions.
- Do not add reverse engineering commands in this milestone.
- Do not bypass mode safety: Ask answers only, Planning plans only, and Agent executes only after approval.
