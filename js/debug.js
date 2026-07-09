function dbg(...args) {
	if (typeof CONFIG !== 'undefined' && CONFIG.debug?.enabled) {
		console.log(...args);
	}
}

window.dbg = dbg;

