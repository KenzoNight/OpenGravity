/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const vscode = require('vscode');
const {
	evaluateAction,
	modeDescription,
	normalizeMode
} = require('./lib/modeSafety');
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
} = require('./lib/providerCatalog');
const {
	requestProviderResponse,
	toChatMessages
} = require('./lib/providerRuntime');

const VIEW_ID = 'opengravity.agent';
const VIEW_CONTAINER_COMMAND = 'workbench.view.extension.opengravity.agent.container';
const HISTORY_KEY = 'opengravity.chat.history';
const ACCOUNTS_KEY = 'opengravity.provider.accounts';
const SECRET_PREFIX = 'opengravity.providerAccount';

function activate(context) {
	const state = new OpenGravityState(context);
	const agentView = new AgentViewProvider(context, state);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(VIEW_ID, agentView, {
			webviewOptions: { retainContextWhenHidden: true }
		}),
		vscode.commands.registerCommand('opengravity.openAgent', async () => {
			await vscode.commands.executeCommand(VIEW_CONTAINER_COMMAND);
			await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
		}),
		vscode.commands.registerCommand('opengravity.connectProvider', async () => {
			await connectProvider(context, state);
			agentView.refresh();
		}),
		vscode.commands.registerCommand('opengravity.switchAccount', async () => {
			await switchProviderAccount(state);
			agentView.refresh();
		}),
		vscode.commands.registerCommand('opengravity.removeAccount', async () => {
			await removeProviderAccount(context, state);
			agentView.refresh();
		}),
		vscode.commands.registerCommand('opengravity.clearHistory', async () => {
			await state.setHistory([]);
			agentView.refresh();
		}),
		vscode.commands.registerCommand('opengravity.runPlan', async () => {
			await runApprovedPlan(state);
		})
	);

	context.subscriptions.push(createStatusBar(state));
}

function deactivate() {}

class OpenGravityState {
	constructor(context) {
		this.context = context;
	}

	get config() {
		return vscode.workspace.getConfiguration('opengravity');
	}

	get mode() {
		return normalizeMode(this.config.get('agent.mode', 'ask'));
	}

	async setMode(mode) {
		await this.config.update('agent.mode', normalizeMode(mode), vscode.ConfigurationTarget.Global);
	}

	get providerId() {
		return normalizeProviderId(this.config.get('defaultProvider', 'gemini'));
	}

	get model() {
		return normalizeProviderModel(this.providerId, this.config.get('defaultModel', ''));
	}

	get approvalProfile() {
		return this.config.get('approvalProfile', 'balanced');
	}

	getHistory() {
		return this.context.workspaceState.get(HISTORY_KEY, []);
	}

	async setHistory(history) {
		await this.context.workspaceState.update(HISTORY_KEY, history.slice(-80));
	}

	async appendMessage(role, content) {
		const history = this.getHistory();
		history.push({
			role,
			content,
			at: new Date().toISOString()
		});
		await this.setHistory(history);
	}

	getAccounts() {
		return sanitizeAccounts(this.context.globalState.get(ACCOUNTS_KEY, []));
	}

	async setAccounts(accounts) {
		await this.context.globalState.update(ACCOUNTS_KEY, sanitizeAccounts(accounts));
	}

	get activeAccount() {
		return getActiveAccount(this.getAccounts());
	}
}

class AgentViewProvider {
	constructor(context, state) {
		this.context = context;
		this.state = state;
		this.view = undefined;
	}

	resolveWebviewView(webviewView) {
		this.view = webviewView;
		webviewView.webview.options = { enableScripts: true };
		webviewView.webview.onDidReceiveMessage(message => this.handleMessage(message));
		this.refresh();
	}

	refresh() {
		if (!this.view) {
			return;
		}
		this.view.webview.html = renderAgentHtml(this.view.webview, this.state);
	}

	async handleMessage(message) {
		if (!message || typeof message.type !== 'string') {
			return;
		}

		if (message.type === 'connect') {
			await vscode.commands.executeCommand('opengravity.connectProvider');
			return;
		}

		if (message.type === 'switchAccount') {
			await vscode.commands.executeCommand('opengravity.switchAccount');
			return;
		}

		if (message.type === 'setMode') {
			await this.state.setMode(message.mode);
			this.refresh();
			return;
		}

		if (message.type === 'send') {
			await this.handlePrompt(String(message.text || ''));
			return;
		}
	}

