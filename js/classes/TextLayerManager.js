class TextLayer {
	constructor(editor) {
		this.editor = editor;
		this.layerElements = new Map();
		this.layerTransforms = new Map();
	}
	
	createLayer(text = 'New Text') {
		return {
			id: generateId(),
			type: LayerType.TEXT,
			name: text,
			visible: true,
			locked: false,
			
			textData: {
				text: text,
				fontSize: 48,
				fontFamily: 'Comic Sans MS',
				color: '#FF00FF',
				
				// Same transform structure as stickers
				transform: {
					position: { x: 200, y: 200 },
					rotation: 0,
					scale: { x: 100, y: 100 },
					proportionalScale: true,
					opacity: 100,
					flipX: false,
					flipY: false
				},
				
				// Text needs dimensions too
				width: 200,  // calculated from text
				height: 60,  // calculated from text
				
				element: null
			}
		};
	}
	
	renderLayer(layer) {
		if (layer.type !== LayerType.TEXT) return;
		
		// Create text element
		const element = document.createElement('div');
		element.className = 'text-element';
		element.dataset.layerId = layer.id;
		element.textContent = layer.textData.text;
		
		// Apply text styles
		element.style.fontSize = layer.textData.fontSize + 'px';
		element.style.fontFamily = layer.textData.fontFamily;
		element.style.color = layer.textData.color;
		
		// CREATE LayerTransform instance (same as stickers!)
		const transform = new LayerTransform(layer, this.editor);
		transform.element = element;
		
		// Override getDimensions to read from textData instead of stickerData
		transform.getDimensions = () => ({
			width: layer.textData.width,
			height: layer.textData.height
		});
		
		// Override getTransform to read from textData
		transform.getTransform = () => layer.textData.transform;
		
		// Apply transform
		const dimensions = { width: layer.textData.width, height: layer.textData.height };
		transform.applyTransform(element, dimensions);
		
		// Setup interaction (same as stickers!)
		transform.setupMouseDrag(element);
		transform.setupTouchGestures(element);
		
		// Store references
		this.editor.canvasElementsContainer.appendChild(element);
		this.layerElements.set(layer.id, element);
		this.layerTransforms.set(layer.id, transform);
	}
	
}