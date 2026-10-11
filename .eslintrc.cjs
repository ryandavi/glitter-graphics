const { scriptManifest, getGroupGlobals } = require('./tools/script-manifest');
const config = {
	"env": {
		"browser": true,
		"es2022": true,
		"node": true
	},
	"parserOptions": {
		"ecmaVersion": 2022,
		"sourceType": "script",
		"ecmaFeatures": {
			"globalReturn": false
		}
	},
	"rules": {
		"no-unreachable": "error",
		"no-unused-vars": [
			"warn",
			{
				"args": "none",
				"vars": "local"
			}
		],
		"no-dupe-class-members": "error",
		"no-fallthrough": "error",
		"no-self-assign": "error",
		"no-restricted-syntax": [
			"error",
			{
				"selector": "MemberExpression[optional=true][object.name='CONFIG']",
				"message": "CONFIG is always present; read its declared defaults directly."
			},
			{
				"selector": "UnaryExpression[operator='typeof'][argument.name='CONFIG']",
				"message": "CONFIG is always present in editor scripts."
			}
		]
	},
	"ignorePatterns": [
		"js/vendor/**",
		"js/workers/gif.worker.js",
		"js/generated/**",
		"node_modules/**"
	],
	"overrides": [
		{
			"files": [
				"js/core/debug.js",
				"js/effects/**",
				"js/workers/**"
			],
			"rules": {
				"no-restricted-syntax": "off"
			}
		}
	]
};

config.globals = { VideoEncoder: 'readonly', VideoFrame: 'readonly', EyeDropper: 'readonly' };

const groupGlobals = getGroupGlobals();
const shared = [...groupGlobals.head, ...groupGlobals.boot];
for (const [id, files] of Object.entries(scriptManifest)) {
	const forbidden = Object.entries(groupGlobals).filter(([owner]) => owner !== id && owner !== 'head' && owner !== 'boot').flatMap(([owner, names]) => names.filter(name => !shared.includes(name)).flatMap(property => ['window', 'self', 'globalThis', 'root'].map(object => ({ object, property, message: `Load the ${owner} group and use its exports.` }))));
	config.overrides.push({
		files,
		globals: Object.fromEntries([...shared, ...groupGlobals[id]].map(name => [name, 'readonly'])),
		rules: { 'no-undef': ['error', { typeof: true }], 'no-restricted-properties': ['error', ...forbidden] }
	});
}

module.exports = config;