	async handlePrompt(rawText) {
		const text = rawText.trim();
		if (!text) {
			return;
		}

		const previousHistory = this.state.getHistory();
		await this.state.appendMessage('user', text);
		const mode = this.state.mode;
		const account = this.state.activeAccount;

		let response;
		if (!account) {
			response = 'Connect a provider to continue. Your message was saved to this workspace session.';
		} else {
			response = await this.requestProviderAnswer(account, previousHistory, text, mode);
		}

		await this.state.appendMessage('assistant', response);
		this.refresh();
	}

	async requestProviderAnswer(account, previousHistory, text, mode) {
		if (providerRequiresApiKey(account.provider)) {
			const key = await this.context.secrets.get(`${SECRET_PREFIX}.${account.id}.apiKey`);
			if (!key) {
				return 'This provider account is missing an API key. Use Connect Provider to add a new account or switch to another saved account.';
			}

			return this.callProvider(account, key, previousHistory, text, mode);
		}

		return this.callProvider(account, '', previousHistory, text, mode);
	}

	async callProvider(account, apiKey, previousHistory, text, mode) {
		try {
			const answer = await requestProviderResponse({
				account,
				apiKey,
				messages: toChatMessages(previousHistory, text, mode)
			});
			return answer || 'The provider returned an empty response.';
		} catch (error) {
			return `Provider request failed: ${error.message || String(error)}`;
		}
	}
}

async function connectProvider(context, state) {
	const providerPick = await vscode.window.showQuickPick(listProviders().map(provider => ({
		label: provider.label,
		description: provider.id,
		detail: provider.defaultBaseUrl || 'Native provider endpoint',
		provider
	})), {
		placeHolder: 'Choose a provider'
	});

	if (!providerPick) {
		return;
	}

	const provider = providerPick.provider;
	const model = await vscode.window.showInputBox({
		title: 'Choose model',
		prompt: 'Use any model supported by this provider. You can change it later in Settings.',
		value: provider.defaultModel,
		ignoreFocusOut: true
	});

	if (!model) {
		return;
	}

	let baseUrl = normalizeBaseUrl(provider.id, '');
	if (provider.id === 'custom' || provider.id === 'openai-compatible') {
		baseUrl = await vscode.window.showInputBox({
			title: 'Provider base URL',
			prompt: 'Enter the OpenAI-compatible base URL.',
			value: state.config.get('providers.customBaseUrl', ''),
			ignoreFocusOut: true
		}) || '';
		if (!baseUrl.trim()) {
			vscode.window.showWarningMessage('Provider account was not saved because no base URL was entered.');
			return;
		}
	}

	let apiKey = '';
	if (providerRequiresApiKey(provider.id)) {
		apiKey = await vscode.window.showInputBox({
			title: `${provider.label} API key`,
			prompt: 'The key is saved in VS Code SecretStorage for this OpenGravity installation.',
			password: true,
			ignoreFocusOut: true
		}) || '';

		if (!apiKey.trim()) {
			vscode.window.showWarningMessage('Provider account was not saved because no API key was entered.');
			return;
		}
	}

	const label = await vscode.window.showInputBox({
		title: 'Account label',
		prompt: 'Optional label for this provider account.',
		value: defaultAccountLabel(state.getAccounts(), provider.id),
		ignoreFocusOut: true
	}) || provider.label;

	const id = createAccountId(provider.id);
	const accounts = state.getAccounts().map(account => ({ ...account, active: false }));
	const account = {
		id,
		provider: provider.id,
		label,
		model: normalizeProviderModel(provider.id, model),
		baseUrl,
		active: true,
		createdAt: new Date().toISOString()
	};

	if (apiKey.trim()) {
		await context.secrets.store(`${SECRET_PREFIX}.${id}.apiKey`, apiKey.trim());
	}

	accounts.push(account);
	await state.setAccounts(accounts);
	await state.config.update('defaultProvider', provider.id, vscode.ConfigurationTarget.Global);
	await state.config.update('defaultModel', account.model, vscode.ConfigurationTarget.Global);
	if (baseUrl) {
		await state.config.update('providers.customBaseUrl', baseUrl, vscode.ConfigurationTarget.Global);
	}

	vscode.window.showInformationMessage(`OpenGravity connected ${label}.`);
}

async function switchProviderAccount(state) {
	const accounts = state.getAccounts();
	if (!accounts.length) {
		await vscode.commands.executeCommand('opengravity.connectProvider');
		return;
	}

	const accountPick = await vscode.window.showQuickPick(accounts.map(account => ({
		label: describeAccount(account),
		description: account.active ? 'active' : getProvider(account.provider).id,
		account
	})), {
		placeHolder: 'Switch OpenGravity provider account'
	});

	if (!accountPick) {
		return;
	}

	const selected = accountPick.account;
	const nextAccounts = accounts.map(account => ({
		...account,
		active: account.id === selected.id
	}));
	await state.setAccounts(nextAccounts);
	await state.config.update('defaultProvider', selected.provider, vscode.ConfigurationTarget.Global);
	await state.config.update('defaultModel', selected.model, vscode.ConfigurationTarget.Global);
	if (selected.baseUrl) {
		await state.config.update('providers.customBaseUrl', selected.baseUrl, vscode.ConfigurationTarget.Global);
	}
}

