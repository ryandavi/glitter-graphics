'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'js/core/commands.js'), 'utf8');
const context = {};
vm.createContext(context);
vm.runInContext(`${source}\nglobalThis.__commands = COMMANDS; globalThis.__getShortcutGroups = getShortcutGroups;`, context);

Object.entries(context.__commands).forEach(([id, command]) => {
	if (!command.keys?.length) return;
	assert(command.label, `${id} has keys but no user-facing label`);
});

// The guide's shortcut list, tool headings and panel titles are generated from
// COMMANDS, TOOLS and PANEL_SCHEMAS by tools/build-modals.js. Fail when the
// committed guide is stale, so a new or renamed command is always documented.
const guideBuild = require(path.join(root, 'tools/build-modals.js')).buildOne('guide', { check: true, stamp: false });
assert(guideBuild.ok, 'modals/guide.html is out of date: run node tools/build-modals.js guide');

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
assert.deepStrictEqual(keyboardGroups, ['Essentials', 'Tools', 'Canvas & View', 'Selection', 'Transform', 'Brush', 'Gradient']);
assert.deepStrictEqual(gestureGroups, ['Navigate', 'Move & Transform']);

process.stdout.write('PASS shortcut structure; generated guide is current\n');
