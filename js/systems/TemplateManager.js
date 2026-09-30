'use strict';

class TemplateManager {
	constructor(editor) {
		this.editor = editor;
		this.session = null;
	}

	async applyProject(templateId) {
		try {
			const entry = await TemplateLibrary.get(templateId);
			if (!entry || entry.mode !== 'project') throw new Error('That project template is unavailable.');
			const project = await TemplateLibrary.loadProject(templateId);
			const loaded = await this.editor.projectSerializer.load(project);
			if (loaded) this.editor.updateStatus(`${entry.label} template created`);
			return loaded;
		} catch (error) {
			this.editor.showError(`Could not open template. ${error.message}`);
			return false;
		}
	}

	async previewOverlay(templateId) {
		if (!this.editor.originalImage) {
			this.editor.showError('Create a canvas or open an image before adding a template.');
			return false;
		}
		this.cancelPreview();
		try {
			const entry = await TemplateLibrary.get(templateId);
			if (!entry || entry.mode !== 'overlay') throw new Error('That overlay template is unavailable.');
			const project = this.editor.projectSerializer.runMigrations(await TemplateLibrary.loadProject(templateId));
			const report = await this.editor.projectSerializer.preflight(project);
			if (report.issues.length) {
				const confirmed = await this.editor.confirmAction({
					title: 'Template Content Unavailable',
					message: `${entry.label} has unavailable content.`,
					details: report.issues.map((issue) => issue.message),
					outro: 'Preview with the listed substitutions?',
					confirmLabel: 'Preview Anyway'
				});
				if (!confirmed) return false;
				this.editor.projectSerializer.applyPreflightSubstitutions(project, report);
			}
			const sourceLayers = project.layers.filter((layer) => layer.type !== LayerType.BASE_IMAGE);
			if (!this.editor.layerManager.requireLayerCapacity(sourceLayers.length)) return false;
			const scaleX = this.editor.originalCanvas.width / project.canvas.width;
			const scaleY = this.editor.originalCanvas.height / project.canvas.height;
			const uniformScale = Math.min(scaleX, scaleY);
			const previousActiveLayerId = this.editor.activeLayerId;
			const layers = [];
			for (const source of sourceLayers) {
				const layerData = structuredClone(source);
				layerData.id = this.editor.layerManager.generateLayerId();
				const layer = await this.editor.layerManager.deserializeLayer(layerData);
				if (!layer) continue;
				scaleDocumentLayerState(layer, scaleX, scaleY, uniformScale, {
					scaleEffects: true,
					scaleTextures: true
				});
				PreviewLayerSession.stage(layer);
				layers.push(layer);
			}
			this.editor.layers.push(...layers);
			this.session = { entry, layers, previousActiveLayerId };
			this.editor.requestPreviewUpdate();
			this.editor.updateStatus(`Previewing ${entry.label}`);
			const confirmed = await this.editor.confirmAction({
				title: 'Add Template',
				message: `${entry.label} is previewed on the canvas. Add these ${layers.length} editable layer${layers.length === 1 ? '' : 's'}?`,
				confirmLabel: 'Add Template'
			});
			if (confirmed) this.commitPreview();
			else this.cancelPreview();
			return confirmed;
		} catch (error) {
			this.cancelPreview();
			this.editor.showError(`Could not add template. ${error.message}`);
			return false;
		}
	}

	commitPreview() {
		if (!this.session) return;
		const { entry, layers } = this.session;
		PreviewLayerSession.commit(layers);
		this.session = null;
		this.editor.layerManager.renderLayersList();
		this.editor.layerManager.restoreSelectionState(layers.at(-1)?.id || null);
		this.editor.requestPreviewUpdate();
		this.editor.saveState(`Add ${entry.label} template`);
		this.editor.updateActionButtons();
		this.editor.updateStatus(`${entry.label} template added`);
	}

	cancelPreview() {
		if (!this.session) return;
		const { layers, previousActiveLayerId } = this.session;
		PreviewLayerSession.remove(this.editor, layers);
		this.session = null;
		this.editor.layerManager.restoreSelectionState(previousActiveLayerId);
		this.editor.requestPreviewUpdate();
		this.editor.updateActionButtons();
	}
}
