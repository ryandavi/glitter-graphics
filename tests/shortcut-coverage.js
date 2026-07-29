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
vm.runInContext(`${source}\nglobalThis.__commands = COMMANDS;`, context);

Object.entries(context.__commands).forEach(([id, command]) => {
	if (!command.keys?.length) return;
	assert(command.label, `${id} has keys but no user-facing label`);
	assert(guide.includes(command.label.toLowerCase()), `${id} (${command.label}) is missing from modals/guide.html`);
});

process.stdout.write('PASS documented keyboard commands are covered by the guide\n');
