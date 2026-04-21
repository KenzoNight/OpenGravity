# Upstream Reuse Strategy

## Principle

OpenGravity should not reinvent solved problems. It should aggressively reuse mature open-source components when:

- the component solves a generic platform concern
- the component is maintainable under patching or forking
- replacing it would not create meaningful product differentiation

## Planned Reuse Zones

### 1. Editor Shell

Preferred direction:

- Code-OSS or VSCodium-class editor base

Why:

- proven editor shell
- mature pane/layout/workspace model
- familiar user mental model

### 2. Agent Runtime Patterns

Potential reuse:

- task orchestration ideas
- approval flows
- tool invocation patterns
- browser / terminal / file tooling models

These can be borrowed and heavily adapted without copying product identity.

### 3. Language and Build Detection

Potential reuse:

- file-pattern heuristics
- workspace scanning patterns
- error parsing ideas
- task runner conventions

### 4. Provider Adapters

Potential reuse:

- common provider request/response normalization
- retry and failover patterns
- token/cost metadata handling

## What Must Stay Custom

These are core differentiators and should remain first-party:

- continuity pack design
- cross-model hot handoff behavior
- build-repair intelligence
- artifact-first workflow surfaces
- policy engine
- multi-agent coordination model

## Practical Rule

If a component is invisible infrastructure, prefer reuse.
If a component defines the OpenGravity user advantage, prefer custom control.

