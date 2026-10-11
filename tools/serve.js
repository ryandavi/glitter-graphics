'use strict';

// Static server that gzips text responses, for load measurements. XAMPP and
// `php -S` send no compression, which makes the stylesheet and scripts three
// to six times larger on the wire than on a real host and hides what a change
// did. Usage: node tools/serve.js [--port 8100] [--root .] [--css scratch.css]

const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const root = path.resolve(option('--root', path.join(__dirname, '..')));
const port = Number(option('--port', 8100));
const cssOverride = option('--css', null);

const TYPES = {
	'.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css',
	'.json': 'application/json', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.png': 'image/png',
	'.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.wasm': 'application/wasm'
};
const COMPRESSED = new Set(['.html', '.js', '.css', '.json', '.svg']);
const cache = new Map();

http.createServer((request, response) => {
	let relative = decodeURIComponent(request.url.split('?')[0]);
	if (relative.endsWith('/')) relative += 'index.html';
	const file = cssOverride && relative === '/css/style.css' ? path.resolve(cssOverride) : path.join(root, relative);
	if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
		response.writeHead(404);
		response.end();
		return;
	}
	const extension = path.extname(file);
	const compress = COMPRESSED.has(extension);
	const modified = fs.statSync(file).mtimeMs;
	let entry = cache.get(file);
	if (!entry || entry.modified !== modified) {
		const body = fs.readFileSync(file);
		entry = { modified, body: compress ? zlib.gzipSync(body) : body };
		cache.set(file, entry);
	}
	const headers = {
		'Content-Type': TYPES[extension] || 'application/octet-stream',
		'Content-Length': entry.body.length,
		// The lifetime GitHub Pages sends, so warm runs behave like the live site.
		'Cache-Control': 'max-age=600'
	};
	if (compress) headers['Content-Encoding'] = 'gzip';
	response.writeHead(200, headers);
	response.end(entry.body);
}).listen(port, '127.0.0.1', () => {
	process.stdout.write(`Serving ${root} with gzip at http://127.0.0.1:${port}/\n`);
});
