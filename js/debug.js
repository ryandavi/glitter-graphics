function dbg(...args) {
	if (typeof CONFIG !== 'undefined' && CONFIG.debug) {
		console.log(...args);
	}
}

window.dbg = dbg;
