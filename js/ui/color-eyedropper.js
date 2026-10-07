'use strict';

function initializeColorEyedroppers(editor) {
	let armedInput = null;

	const applyColor = (input, color) => {
		if (!input || !/^#[0-9a-f]{6}$/i.test(color)) return;
		input.value = color.toLowerCase();
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.dispatchEvent(new Event('change', { bubbles: true }));
	};

	const sampleCanvas = async (x, y) => {
		const layers = editor.showAllLayers
			? editor.layers.filter((layer) => layer.visible && !layer.isPreview && layerHasVisibleContent(layer))
			: [editor.layerManager.getActiveLayer()].filter((layer) => layer?.visible && layerHasVisibleContent(layer));
		const callbacks = {
			onStatus: () => {},
			onProgress: () => {},
			isCancelled: () => false,
			createMask: (layer) => editor.maskCompositor.getMaskData(layer),
			renderSlotMasks: (layer) => getLayerManagerForType(editor, layer.type).renderSlotMasks(layer),
			ensureTextFont: (fontId) => FontLibrary.ensureLoaded(fontId)
		};
		const composed = await editor.sceneCompositor.composeFrameAt({
			visibleLayers: layers,
			glitterGifs: editor.glitterLibrary.getRenderContent(),
			canvasData: {
				width: editor.originalCanvas.width,
				height: editor.originalCanvas.height,
				originalData: new Uint8ClampedArray(editor.originalImageData.data),
				originalAlpha: editor.originalAlphaChannel,
				alphaThreshold: CONFIG.tools.selection.transparency.alphaThreshold,
				hasBaseImage: editor.baseBackgroundManager?.hasBaseImage() ?? true
			},
			exportSettings: { ...structuredClone(editor.exportSettings), watermarkEnabled: false, transparency: true },
			target: EXPORT_TARGETS['still:png'],
			timestamp: editor.animationTicker.getCurrentTime(),
			callbacks
		});
		const offset = (Math.max(0, Math.min(composed.height - 1, y)) * composed.width
			+ Math.max(0, Math.min(composed.width - 1, x))) * 4;
		const data = composed.imageData.data;
		return `#${[data[offset], data[offset + 1], data[offset + 2]].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
	};

	const armCanvasSample = (input) => {
		armedInput = input;
		document.querySelectorAll('.color-eyedropper-button').forEach((button) => button.classList.toggle('active', button._colorInput === input));
		editor.updateStatus('Tap the canvas to sample a color');
	};

	const install = (input) => {
		if (input.dataset.eyedropperBound != null || input.closest('.color-input-with-eyedropper')) return;
		input.dataset.eyedropperBound = '';
		const hex = input.nextElementSibling?.matches('.color-hex-input') ? input.nextElementSibling : null;
		const wrapper = document.createElement('span');
		wrapper.className = 'color-input-with-eyedropper';
		input.before(wrapper);
		wrapper.appendChild(input);
		if (hex) { wrapper.classList.add('has-hex'); wrapper.appendChild(hex); }
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'btn-icon-simple icon-wrapper sm color-eyedropper-button';
		button.title = 'Sample color';
		button.setAttribute('aria-label', 'Sample color');
		button.appendChild(createIcon('eyedropper'));
		button._colorInput = input;
		button.addEventListener('click', async () => {
			if (input.disabled) return;
			if (typeof window.EyeDropper === 'function') {
				try {
					const result = await new EyeDropper().open();
					applyColor(input, result.sRGBHex);
				} catch (error) {
					if (error.name !== 'AbortError') editor.showError('Could not sample that color');
				}
				return;
			}
			armCanvasSample(input);
		});
		wrapper.appendChild(button);
	};

	const scan = (root) => {
		if (root.matches?.('input[type="color"]')) install(root);
		root.querySelectorAll?.('input[type="color"]').forEach(install);
	};
	scan(document);
	new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach((node) => {
		if (node.nodeType === Node.ELEMENT_NODE) scan(node);
	}))).observe(document.body, { childList: true, subtree: true });

	document.addEventListener('pointerdown', async (event) => {
		if (!armedInput || !editor.previewContainer.contains(event.target)) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		const input = armedInput;
		armedInput = null;
		document.querySelectorAll('.color-eyedropper-button.active').forEach((button) => button.classList.remove('active'));
		const point = editor.viewport.screenToCanvas(event.clientX, event.clientY);
		if (!editor.viewport.isWithinCanvas(point.x, point.y)) return;
		editor.updateStatus('Sampling color…');
		const done = editor.beginActivity('sample-color', 'Sampling color');
		try {
			applyColor(input, await sampleCanvas(Math.floor(point.x), Math.floor(point.y)));
			editor.updateStatus('Color sampled');
		} catch (error) {
			console.error('Canvas color sampling failed:', error);
			editor.showError('Could not sample the canvas color');
		} finally {
			done();
			editor.sceneCompositor.releaseDecodedSources();
		}
	}, true);
}
