'use strict';

// The homepage's one interaction: the swatches refill the wordmark with another
// Library tile and update its credit (site/home.php renders both, so the page
// reads the same without JavaScript). With reduced motion, every tile shows its
// first frame instead of animating.
(() => {
	const canvas = document.getElementById('homeCanvas');
	const credit = document.getElementById('homeCredit');
	const swatches = [...document.querySelectorAll('.home-swatch')];
	if (!canvas || !credit) return;

	const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
	const painted = [canvas, ...swatches];
	// data-tile keeps each element's animated url() value; --tile is what shows.
	painted.forEach((element) => { element.dataset.tile = element.style.getPropertyValue('--tile'); });

	// A GIF background can't be paused, so draw its first frame and use that.
	const stillFrames = new Map();
	function stillFrame(value) {
		if (!stillFrames.has(value)) {
			stillFrames.set(value, new Promise((resolve) => {
				const image = new Image();
				image.onload = () => {
					const drawn = document.createElement('canvas');
					drawn.width = image.naturalWidth;
					drawn.height = image.naturalHeight;
					drawn.getContext('2d').drawImage(image, 0, 0);
					resolve(`url("${drawn.toDataURL()}")`);
				};
				image.onerror = () => resolve(value);
				image.src = value.match(/url\("?([^")]+)"?\)/u)?.[1] || '';
			}));
		}
		return stillFrames.get(value);
	}

	async function paint(element) {
		const tile = element.dataset.tile;
		const shown = reducedMotion.matches ? await stillFrame(tile) : tile;
		if (element.dataset.tile === tile) element.style.setProperty('--tile', shown);
	}

	swatches.forEach((swatch) => {
		swatch.addEventListener('click', () => {
			canvas.dataset.tile = swatch.dataset.tile;
			canvas.style.setProperty('--tile-w', swatch.style.getPropertyValue('--tile-w'));
			canvas.style.setProperty('--tile-h', swatch.style.getPropertyValue('--tile-h'));
			paint(canvas);
			swatches.forEach((other) => other.setAttribute('aria-pressed', String(other === swatch)));
			credit.innerHTML = swatch.dataset.credit;
		});
	});

	reducedMotion.addEventListener('change', () => painted.forEach(paint));
	if (reducedMotion.matches) painted.forEach(paint);
})();
