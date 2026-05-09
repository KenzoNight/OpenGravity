'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const product = readJson('product.json');
const agentPackage = readJson('extensions/opengravity-agent/package.json');

assert.strictEqual(product.nameShort, 'OpenGravity');
assert.strictEqual(product.nameLong, 'OpenGravity');
assert.strictEqual(product.applicationName, 'opengravity');
assert.strictEqual(product.dataFolderName, '.opengravity');
assert.strictEqual(product.urlProtocol, 'opengravity');
assert.strictEqual(product.win32AppUserModelId, 'OpenGravity.IDE');

assert.ok(product.extensionsGallery, 'OpenGravity must define an extension gallery.');
assert.strictEqual(product.extensionsGallery.serviceUrl, 'https://open-vsx.org/vscode/gallery');
assert.strictEqual(product.extensionsGallery.itemUrl, 'https://open-vsx.org/vscode/item');

assert.strictEqual(product.defaultChatAgent, undefined, 'Do not ship a Microsoft Copilot default chat agent.');
assert.strictEqual(product.trustedExtensionAuthAccess, undefined, 'Do not pre-authorize Microsoft chat extensions.');
assert.strictEqual(product.builtInExtensionsEnabledWithAutoUpdates, undefined, 'Do not auto-enable non-OpenGravity built-in chat extensions.');
assert.strictEqual(product.webviewContentExternalBaseUrlTemplate, undefined, 'Do not depend on the Microsoft vscode-cdn webview endpoint.');

assert.strictEqual(agentPackage.name, 'opengravity-agent');
assert.strictEqual(agentPackage.publisher, 'opengravity');
assert.strictEqual(agentPackage.main, './extension.js');

const secondarySidebar = agentPackage.contributes.viewsContainers.secondarySidebar;
assert.ok(Array.isArray(secondarySidebar), 'Agent must contribute to the Secondary Side Bar.');
assert.strictEqual(secondarySidebar[0].id, 'opengravity.agent.container');
assert.strictEqual(secondarySidebar[0].title, 'Agent');

const agentViews = agentPackage.contributes.views['opengravity.agent.container'];
assert.ok(Array.isArray(agentViews), 'Agent container must include a view.');
assert.strictEqual(agentViews[0].id, 'opengravity.agent');

const commands = new Set(agentPackage.contributes.commands.map(command => command.command));
for (const command of [
	'opengravity.openAgent',
	'opengravity.connectProvider',
	'opengravity.runPlan',
	'opengravity.clearHistory'
]) {
	assert.ok(commands.has(command), `Missing command ${command}.`);
}

for (const setting of Object.keys(agentPackage.contributes.configuration.properties)) {
	assert.ok(setting.startsWith('opengravity.'), `Setting ${setting} must use the opengravity namespace.`);
}

console.log('OpenGravity bootstrap validation passed');

function readJson(relativePath) {
	return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}
