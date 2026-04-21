# OpenGravity Master Plan

## Build Philosophy

OpenGravity should be built in small, verifiable layers. Every phase must leave the repository in a more testable state than before.

## Phase 0 — Foundation

Goals:

- establish repo structure
- lock product direction
- define reuse strategy
- implement the first testable core packages

Status:

- in progress

## Phase 1 — Core Agent Runtime

Goals:

- session state model
- model router with failover policies
- continuity pack generation
- task graph primitives
- agent role definitions

Exit criteria:

- provider switch can occur without losing task state
- a synthetic multi-agent workflow can be simulated and tested

## Phase 2 — Build Intelligence

Goals:

- language/build detection
- compile/test recipe registry
- toolchain inspection
- error parsing for major ecosystems

Priority languages:

1. C/C++
2. Node.js / TypeScript
3. Python
4. Rust
5. Go
6. Java / Kotlin
7. .NET

Exit criteria:

- workspace profiling is deterministic
- build repair loops can be driven by structured outputs rather than ad hoc prompts

## Phase 3 — Desktop Shell

Goals:

- prepare a Tauri-based hybrid shell strategy
- integrate workspace explorer, editor panes, terminal, task/status surfaces
- mount the future Agent Manager surface

Exit criteria:

- the shell can host OpenGravity panels and runtime status cleanly

## Phase 4 — Multi-Agent Surface

Goals:

- live agent roster
- task graph view
- artifacts surface
- approvals and checkpoints
- continuity console

Exit criteria:

- users can understand what each agent is doing without reading raw logs

## Phase 5 — Verification and Safety

Goals:

- policy engine
- command approval layers
- artifact-backed verification
- destructive action guards
- cost and usage controls

Exit criteria:

- a task cannot silently mutate a workspace without visible evidence

## Phase 6 — Hybrid Native Core

Goals:

- define the Rust core to C++ sidecar boundary
- move heavy indexing, build intelligence, and process supervision into native sidecars
- keep the webview UI thin and replaceable

Exit criteria:

- heavy local execution can evolve independently from the shell UI
