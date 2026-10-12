'use strict';

function pushRecent(list, entry, limit, isSame) {
	return [entry, ...list.filter(candidate => !isSame(candidate, entry))].slice(0, limit);
}
