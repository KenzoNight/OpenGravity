/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const MODES = new Set(['ask', 'planning', 'agent']);
const MUTATING_ACTIONS = new Set([
	'open_file_for_edit',
	'replace_in_file',
	'create_file',
	'delete_file',
	'run_command',
	'run_task',
	'run_workflow',
	'apply_patch',
	'bridge_call'
]);

function normalizeMode(value) {
	const mode = String(value || '').trim().toLowerCase();
	return MODES.has(mode) ? mode : 'ask';
}

function isMutatingAction(actionType) {
	return MUTATING_ACTIONS.has(String(actionType || '').trim());
}

function evaluateAction(mode, actionType) {
	const normalizedMode = normalizeMode(mode);
	const mutating = isMutatingAction(actionType);

	if (!mutating) {
		return {
			allowed: true,
			requiresApproval: false,
			reason: 'Read-only action.'
		};
	}

	if (normalizedMode === 'ask') {
		return {
			allowed: false,
			requiresApproval: false,
			reason: 'Ask mode cannot edit files, run commands, or call tools.'
		};
	}

	if (normalizedMode === 'planning') {
		return {
			allowed: false,
			requiresApproval: false,
			reason: 'Planning mode can propose a plan only. It cannot execute actions.'
		};
	}

	return {
		allowed: true,
		requiresApproval: true,
		reason: 'Agent mode can execute mutating actions only after explicit approval.'
	};
}

function modeDescription(mode) {
	switch (normalizeMode(mode)) {
		case 'planning':
			return 'Planning mode creates plans only. Edits, commands, tasks, and bridge calls stay blocked.';
		case 'agent':
			return 'Agent mode can propose actions and execute them only after approval.';
		case 'ask':
		default:
			return 'Ask mode answers questions only. Edits, commands, tasks, and bridge calls stay blocked.';
	}
}

module.exports = {
	MODES,
	MUTATING_ACTIONS,
	normalizeMode,
	isMutatingAction,
	evaluateAction,
	modeDescription
};
