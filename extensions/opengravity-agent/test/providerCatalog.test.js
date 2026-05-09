/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const assert = require('assert');
const {
	describeAccount,
	getActiveAccount,
	getProvider,
	listProviders,
	normalizeBaseUrl,
	normalizeProviderId,
	normalizeProviderModel,
	providerRequiresApiKey,
	sanitizeAccounts
} = require('../lib/providerCatalog');

const providers = listProviders();
assert.ok(providers.length >= 8);
assert.ok(providers.some(provider => provider.id === 'groq'));
assert.ok(providers.some(provider => provider.id === 'deepseek'));
assert.ok(providers.some(provider => provider.id === 'openrouter'));

assert.strictEqual(normalizeProviderId('GROQ'), 'groq');
assert.strictEqual(normalizeProviderId('unknown-provider'), 'gemini');
assert.strictEqual(getProvider('deepseek').label, 'DeepSeek');

assert.strictEqual(normalizeProviderModel('groq', ''), 'llama-3.3-70b-versatile');
assert.strictEqual(normalizeProviderModel('openrouter', 'deepseek/deepseek-chat'), 'deepseek/deepseek-chat');

assert.strictEqual(normalizeBaseUrl('ollama', ''), 'http://127.0.0.1:11434');
assert.strictEqual(normalizeBaseUrl('custom', ' https://example.test/v1 '), 'https://example.test/v1');

assert.strictEqual(providerRequiresApiKey('gemini'), true);
assert.strictEqual(providerRequiresApiKey('ollama'), false);

const sanitized = sanitizeAccounts([
	{
		id: 'first',
		provider: 'openrouter',
		label: 'Main',
		model: 'openrouter/auto',
		active: true,
		baseUrl: ''
	},
	{
		id: 'second',
		provider: 'groq',
		label: '',
		model: '',
		active: true,
		baseUrl: ''
	},
	{
		id: 'ignored',
		provider: 'unsupported',
		label: 'Unsupported',
		model: 'x',
		active: false
	}
]);

assert.strictEqual(sanitized.length, 2);
assert.strictEqual(sanitized[0].active, true);
assert.strictEqual(sanitized[1].active, false);
assert.strictEqual(sanitized[1].label, 'Groq');
assert.strictEqual(sanitized[1].model, 'llama-3.3-70b-versatile');
assert.strictEqual(sanitized[1].baseUrl, 'https://api.groq.com/openai/v1');
assert.strictEqual(getActiveAccount(sanitized).id, 'first');
assert.strictEqual(describeAccount(sanitized[0]), 'OpenRouter: Main / openrouter/auto');

const withoutActive = sanitizeAccounts([
	{
		id: 'only',
		provider: 'gemini',
		label: 'Gemini',
		model: 'gemini-2.5-pro',
		active: false
	}
]);

assert.strictEqual(withoutActive[0].active, true);

console.log('providerCatalog tests passed');