async function removeProviderAccount(context, state) {
	const accounts = state.getAccounts();
	if (!accounts.length) {
		vscode.window.showInformationMessage('No OpenGravity provider accounts are saved.');
		return;
	}

	const accountPick = await vscode.window.showQuickPick(accounts.map(account => ({
		label: describeAccount(account),
		description: account.active ? 'active' : getProvider(account.provider).id,
		account
	})), {
		placeHolder: 'Remove OpenGravity provider account'
	});

	if (!accountPick) {
		return;
	}

	const answer = await vscode.window.showWarningMessage(
		`Remove ${accountPick.account.label}? The stored API key will be deleted from SecretStorage.`,
		{ modal: true },
		'Remove'
	);
	if (answer !== 'Remove') {
		return;
	}

	await context.secrets.delete(`${SECRET_PREFIX}.${accountPick.account.id}.apiKey`);
	await state.setAccounts(accounts.filter(account => account.id !== accountPick.account.id));

	const activeAccount = state.activeAccount;
	if (activeAccount) {
		await state.config.update('defaultProvider', activeAccount.provider, vscode.ConfigurationTarget.Global);
		await state.config.update('defaultModel', activeAccount.model, vscode.ConfigurationTarget.Global);
	}
}

function defaultAccountLabel(accounts, providerId) {
	const provider = getProvider(providerId);
	const count = accounts.filter(account => account.provider === provider.id).length;
	return count ? `${provider.label} ${count + 1}` : provider.label;
}

function createAccountId(providerId) {
	const random = Math.random().toString(36).slice(2, 8);
	return `${providerId}-${Date.now()}-${random}`;
}

async function runApprovedPlan(state) {
	const mode = state.mode;
	const decision = evaluateAction(mode, 'run_task');
	if (!decision.allowed) {
		vscode.window.showWarningMessage(decision.reason);
		return;
	}

	const answer = await vscode.window.showWarningMessage(
		'Agent runtime is not connected in this milestone. No task will be executed.',
		{ modal: true },
		'OK'
	);

	if (answer === 'OK') {
		await state.appendMessage('system', 'Run plan requested, but no runtime worker is connected yet.');
	}
}

function createStatusBar(state) {
	const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 92);
	item.name = 'OpenGravity';
	item.command = 'opengravity.openAgent';

	const update = () => {
		const mode = state.mode;
		const model = state.model;
		item.text = `OpenGravity: ${model} | ${mode}`;
		item.tooltip = `${modeDescription(mode)} Approval profile: ${state.approvalProfile}.`;
		item.show();
	};

	update();
	vscode.workspace.onDidChangeConfiguration(event => {
		if (event.affectsConfiguration('opengravity')) {
			update();
		}
	});

	return item;
}

