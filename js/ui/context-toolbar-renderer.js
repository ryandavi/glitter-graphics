class ContextToolbarRenderer {
	constructor(editor) {
		this.editor = editor;
	}

	render() {
		(CONFIG.ui.contextToolbars || []).forEach((toolbar) => {
			const host = document.getElementById(toolbar.id);
			if (!host) return;
			host.replaceChildren(...(toolbar.controls || []).map((control) => this.build(control)));
		});
	}

	build(control) {
		if (control.kind === 'group') {
			const group = document.createElement('div');
			group.append(...control.controls.map((child) => this.build(child)));
			return group;
		}
		if (control.kind === 'button') {
			const node = document.getElementById('tpl-context-button').content.firstElementChild.cloneNode(true);
			node.id = control.id; node.title = control.title; node.dataset.action = control.action;
			node.querySelector('use').setAttribute('href', `#icon-${control.icon}`);
			node.querySelector('.name').textContent = control.name;
			node.addEventListener('click', () => COMMANDS[control.action]?.run(this.editor));
			return node;
		}
		if (control.kind === 'readout') {
			const node = document.createElement('div');
			node.className = 'zoom-percentage'; node.id = control.id; node.title = control.title; node.textContent = control.value;
			node.addEventListener('click', () => COMMANDS[control.action]?.run(this.editor));
			return node;
		}
		if (control.kind === 'slider') {
			const spec = control.slider ? CONFIG.ui.sliders[control.slider] : control;
			const node = document.getElementById('tpl-context-slider').content.firstElementChild.cloneNode(true);
			node.querySelector('.context-label').textContent = control.label || spec.label;
			const input = node.querySelector('input'); input.id = control.id; input.min = spec.min; input.max = spec.max; input.value = spec.value;
			const value = node.querySelector('.context-value'); value.id = control.valueId; value.textContent = `${spec.value}${control.unit || spec.unit || ''}`;
			return node;
		}
		const node = document.getElementById('tpl-context-toggle').content.firstElementChild.cloneNode(true);
		node.querySelector('input').id = control.id; node.querySelector('.context-toggle-label').textContent = control.label;
		const count = node.querySelector('.context-count'); if (control.countId) count.id = control.countId; else count.remove();
		return node;
	}

	setValue(id, value) { const node = document.getElementById(id); if (node) node.textContent = value; }
	setEnabled(id, enabled) { const node = document.getElementById(id); if (node) node.disabled = !enabled; }
}
