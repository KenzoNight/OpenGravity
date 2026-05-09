# OpenGravity Agent

This built-in module is the first OpenGravity layer inside the Code - OSS fork.

It intentionally starts small:

- right-side Secondary Side Bar view named `Agent`
- compact Antigravity-style composer
- BYOK provider account capture through VS Code SecretStorage
- multiple accounts per provider with a compact switch command
- provider catalog entries for Gemini, OpenRouter, Groq, DeepSeek, Anthropic, OpenAI-compatible, Ollama, and custom endpoints
- direct non-streaming chat requests for the first BYOK provider runtime milestone
- workspace-scoped chat history through VS Code workspace storage
- mode safety gates for Ask, Planning, and Agent
- command IDs under the `opengravity.*` namespace

The orchestration worker, provider router, continuity packs, build intelligence, edit preview, task approvals, and artifact ledger are ported after this foundation boots reliably.
