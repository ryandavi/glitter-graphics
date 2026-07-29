'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js/ui/hints.js'), 'utf8');
const context = {};
vm.createContext(context);
vm.runInContext(`${source}\nglobalThis.__rules = HINT_RULES;`, context);
const ids = context.__rules.map((rule) => rule.id);
assert(ids.every(Boolean), 'Every hint rule needs a stable id');
assert(new Set(ids).size === ids.length, 'Hint rule ids must be unique');
assert(context.__rules.every((rule) => typeof rule.when === 'function'), 'Every hint rule needs a predicate');
process.stdout.write(`PASS ${ids.length} hint rules have unique ids and predicates\n`);
