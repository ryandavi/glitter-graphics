const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const browseFields = new Set([
	'id', 'name', 'filename', 'url', 'thumbnailUrl', 'category', 'attribution',
	'stickerText', 'tags', 'searchTerms', 'colors', 'generatedName', 'sortOrder',
	'isAnimated', 'hasTransparency', 'isPixelated', 'featured', 'source'
]);

for (const type of ['glitter', 'stickers']) {
	const manifestPath = path.join(root, 'data', `${type}.json`);
	const records = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	const detailDirectory = path.join(root, 'data', type);
	fs.mkdirSync(detailDirectory, { recursive: true });

	const index = records.map((record) => Object.fromEntries(
		Object.entries(record).filter(([key]) => browseFields.has(key))
	));
	fs.writeFileSync(
		path.join(root, 'data', `${type}.index.json`),
		`${JSON.stringify(index, null, 2)}\n`,
		'utf8'
	);
	for (const record of records) {
		fs.writeFileSync(
			path.join(detailDirectory, `${record.id}.json`),
			`${JSON.stringify(record, null, 2)}\n`,
			'utf8'
		);
	}
}

process.stdout.write('Split glitter and sticker manifests into browse indexes and detail records\n');
