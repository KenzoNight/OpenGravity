# Security Notes

## Current JavaScript Dependency Status

The desktop shell JavaScript workspace currently reports `0 vulnerabilities` through `npm install`.

The main change was moving the Monaco runtime chain onto `monaco-editor@0.53.0`, which removes the DOMPurify dependency that was triggering the earlier Dependabot alerts.

## Remaining Rust Ecosystem Alerts

Two Rust advisories can still appear in GitHub Dependabot because they are transitive dependencies inside the current Tauri ecosystem lockfile rather than direct OpenGravity application code:

- `glib 0.18.x`
- `rand 0.7.x`

Current dependency paths observed locally:

- `rand 0.7.3` is pulled by `tauri-utils -> kuchikiki -> selectors -> phf_codegen/phf_generator`
- `glib 0.18.x` is part of the target-specific GTK/Linux dependency chain that Tauri keeps in the lockfile

These require upstream dependency movement or a much deeper framework-level patch to remove cleanly. OpenGravity does not directly depend on those crates in its own application logic.

## Local Tooling Safety

OpenGravity keeps desktop automation generic and user-controlled:

- external tools are registered as local skills
- launchers can be absolute paths or bare command names on `PATH`
- relative executable fragments are rejected
- destructive shell commands are denied by the guarded command bridge
- agent-triggered actions still flow through approval rules
