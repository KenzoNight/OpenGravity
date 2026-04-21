# OpenGravity

OpenGravity is a desktop coding agent built for developers who want to code with their own API keys instead of being locked into a single provider, single model, or single workflow.

The product direction is simple:

- bring your own API keys
- switch providers without losing task state
- run real multi-agent workflows
- compile, test, and repair real projects
- stay desktop-first instead of browser-first

## Product Goal

OpenGravity is designed as a provider-agnostic agentic development environment that can continue the same coding task across models such as Anthropic, Gemini, OpenAI, OpenRouter, local runtimes, and compatible APIs.

The long-term goal is to deliver a coding experience with:

- multi-agent orchestration
- cross-model continuity
- automatic context compaction
- polyglot build and repair loops
- artifact-first verification
- a native desktop shell

## For Users

OpenGravity is being built for developers who want more control than hosted AI IDEs usually allow.

Target user experience:

- use your own API keys
- choose your own provider and model
- continue the same task when one model hits limits
- work on real repositories, not toy demos
- keep coding inside a desktop app

Planned provider model:

- OpenAI-compatible APIs
- Anthropic
- Gemini
- OpenRouter
- Ollama and local models
- custom endpoints

Current status:

- early alpha repository
- core continuity, routing, orchestration, and build-intelligence packages are testable
- desktop shell includes a real Tauri workspace file bridge and command bridge
- provider settings and BYOK routing controls now exist as an early desktop shell prototype
- recommended execution plans can now run step-by-step from the desktop shell with tracked workflow state
- production-ready editing, terminal integration, secure secret storage, and command execution are still in progress

## For Developers

This repository is structured to separate product shell, runtime logic, and shared domain contracts.

Repository layout:

- `apps/desktop-shell` - Tauri desktop shell and workbench UI
- `packages/shared-types` - shared contracts used across the repo
- `packages/session-core` - continuity packs and handoff summaries
- `packages/model-router` - model and provider failover logic
- `packages/build-intelligence` - workspace profiling, execution plans, and build log classification
- `services/orchestrator` - task graph runtime, session ledger, and provider handoff orchestration
- `docs` - architecture, planning, and design decisions
- `mockups` - earlier design experiments and visual concepts

Engineering rules for this repository:

- English only in code, comments, docs, UI copy, and commit messages
- keep source ASCII-first unless a file already requires Unicode
- no emoji in repository text or product copy
- prefer explicit tests for runtime behavior
- do not assume a single provider, model, or language

## Local Development

Requirements:

- Node.js 24+
- npm 10+
- Rust toolchain
- Tauri desktop prerequisites for your platform

Install dependencies:

```bash
npm install
```

Validate the repository:

```bash
npm run typecheck
npm run test
```

Check the desktop application layer:

```bash
npm run app:check
```

Run the desktop application in development mode:

```bash
npm run app:dev
```

Build the desktop shell frontend bundle:

```bash
npm run app:web-build
```

## What Exists Today

Already implemented:

- continuity pack generation
- provider handoff summaries
- model failover routing
- workspace profiling and build plan recommendation
- build log classification
- task graph orchestration
- session ledger persistence
- an early native desktop shell
- an early provider settings and API key management surface
- workspace file reading and saving through Tauri commands
- desktop command execution with a guarded allowlist
- streaming command sessions with cancel support
- workflow execution queues for recommended build and repair steps
- Monaco-backed code editing with language-aware file models
- xterm-based terminal sessions with live command output and run switching

Not finished yet:

- Monaco editor integration
- rich terminal emulation with PTY-grade interaction
- native secret vault for provider credentials
- multi-tab document state and conflict handling
- full agent manager workflows

## Documentation

Key documents:

- [Architecture](docs/opengravity-v1-architecture.md)
- [Master Plan](docs/master-plan.md)
- [Hybrid Shell Decision](docs/adr-0001-hybrid-shell.md)
- [Upstream Reuse Strategy](docs/upstream-reuse-strategy.md)

## Development Direction

OpenGravity is not trying to reinvent every layer from scratch.

The plan is to combine custom product logic with proven building blocks where they make sense:

- Tauri for the desktop shell and native boundary
- Monaco for editing
- xterm.js for terminal rendering
- Rust for native shell/runtime boundaries
- optional native sidecars for heavier local tasks

The differentiation should live in:

- continuity
- routing
- orchestration
- build and repair intelligence
- provider freedom

## Contribution Notes

If you work on this repository:

- keep user-facing copy short and direct
- keep architecture changes documented
- update tests when runtime behavior changes
- avoid vendor-locked assumptions
- optimize for a real desktop product, not a marketing mockup
