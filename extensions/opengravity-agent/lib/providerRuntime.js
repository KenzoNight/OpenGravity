/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const { getProvider, normalizeBaseUrl } = require('./providerCatalog');

function toChatMessages(history, userText, mode) {
	const system = {
		role: 'system',
		content: mode === 'agent'
			? 'You are OpenGravity Agent mode. Propose actions, but do not claim execution unless an explicit approval flow has run.'
			: mode === 'planning'
				? 'You are OpenGravity Planning mode. Create plans only. Do not edit files, run commands, or call tools.'
				: 'You are OpenGravity Ask mode. Answer questions only. Do not edit files, run commands, or call tools.'
	};

	const recent = Array.isArray(history) ? history.slice(-20) : [];
	const messages = recent
		.filter(message => message && (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string')
		.map(message => ({
			role: message.role,
			content: message.content
		}));

	messages.push({ role: 'user', content: userText });
	return [system, ...messages];
}

async function requestProviderResponse(options) {
	const account = options.account;
	const provider = getProvider(account.provider);
	const protocol = provider.chatProtocol || 'openai-compatible';
	const request = createProviderRequest({
		account,
		apiKey: options.apiKey || '',
		messages: options.messages || [],
		protocol
	});
	const fetchImpl = options.fetchImpl || globalThis.fetch;

	if (typeof fetchImpl !== 'function') {
		throw new Error('This runtime does not expose fetch.');
	}

	const response = await fetchImpl(request.url, {
		method: 'POST',
		headers: request.headers,
		body: JSON.stringify(request.body),
		signal: options.signal
	});

	const text = await response.text();
	let payload;
	try {
		payload = text ? JSON.parse(text) : {};
	} catch (error) {
		throw new Error(`Provider returned non-JSON response: ${text.slice(0, 220)}`);
	}

	if (!response.ok) {
		throw new Error(readProviderError(payload, response.status));
	}

	return parseProviderResponse(protocol, payload);
}

function createProviderRequest({ account, apiKey, messages, protocol }) {
	switch (protocol) {
		case 'gemini':
			return createGeminiRequest(account, apiKey, messages);
		case 'anthropic':
			return createAnthropicRequest(account, apiKey, messages);
		case 'ollama':
			return createOllamaRequest(account, messages);
		case 'openai-compatible':
		default:
			return createOpenAICompatibleRequest(account, apiKey, messages);
	}
}

function createGeminiRequest(account, apiKey, messages) {
	const baseUrl = normalizeBaseUrl(account.provider, account.baseUrl) || 'https://generativelanguage.googleapis.com/v1beta';
	const model = encodeURIComponent(account.model);
	const url = `${trimTrailingSlash(baseUrl)}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
	const system = messages.find(message => message.role === 'system');
	const contents = messages
		.filter(message => message.role !== 'system')
		.map(message => ({
			role: message.role === 'assistant' ? 'model' : 'user',
			parts: [{ text: message.content }]
		}));

	return {
		url,
		headers: { 'Content-Type': 'application/json' },
		body: {
			systemInstruction: system ? { parts: [{ text: system.content }] } : undefined,
			contents
		}
	};
}

function createOpenAICompatibleRequest(account, apiKey, messages) {
	const baseUrl = normalizeBaseUrl(account.provider, account.baseUrl);
	const headers = { 'Content-Type': 'application/json' };
	if (apiKey) {
		headers.Authorization = `Bearer ${apiKey}`;
	}

	return {
		url: `${trimTrailingSlash(baseUrl)}/chat/completions`,
		headers,
		body: {
			model: account.model,
			messages,
			temperature: 0.2,
			stream: false
		}
	};
}

function createAnthropicRequest(account, apiKey, messages) {
	const baseUrl = normalizeBaseUrl(account.provider, account.baseUrl) || 'https://api.anthropic.com/v1';
	const system = messages.find(message => message.role === 'system');
	const conversation = messages
		.filter(message => message.role !== 'system')
		.map(message => ({
			role: message.role === 'assistant' ? 'assistant' : 'user',
			content: message.content
		}));

	return {
		url: `${trimTrailingSlash(baseUrl)}/messages`,
		headers: {
			'Content-Type': 'application/json',
			'anthropic-version': '2023-06-01',
			'x-api-key': apiKey
		},
		body: {
			model: account.model,
			max_tokens: 2048,
			system: system ? system.content : undefined,
			messages: conversation
		}
	};
}

function createOllamaRequest(account, messages) {
	const baseUrl = normalizeBaseUrl(account.provider, account.baseUrl);
	return {
		url: `${trimTrailingSlash(baseUrl)}/api/chat`,
		headers: { 'Content-Type': 'application/json' },
		body: {
			model: account.model,
			messages,
			stream: false
		}
	};
}

function parseProviderResponse(protocol, payload) {
	if (protocol === 'gemini') {
		return (payload.candidates || [])
			.flatMap(candidate => candidate.content && candidate.content.parts ? candidate.content.parts : [])
			.map(part => part.text || '')
			.join('')
			.trim();
	}

	if (protocol === 'anthropic') {
		return (payload.content || [])
			.map(part => part.text || '')
			.join('')
			.trim();
	}

	if (protocol === 'ollama') {
		return payload.message && payload.message.content ? String(payload.message.content).trim() : '';
	}

	return payload.choices && payload.choices[0] && payload.choices[0].message
		? String(payload.choices[0].message.content || '').trim()
		: '';
}

function readProviderError(payload, status) {
	if (payload && payload.error) {
		if (typeof payload.error === 'string') {
			return payload.error;
		}
		if (payload.error.message) {
			return payload.error.message;
		}
	}

	return `Provider request failed with HTTP ${status}.`;
}

function trimTrailingSlash(value) {
	return String(value || '').replace(/\/+$/, '');
}

module.exports = {
	createProviderRequest,
	parseProviderResponse,
	requestProviderResponse,
	toChatMessages
};
