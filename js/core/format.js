function formatUnit(value, unit) {
	if (!unit) return String(value);
	return `${value}<span class="setting-unit">${unit}</span>`;
}

function formatDimensions(width, height, unit = 'px') {
	return `${width}<span class="setting-separator"> × </span>${height}<span class="setting-unit">${unit}</span>`;
}

// A slider whose raw value is an opaque internal range (Auto Glitter / Canvas
// pixel-effects "Combine Similar" run 0.01–0.12) reads as its 0–100 % position
// through that range instead. One home for the maths so the boot text, the live
// bindSlider readout, the editable pill and every manager agree.
function formatRangePercent(value, min, max) {
	const span = Number(max) - Number(min);
	const percent = span ? Math.round((Number(value) - Number(min)) / span * 100) : 0;
	return formatUnit(percent, '%');
}

function rangePercentToValue(percent, min, max) {
	const clamped = Math.min(100, Math.max(0, Number(percent)));
	return Number(min) + clamped / 100 * (Number(max) - Number(min));
}

// ============================================
// GALLERY PICKER STRIP COPY
// ============================================
// One wording for every armed glitter picker: what is being chosen, then the
// destination. Named layers use their name; unnamed layers get a clean
// "Current Text Layer"-style fallback without fabricated quoted names.
function formatBytes(bytes, decimals = 2) {
	if (!Number.isFinite(bytes) || bytes <= 0) return '0 Bytes';
	const k = 1024;
	const dm = decimals < 0 ? 0 : decimals;
	const sizes = ['Bytes', 'KB', 'MB'];
	const index = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
	return `${parseFloat((bytes / Math.pow(k, index)).toFixed(dm))} ${sizes[index]}`;
}

function downloadBlob(blob, fileName) {
	const objectUrl = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = objectUrl;
	anchor.download = fileName;
	document.body.appendChild(anchor);
	anchor.click();
	document.body.removeChild(anchor);
	setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

function sanitizeFileName(name) {
	if (typeof name !== 'string') return null;
	const sanitized = name
		.replace(/[\\/:*?"<>|]/g, '')
		.trim()
		.replace(/[.\s]+$/g, '')
		.replace(/\s+/g, '-');
	return sanitized || null;
}

// ============================================
// MODAL UTILITIES
// ============================================

