
// Pixel Scaler
document.querySelectorAll('img[data-pixel-scale]').forEach(img => {
	const s = Number(img.dataset.pixelScale);
	img.style.width = img.naturalWidth * s + 'px';
	img.style.height = img.naturalHeight * s + 'px';
	img.style.imageRendering = 'pixelated';
});

// Reference linking and highlighting functionality
document.addEventListener('DOMContentLoaded', function () {
	const modalBody = document.querySelector('#aboutModal .modal-body');

	// Add IDs to sup elements and make them clickable
	const sups = modalBody.querySelectorAll('sup');
	sups.forEach((sup, index) => {
		const refNum = sup.textContent.match(/\d+/)[0];
		// Add both a unique ID and a class for the reference number
		sup.id = `ref-link-${refNum}-${index}`;
		sup.classList.add(`ref-${refNum}`);
		sup.style.cursor = 'pointer';

		sup.addEventListener('click', function (e) {
			e.preventDefault();
			const targetRef = modalBody.querySelector(`#ref-${refNum}`);
			if (targetRef) {
				// Remove any existing highlights
				modalBody.querySelectorAll('.highlight').forEach(el => el.classList.remove('highlight'));

				// Scroll to reference
				targetRef.scrollIntoView({ behavior: 'smooth', block: 'center' });

				// Highlight the reference
				targetRef.classList.add('highlight');
				setTimeout(() => targetRef.classList.remove('highlight'), 2000);
			}
		});
	});

	// Add IDs to reference list items and make them clickable
	const refList = modalBody.querySelector('h3:has(+ ol) + ol');
	if (refList) {
		const refItems = refList.querySelectorAll('li');
		refItems.forEach((item, index) => {
			const refNum = index + 1;
			item.id = `ref-${refNum}`;
			item.style.cursor = 'pointer';

			item.addEventListener('click', function (e) {
				// Don't trigger if clicking on a link
				if (e.target.tagName === 'A') return;

				e.preventDefault();

				// Find ALL occurrences of this reference number
				const targetSups = modalBody.querySelectorAll(`sup.ref-${refNum}`);

				if (targetSups.length > 0) {
					// Remove any existing highlights
					modalBody.querySelectorAll('.highlight').forEach(el => el.classList.remove('highlight'));

					// Scroll to first mention
					targetSups[0].scrollIntoView({ behavior: 'smooth', block: 'center' });

					// Highlight ALL matching sup elements
					targetSups.forEach(sup => {
						sup.classList.add('highlight');
					});

					// Remove highlights after 2 seconds
					setTimeout(() => {
						targetSups.forEach(sup => {
							sup.classList.remove('highlight');
						});
					}, 2000);
				}
			});
		});
	}
});