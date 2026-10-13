'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'js/core/features.js'), 'utf8');
function fixture({ stage = 'local', local = false, debug = false, search = '', phone = false, layout = 'desktop' } = {}) {
	const media = { matches: phone };
	let mediaCalls = 0;
	const context = vm.createContext({
		CONFIG: { app: { features: { param: 'features' } }, debug: { enabled: debug }, ui: { mobile: { breakpoint: 1040 } } },
		URLSearchParams,
		isLocalHost: () => local,
		window: { location: { search }, matchMedia: query => { assert.strictEqual(query, '(max-width: 1040px)'); mediaCalls++; return media; } }
	});
	vm.runInContext(source.replace("stage: 'local', layouts:", `stage: '${stage}', layouts:`).replace("['desktop']", `['${layout}']`), context);
	return { context, media, mediaCalls: () => mediaCalls, run: text => vm.runInContext(text, context) };
}

for (const stage of ['off', 'debug', 'local', 'beta', 'on']) {
	for (const local of [false, true]) for (const debug of [false, true]) {
		const app = fixture({ stage, local, debug });
		const expected = ['on', 'beta'].includes(stage) || (stage === 'debug' && debug) || (stage === 'local' && (local || debug));
		assert.strictEqual(app.run("isFeatureEnabled('timeline')"), expected, `${stage}, local=${local}, debug=${debug}`);
	}
}

assert(fixture({ search: '?features=timeline,gifCycle' }).run("isFeatureEnabled('timeline')"));
assert(!fixture({ stage: 'off', local: true, debug: true, search: '?features=timeline' }).run("isFeatureEnabled('timeline')"));
const app = fixture({ local: true });
assert.throws(() => app.run("isFeatureEnabled('missing')"), /Unknown feature/);
assert.throws(() => app.run("isFeatureEnabled('toString')"), /Unknown feature/);
assert.strictEqual(app.run('Object.keys(FEATURES).join()'), 'timeline,loopLength,gifCycle');
assert.strictEqual(app.run("featureLayout('timeline')"), 'desktop');
assert.strictEqual(app.run("featureLayout('loopLength')"), null);
assert(app.run("isFeatureAvailable('timeline')"));
app.media.matches = true;
assert(!app.run("isFeatureAvailable('timeline')"));
assert(app.run("isFeatureAvailable('loopLength')"));
assert.strictEqual(app.mediaCalls(), 1);
const phone = fixture({ local: true, layout: 'phone' });
assert(!phone.run("isFeatureAvailable('timeline')"));
phone.media.matches = true;
assert(phone.run("isFeatureAvailable('timeline')"));

const enabled = { hidden: true, dataset: { feature: 'timeline' } };
app.context.root = { querySelectorAll: () => [enabled] };
app.run('applyFeatureGates(root)');
assert.strictEqual(enabled.hidden, false);
assert.strictEqual(enabled.dataset.layout, 'desktop');
const disabledApp = fixture();
const disabled = { hidden: true, dataset: { feature: 'timeline' } };
disabledApp.context.root = { querySelectorAll: () => [disabled] };
disabledApp.run('applyFeatureGates(root)');
assert.strictEqual(disabled.hidden, true);
assert.strictEqual(disabled.dataset.layout, 'desktop');
disabledApp.context.window.location.search = '?features=timeline';
assert(!disabledApp.run("isFeatureEnabled('timeline')"), 'Stage is fixed for the page load');

app.context.COMMANDS = {};
app.context.sessionAllowsCommand = () => true;
vm.runInContext(fs.readFileSync(path.join(root, 'js/ui/keyboard.js'), 'utf8'), app.context);
assert(!app.context.isCommandAvailable({ feature: 'timeline' }, {}));
app.media.matches = false;
assert(app.context.isCommandAvailable({ feature: 'timeline' }, {}));
assert(!app.context.isCommandAvailable({ when: () => false }, {}));
console.log('PASS feature stages, overrides, layout changes, static gates and shared command availability');
