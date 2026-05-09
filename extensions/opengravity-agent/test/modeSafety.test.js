/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const assert = require('assert');
const {
	evaluateAction,
	isMutatingAction,
	normalizeMode
} = require('../lib/modeSafety');

assert.strictEqual(normalizeMode('ASK'), 'ask');
assert.strictEqual(normalizeMode('planning'), 'planning');
assert.strictEqual(normalizeMode('agent'), 'agent');
assert.strictEqual(normalizeMode('unknown'), 'ask');

assert.strictEqual(isMutatingAction('replace_in_file'), true);
assert.strictEqual(isMutatingAction('run_command'), true);
assert.strictEqual(isMutatingAction('read_file'), false);

assert.deepStrictEqual(evaluateAction('ask', 'replace_in_file'), {
	allowed: false,
	requiresApproval: false,
	reason: 'Ask mode cannot edit files, run commands, or call tools.'
});

assert.deepStrictEqual(evaluateAction('planning', 'run_command'), {
	allowed: false,
	requiresApproval: false,
	reason: 'Planning mode can propose a plan only. It cannot execute actions.'
});

assert.deepStrictEqual(evaluateAction('agent', 'run_task'), {
	allowed: true,
	requiresApproval: true,
	reason: 'Agent mode can execute mutating actions only after explicit approval.'
});

assert.deepStrictEqual(evaluateAction('ask', 'read_file'), {
	allowed: true,
	requiresApproval: false,
	reason: 'Read-only action.'
});

console.log('modeSafety tests passed');
