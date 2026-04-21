# OpenGravity v1 Architecture

## Product Thesis

OpenGravity is a vendor-agnostic, multi-agent coding platform built to outperform Antigravity-style IDEs on three fronts:

1. Real polyglot execution, not just code generation
2. Cross-model continuity, even when a provider rate-limits or fails
3. Long-horizon agent work with structured memory, checkpoints, and verification loops

The product is not just an AI IDE. It is a stateful agent operating system for software development.

## Product Pillars

### 1. Polyglot Build Intelligence

The agent must detect, prepare, build, test, and repair across major ecosystems:

- C/C++: `cmake`, `ninja`, `make`, `MSBuild`, `Bazel`, `conan`, `vcpkg`
- Rust: `cargo`
- Go: `go`
- Java/Kotlin: `gradle`, `maven`
- Python: `uv`, `pip`, `pytest`
- Node.js: `npm`, `pnpm`, `yarn`
- .NET: `dotnet`

The system should understand build graphs, parse compiler errors, and re-run targeted repair loops until success or a clear blocker is surfaced.

### 2. Cross-Model Session Continuity

OpenGravity owns the canonical session state. Providers do not.

If the user moves from Claude to Gemini, or from Gemini to OpenAI, the conversation continues without requiring the user to restate context. The platform achieves this with:

- event-sourced session history
- structured working memory
- long-term project memory
- compact task state snapshots
- provider-agnostic tool and artifact logs

### 3. Multi-Agent Orchestration

OpenGravity uses role-based agents connected through a shared task graph and artifact bus. Initial core agents:

- Architect
- Coder
- Builder
- Reviewer
- Tester
- Browser
- Docs
- Memory

Each agent can work in a dedicated worktree or sandbox and publish artifacts back to the shared session.

### 4. Verification Over Vibes

Every meaningful task should end with machine-verifiable evidence:

- build result
- test result
- lint/typecheck result
- browser proof
- changed files
- summary of unresolved risk

## Core Surfaces

### Workspace Shell

The main desktop shell is a native-feeling, operator-grade IDE experience with:

- file explorer
- tabs
- split editors
- terminal
- problems pane
- source control
- debug/build runners

### Agent Manager

The right rail shows:

- active model
- continuity state
- multi-agent roster
- current task graph
- checkpoints
- artifacts
- approvals
- cost and token telemetry

### Continuity Console

This surface explains why a conversation is still coherent after compaction or provider switch:

- current provider
- previous provider
- latest compact summary
- preserved goals
- unresolved blockers
- next planned actions

## Architecture Modules

### 1. Editor Shell

Responsibilities:

- desktop UI
- workspace management
- file operations
- tabs and panes
- terminal embedding
- provider settings
- local artifact rendering

Recommended base: a Tauri 2 shell with an OS webview frontend and native backend processes.

### 1A. Hybrid Shell Boundary

OpenGravity will use a hybrid desktop architecture instead of Electron:

- Tauri 2 shell for windows, menus, tray, permissions, and IPC
- Monaco-based editor surface inside the system webview
- xterm.js terminal surface inside the system webview
- Rust core process for app orchestration and secure IPC boundaries
- C++ sidecars for heavy workspace analysis, build intelligence, and process supervision

This keeps the UI flexible while moving performance-sensitive and system-heavy work into native components.

### 2. Agent Orchestrator

Responsibilities:

- task graph execution
- subagent scheduling
- tool routing
- approval policy enforcement
- background job lifecycle
- retries and failover

### 3. Build Intelligence Engine

Responsibilities:

- build system detection
- toolchain inspection
- dependency readiness checks
- compile/test/repair recipes
- compiler error parsing
- targeted reruns

### 4. Context Engine

Responsibilities:

- repository map
- symbol graph
- embeddings and retrieval
- open file state
- recent terminal state
- decision log
- compact summaries

### 5. Model Router

Responsibilities:

- provider adapters
- model capability registry
- fallback policies
- user preferences
- rate-limit failover
- cost-aware routing

Supported classes:

- OpenAI-compatible APIs
- Anthropic
- Gemini
- OpenRouter
- Ollama and local models

### 6. Session State Store

Responsibilities:

- event log
- checkpoints
- artifact metadata
- agent outputs
- prompt/response lineage
- provider switch records

### 7. Artifact Store

Responsibilities:

- diffs
- plans
- test reports
- screenshots
- browser traces
- build logs
- review summaries

### 8. Policy Engine

Responsibilities:

- command approval profiles
- secret handling
- destructive action guards
- model usage policies
- per-project trust levels

## Memory Model

### Working Memory

Short-lived, compact, task-focused state used by the active provider:

- current goal
- relevant files
- latest errors
- next actions
- constraints

### Long-Term Memory

Reusable project knowledge:

- architecture notes
- established patterns
- dependency quirks
- naming conventions
- prior fixes

### Continuity Pack

When switching providers or compacting a session, OpenGravity prepares a continuity pack containing:

- concise task summary
- active branch and worktree
- open blockers
- latest critical logs
- changed files
- pending approvals
- best next action

## P0 Feature Requirements

1. Detect and run C++ projects on Windows, macOS, and Linux where required toolchains are installed
2. Resume the same task after a provider switch with no manual re-explanation from the user
3. Support parallel subagents with visible ownership and artifact outputs
4. Auto-compact context without collapsing important build/test facts
5. Persist checkpoints that restore files, task state, and conversation continuity
6. Let users bring their own keys and choose fallback models
7. Surface verification results directly in the IDE

## Example Continuity Scenario

1. The user starts with Claude on a C++ repository.
2. The Builder agent detects `CMakeLists.txt` and configures a build directory.
3. The compile step fails with an include path error under MSVC.
4. The session reaches a provider limit.
5. The router moves the active task to Gemini.
6. Gemini receives the continuity pack and continues from the exact failed build state.
7. The next response references the same compiler error, attempted fix history, and pending next step.

No manual recap is required.

## UI Principles

- Dense, professional, operator-grade UI
- Clear evidence of what each agent is doing
- Human override always visible
- Explanations should be structured, not chatty
- Context continuity should feel explicit and trustworthy

## Suggested Tech Direction

- Desktop shell: Tauri 2
- Frontend: React + TypeScript rendered in the OS webview
- Editor surface: Monaco Editor
- Terminal surface: xterm.js
- Core process: Rust
- Native sidecars: C++ for build intelligence, indexing, and heavy local execution
- State store: SQLite locally, optional server sync later
- Embeddings/retrieval: pluggable, local-first where possible
- Sandboxes: worktrees locally, containers for advanced runs

## Success Criteria

OpenGravity v1 is successful when:

- users can open a non-trivial C++ repo and get a full compile/repair loop
- users can hot-switch models mid-task without losing continuity
- multiple agents can work in parallel on distinct subtasks
- every major answer is backed by artifacts and verification evidence
- the product feels faster, more transparent, and more controllable than Antigravity-style tooling
