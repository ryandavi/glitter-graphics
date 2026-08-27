'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/core/commands.js'), 'utf8');
const guide = fs.readFileSync(path.join(root, 'modals/guide.html'), 'utf8').toLowerCase();
const context = {};
vm.createContext(context);
vm.runInContext(`${source}\nglobalThis.__commands = COMMANDS; globalThis.__getShortcutGroups = getShortcutGroups;`, context);

Object.entries(context.__commands).forEach(([id, command]) => {
	if (!command.keys?.length) return;
	assert(command.label, `${id} has keys but no user-facing label`);
	assert(guide.includes(command.label.toLowerCase()), `${id} (${command.label}) is missing from modals/guide.html`);
});

[
	'trackpadPan',
	'trackpadZoom',
	'middleButtonPan',
	'scrubbyZoom',
	'fitToolGesture',
	'resetToolGesture'
].forEach((id) => {
	const command = context.__commands[id];
	assert(command?.binding?.type === 'gesture' && command.binding.device && command.binding.gesture,
		`${id} is missing its structured pointer/trackpad gesture binding`);
});

const keyboardGroups = Array.from(context.__getShortcutGroups('keyboard'), ({ title }) => title);
const gestureGroups = Array.from(context.__getShortcutGroups('gesture'), ({ title }) => title);
assert.deepStrictEqual(keyboardGroups, ['Essentials', 'Tools', 'Canvas & View', 'Selection', 'Transform', 'Brush']);
assert.deepStrictEqual(gestureGroups, ['Navigate', 'Move & Transform']);

process.stdout.write('PASS documented keyboard commands are covered by the guide\n');
