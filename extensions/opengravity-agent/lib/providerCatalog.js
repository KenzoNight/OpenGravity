/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const DEFAULT_PROVIDER_ID = 'gemini';

const PROVIDERS = Object.freeze([
	Object.freeze({
		id: 'gemini',
		label: 'Gemini',
		defaultModel: 'gemini-2.5-pro',
		requiresKey: true,
		defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
		chatProtocol: 'gemini'
	}),
	Object.freeze({
		id: 'openrouter',
		label: 'OpenRouter',
		defaultModel: 'openrouter/auto',
		requiresKey: true,
		defaultBaseUrl: 'https://openrouter.ai/api/v1',
		chatProtocol: 'openai-compatible'
	}),
	Object.freeze({
		id: 'groq',
		label: 'Groq',
		defaultModel: 'llama-3.3-70b-versatile',
		requiresKey: true,
		defaultBaseUrl: 'https://api.groq.com/openai/v1',
		chatProtocol: 'openai-compatible'
	}),
	Object.freeze({
		id: 'deepseek',
		label: 'DeepSeek',
		defaultModel: 'deepseek-chat',
		requiresKey: true,
		defaultBaseUrl: 'https://api.deepseek.com',
		chatProtocol: 'openai-compatible'
	}),
	Object.freeze({
		id: 'openai-compatible',
		label: 'OpenAI-compatible',
		defaultModel: 'gpt-4.1',
		requiresKey: true,
		defaultBaseUrl: '',
		chatProtocol: 'openai-compatible'
	}),
	Object.freeze({
		id: 'anthropic',
		label: 'Anthropic',
		defaultModel: 'claude-sonnet-4-5',
		requiresKey: true,
		defaultBaseUrl: 'https://api.anthropic.com/v1',
		chatProtocol: 'anthropic'
	}),
	Object.freeze({
		id: 'ollama',
		label: 'Ollama',
		defaultModel: 'llama3.1',
		requiresKey: false,
		defaultBaseUrl: 'http://127.0.0.1:11434',
		chatProtocol: 'ollama'
	}),
	Object.freeze({
		id: 'custom',
		label: 'Custom endpoint',
		defaultModel: 'custom-model',
		requiresKey: false,
		defaultBaseUrl: '',
		chatProtocol: 'openai-compatible'
	})
]);

const PROVIDER_BY_ID = new Map(PROVIDERS.map(provider => [provider.id, provider]));

function listProviders() {
	return PROVIDERS.map(provider => ({ ...provider }));
}

function getProvider(providerId) {
	return PROVIDER_BY_ID.get(normalizeProviderId(providerId));
}

function findProvider(providerId) {
	return PROVIDER_BY_ID.get(normalizeString(providerId).toLowerCase());
}

function normalizeProviderId(providerId) {
	const id = normalizeString(providerId).toLowerCase();
	return PROVIDER_BY_ID.has(id) ? id : DEFAULT_PROVIDER_ID;
}

function normalizeProviderModel(providerId, model) {
	const provider = getProvider(providerId);
	return normalizeString(model) || provider.defaultModel;
}

function normalizeBaseUrl(providerId, baseUrl) {
	const provider = getProvider(providerId);
	return normalizeString(baseUrl) || provider.defaultBaseUrl || '';
}

function providerRequiresApiKey(providerId) {
	return getProvider(providerId).requiresKey;
}

function sanitizeAccounts(rawAccounts) {
	if (!Array.isArray(rawAccounts)) {
		return [];
	}

	const accounts = [];
	let activeSeen = false;

	for (const rawAccount of rawAccounts) {
		const account = normalizeAccount(rawAccount);
		if (!account) {
			continue;
		}

		if (account.active) {
			if (activeSeen) {
				account.active = false;
			} else {
				activeSeen = true;
			}
		}

		accounts.push(account);
	}

	if (accounts.length && !activeSeen) {
		accounts[0].active = true;
	}

	return accounts;
}

function normalizeAccount(rawAccount) {
	if (!rawAccount || typeof rawAccount !== 'object') {
		return undefined;
	}

	const provider = findProvider(rawAccount.provider);
	if (!provider) {
		return undefined;
	}

	const id = normalizeString(rawAccount.id);
	if (!id) {
		return undefined;
	}

	const model = normalizeString(rawAccount.model) || provider.defaultModel;
	const label = normalizeString(rawAccount.label) || provider.label;

	return {
		id,
		provider: provider.id,
		label,
		model,
		baseUrl: normalizeString(rawAccount.baseUrl) || provider.defaultBaseUrl || '',
		active: rawAccount.active === true,
		createdAt: normalizeString(rawAccount.createdAt)
	};
}

function describeAccount(account) {
	const normalized = normalizeAccount(account);
	if (!normalized) {
		return 'No provider';
	}

	const provider = getProvider(normalized.provider);
	const label = normalized.label === provider.label ? provider.label : `${provider.label}: ${normalized.label}`;
	return `${label} / ${normalized.model}`;
}

function getActiveAccount(accounts) {
	const sanitized = sanitizeAccounts(accounts);
	return sanitized.find(account => account.active) || sanitized[0];
}

function normalizeString(value) {
	return String(value || '').trim();
}

module.exports = {
	DEFAULT_PROVIDER_ID,
	PROVIDERS,
	describeAccount,
	getActiveAccount,
	getProvider,
	listProviders,
	normalizeAccount,
	normalizeBaseUrl,
	normalizeProviderId,
	normalizeProviderModel,
	providerRequiresApiKey,
	sanitizeAccounts
};
