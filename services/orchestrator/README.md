# Orchestrator Service

This service will host the long-running agent runtime:

- task graph execution
- subagent lifecycle
- tool routing
- approval checkpoints
- continuity handoff

Current implementation scope:

- task graph validation and runnable task detection
- agent allocation and release
- in-memory and JSON-backed session ledger storage
- provider handoff planning using shared continuity and routing logic
- artifact and event recording for runtime actions
