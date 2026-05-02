import type { ModelProvider } from "@opengravity/shared-types";

import type { ProviderChatMessage } from "./chat-state";
import type { ProviderAccount } from "./settings-state";

export interface CompatibleChatResult {
  accountId: string;
  accountLabel: string;
  content: string;
  modelId: string;
}

type CompatibleContent =
  | string
  | Array<{
      text?: string;
      type?: string;
    }>;

interface CompatibleChoice {
  message?: {
    content?: CompatibleContent;
  };
}

interface CompatibleChatResponse {
  choices?: CompatibleChoice[];
  model?: string;
}

const defaultBaseUrls: Partial<Record<ModelProvider, string>> = {
  deepseek: "https://api.deepseek.com",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  groq: "https://api.groq.com/openai/v1",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1"
};

function normalizeCompatibleContent(content: CompatibleContent | undefined): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((entry) => entry.text ?? "")
      .join("\n")
      .trim();
  }

  return "";
}

function shouldRetryAccount(status: number): boolean {
  return status === 401 || status === 402 || status === 403 || status === 408 || status === 429 || status >= 500;
}

function resolveBaseUrl(provider: ModelProvider, account: ProviderAccount): string {
  const preferred = account.baseUrl.trim();
  const fallback = defaultBaseUrls[provider] ?? "";
  return (preferred || fallback).replace(/\/+$/, "");
}

function ensureCompatibleProvider(provider: ModelProvider): void {
  if (
    provider === "deepseek" ||
    provider === "gemini" ||
    provider === "groq" ||
    provider === "openrouter" ||
    provider === "openai" ||
    provider === "custom"
  ) {
    return;
  }

  throw new Error(
    `${provider} chat routing is not wired into the desktop shell yet. Use DeepSeek, Gemini, Groq, OpenRouter, OpenAI, or a custom OpenAI-compatible endpoint for now.`
  );
}

export async function sendCompatibleChatCompletion(args: {
  accounts: ProviderAccount[];
  messages: ProviderChatMessage[];
  mode: "ask" | "planning" | "agent";
  modelId: string;
  provider: ModelProvider;
  sessionId: string;
}): Promise<CompatibleChatResult> {
  ensureCompatibleProvider(args.provider);

  const orderedAccounts = [...args.accounts];
  const failures: string[] = [];

  for (const account of orderedAccounts) {
    const baseUrl = resolveBaseUrl(args.provider, account);
    if (!baseUrl) {
      failures.push(`${account.label}: missing base URL`);
      continue;
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${account.apiKey}`,
      "Content-Type": "application/json"
    };

    if (args.provider === "openrouter") {
      headers["X-Title"] = "OpenGravity";
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: args.modelId,
        messages: args.messages,
        temperature: args.mode === "agent" ? 0.25 : 0.15
      })
    });

    if (!response.ok) {
      failures.push(`${account.label}: ${response.status}`);
      if (shouldRetryAccount(response.status)) {
        continue;
      }

      const message = await response.text();
      throw new Error(`${account.label}: ${response.status} ${message}`.trim());
    }

    const payload = (await response.json()) as CompatibleChatResponse;
    const content = normalizeCompatibleContent(payload.choices?.[0]?.message?.content);
    if (!content) {
      failures.push(`${account.label}: empty response`);
      continue;
    }

    return {
      accountId: account.id,
      accountLabel: account.label,
      content,
      modelId: payload.model ?? args.modelId
    };
  }

  throw new Error(
    failures.length > 0
      ? `Chat request failed across all configured accounts: ${failures.join(" | ")}`
      : "Chat request failed because no ready account was available."
  );
}
