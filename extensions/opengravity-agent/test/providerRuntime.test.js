/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const assert = require('assert');
const {
	createProviderRequest,
	parseProviderResponse,
	requestProviderResponse,
	toChatMessages
} = require('../lib/providerRuntime');

const messages = toChatMessages([
	{ role: 'user', content: 'What changed?' },
	{ role: 'assistant', content: 'Provider setup was added.' },
	{ role: 'system', content: 'ignored' }
], 'Summarize safely.', 'planning');

assert.strictEqual(messages[0].role, 'system');
assert.ok(messages[0].content.includes('Planning mode'));
assert.strictEqual(messages.at(-1).content, 'Summarize safely.');

const openRouterRequest = createProviderRequest({
	account: {
		provider: 'openrouter',
		model: 'openrouter/auto',
		baseUrl: ''
	},
	apiKey: 'test-key',
	messages,
	protocol: 'openai-compatible'
});

assert.strictEqual(openRouterRequest.url, 'https://openrouter.ai/api/v1/chat/completions');
assert.strictEqual(openRouterRequest.headers.Authorization, 'Bearer test-key');
assert.strictEqual(openRouterRequest.body.model, 'openrouter/auto');

const geminiRequest = createProviderRequest({
	account: {
		provider: 'gemini',
		model: 'gemini-2.5-pro',
		baseUrl: ''
	},
	apiKey: 'gemini-key',
	messages,
	protocol: 'gemini'
});

assert.ok(geminiRequest.url.includes('/models/gemini-2.5-pro:generateContent?key=gemini-key'));
assert.strictEqual(geminiRequest.body.contents.at(-1).role, 'user');

assert.strictEqual(parseProviderResponse('openai-compatible', {
	choices: [{ message: { content: 'OpenAI-compatible answer' } }]
}), 'OpenAI-compatible answer');

assert.strictEqual(parseProviderResponse('gemini', {
	candidates: [{ content: { parts: [{ text: 'Gemini ' }, { text: 'answer' }] } }]
}), 'Gemini answer');

assert.strictEqual(parseProviderResponse('anthropic', {
	content: [{ text: 'Anthropic answer' }]
}), 'Anthropic answer');

assert.strictEqual(parseProviderResponse('ollama', {
	message: { content: 'Ollama answer' }
}), 'Ollama answer');

async function run() {
	let capturedRequest;
	const answer = await requestProviderResponse({
		account: {
			provider: 'groq',
			model: 'llama-3.3-70b-versatile',
			baseUrl: ''
		},
		apiKey: 'groq-key',
		messages,
		fetchImpl: async (url, init) => {
			capturedRequest = { url, init };
			return {
				ok: true,
				status: 200,
				text: async () => JSON.stringify({
					choices: [{ message: { content: 'Mock answer' } }]
				})
			};
		}
	});

	assert.strictEqual(answer, 'Mock answer');
	assert.strictEqual(capturedRequest.url, 'https://api.groq.com/openai/v1/chat/completions');
	assert.strictEqual(JSON.parse(capturedRequest.init.body).model, 'llama-3.3-70b-versatile');

	console.log('providerRuntime tests passed');
}

run().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
