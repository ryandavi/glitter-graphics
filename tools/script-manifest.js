const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const scriptManifest = require('../js/script-manifest.json');
const owners = new Map();

for (const [group, files] of Object.entries(scriptManifest)) {
	if (!Array.isArray(files)) throw new Error(`Script group ${group} must be an ordered array`);
	for (const file of files) {
		if (typeof file !== 'string' || !/^js\/[a-zA-Z0-9_/-]+\.js$/u.test(file)) throw new Error(`Invalid script path in ${group}: ${file}`);
		if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing script in ${group}: ${file}`);
		if (owners.has(file)) throw new Error(`Script ${file} belongs to both ${owners.get(file)} and ${group}`);
		owners.set(file, group);
	}
}
if (!scriptManifest.head || !scriptManifest.boot) throw new Error('The script manifest requires head and boot groups');

function getScriptUrls(group) {
	if (!scriptManifest[group]) throw new Error(`Unknown script group: ${group}`);
	return scriptManifest[group].map((file) => {
		const hash = crypto.createHash('md5').update(fs.readFileSync(path.join(root, file))).digest('hex').slice(0, 8);
		return `${file}?v=${hash}`;
	});
}

module.exports = { scriptManifest, getScriptUrls };