function renderAgentHtml(webview, state) {
	const nonce = getNonce();
	const account = state.activeAccount;
	const history = state.getHistory();
	const mode = state.mode;
	const providerLabel = account ? describeAccount(account) : 'Connect provider';
	const messages = history.length ? history.map(renderMessage).join('') : renderEmptyState();
	const connectButton = account
		? `<button class="ghost" data-action="switch-account" title="Switch provider account">${escapeHtml(providerLabel)}</button>`
		: '<button class="connect" data-action="connect">Connect</button>';

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<style>
		:root {
			--og-bg: #0b0f12;
			--og-panel: #11171d;
			--og-panel-soft: #171d24;
			--og-text: #d8e7f5;
			--og-muted: #7f91a3;
			--og-border: #202a35;
			--og-accent: #62d6e8;
			--og-user: #1c2430;
		}

		* {
			box-sizing: border-box;
		}

		body {
			margin: 0;
			min-height: 100vh;
			background: var(--og-bg);
			color: var(--og-text);
			font: 12px/1.45 var(--vscode-font-family);
		}

		button,
		select,
		textarea {
			font: inherit;
		}

		.shell {
			display: grid;
			grid-template-rows: auto 1fr auto;
			min-height: 100vh;
			padding: 10px 10px 8px;
			gap: 8px;
		}

		.topbar {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 8px;
			min-height: 28px;
		}

		.title {
			color: var(--og-muted);
			letter-spacing: .04em;
			text-transform: uppercase;
		}

		.feed {
			overflow: auto;
			padding: 6px 0 12px;
		}

		.empty {
			display: flex;
			min-height: 52vh;
			flex-direction: column;
			justify-content: center;
			gap: 10px;
			color: var(--og-muted);
		}

		.empty strong {
			color: var(--og-text);
			font-size: 14px;
		}

		.message {
			margin: 0 0 12px;
			padding: 10px 11px;
			border: 1px solid var(--og-border);
			border-radius: 12px;
			background: var(--og-panel);
		}

		.message.user {
			background: var(--og-user);
		}

		.message .role {
			margin-bottom: 5px;
			color: var(--og-muted);
			font-size: 11px;
			text-transform: uppercase;
			letter-spacing: .05em;
		}

		.composer {
			border: 1px solid var(--og-border);
			border-radius: 14px;
			background: var(--og-panel-soft);
			box-shadow: 0 14px 40px rgba(0, 0, 0, .22);
			overflow: hidden;
		}

		textarea {
			width: 100%;
			min-height: 68px;
			max-height: 180px;
			resize: vertical;
			border: 0;
			outline: 0;
			padding: 12px;
			color: var(--og-text);
			background: transparent;
		}

		textarea::placeholder {
			color: #647384;
		}

		.composer-row {
			display: flex;
			align-items: center;
			gap: 7px;
			padding: 8px;
			border-top: 1px solid var(--og-border);
		}

		button,
		select {
			height: 28px;
			border: 1px solid var(--og-border);
			border-radius: 10px;
			color: var(--og-text);
			background: #101720;
		}

		button {
			padding: 0 10px;
			cursor: pointer;
		}

		select {
			min-width: 86px;
			padding: 0 8px;
		}

		.spacer {
			flex: 1;
		}

		.connect {
			border-color: rgba(98, 214, 232, .45);
			background: rgba(98, 214, 232, .13);
		}

		.ghost {
			max-width: 170px;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.send {
			background: rgba(98, 214, 232, .2);
			border-color: rgba(98, 214, 232, .45);
		}

		.hint {
			color: var(--og-muted);
			font-size: 11px;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
	</style>
</head>
<body>
	<div class="shell">
		<div class="topbar">
			<div class="title">Agent</div>
			${connectButton}
		</div>
		<main class="feed">${messages}</main>
		<section class="composer" aria-label="OpenGravity composer">
			<textarea id="prompt" placeholder="Ask anything, @ to mention, / for workflows"></textarea>
			<div class="composer-row">
				<button class="ghost" title="Add context">+</button>
				<select id="mode" aria-label="Agent mode">
					<option value="ask"${mode === 'ask' ? ' selected' : ''}>Ask</option>
					<option value="planning"${mode === 'planning' ? ' selected' : ''}>Planning</option>
					<option value="agent"${mode === 'agent' ? ' selected' : ''}>Agent</option>
				</select>
				<div class="hint">${escapeHtml(providerLabel)}</div>
				<div class="spacer"></div>
				<button class="send" id="send">Send</button>
			</div>
		</section>
	</div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const prompt = document.getElementById('prompt');
		document.getElementById('send').addEventListener('click', () => {
			vscode.postMessage({ type: 'send', text: prompt.value });
			prompt.value = '';
		});
		document.getElementById('mode').addEventListener('change', event => {
			vscode.postMessage({ type: 'setMode', mode: event.target.value });
		});
		document.querySelectorAll('[data-action="connect"]').forEach(button => {
			button.addEventListener('click', () => vscode.postMessage({ type: 'connect' }));
		});
		document.querySelectorAll('[data-action="switch-account"]').forEach(button => {
			button.addEventListener('click', () => vscode.postMessage({ type: 'switchAccount' }));
		});
		prompt.addEventListener('keydown', event => {
			if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
				event.preventDefault();
				document.getElementById('send').click();
			}
		});
	</script>
</body>
</html>`;
}

function renderEmptyState() {
	const workspaceName = vscode.workspace.name || 'Open a workspace';
	return `<div class="empty">
	<strong>${escapeHtml(workspaceName)}</strong>
	<div>Connect a provider, choose a mode, and continue from a clean workspace chat.</div>
</div>`;
}

function renderMessage(message) {
	const role = message.role === 'user' ? 'user' : 'assistant';
	return `<article class="message ${role}">
	<div class="role">${escapeHtml(message.role)}</div>
	<div>${escapeHtml(message.content)}</div>
</article>`;
}

function escapeHtml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function getNonce() {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let value = '';
	for (let i = 0; i < 32; i++) {
		value += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return value;
}

module.exports = {
	activate,
	deactivate
};
