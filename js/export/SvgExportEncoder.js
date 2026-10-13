'use strict';

class SvgExportEncoder {
	setFileName(name) { this.fileName = name; }
	async serialize(layers, width, height, settings = this.editor.exportSettings, callbacks = {}) {
		// Definitions and asset colors belong to one job, keeping repeated exports stable.
		const job = { defs: [], colors: new Map(), nextId: 0, settings, callbacks };
		const parts = [];
		for (const layer of layers) {
			if (!layer.visible || layer.isPreview || !layerHasVisibleContent(layer) || !SvgExporter.isEligible(layer, this.editor.layers)) continue;
			if (callbacks.isCancelled?.()) throw new Error('Export cancelled');
			const geometry = await LAYER_UI_CONFIG[layer.type].vectorGeometry(this.editor, layer);
			if (!geometry) continue;
			const content = await this.serializeGeometry(layer, geometry, job);
			const blend = GlitterBlendModes.forLayer(layer);
			parts.push(`<g opacity="${layer.opacity / 100}" style="mix-blend-mode:${SvgExporter.escape(blend)}"><title>${SvgExporter.escape(layer.name || '')}</title>${content}</g>`);
			await new Promise(resolve => setTimeout(resolve, 0));
		}
		return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="isolation:isolate"><defs>${job.defs.join('')}</defs>${parts.join('')}</svg>`;
	}
	async serializeGeometry(layer, geometry, job) {
		if (geometry.documentSpace) {
			const source = resolveEffectPaintSource(geometry.fill, { allowNone: true });
			const paint = await this.serializePaint(source, geometry.fill, geometry.rect, null, null, job);
			return paint ? `<rect x="0" y="0" width="${geometry.rect.width}" height="${geometry.rect.height}" ${paint}/>` : '';
		}
		const masks = geometry.masks;
		const sx = masks.rasterScale?.x || 1, sy = masks.rasterScale?.y || 1;
		const width = masks.renderWidth, height = masks.renderHeight;
		const matrix = SvgExporter.matrix(layer, { x: -width / (2 * sx), y: -height / (2 * sy) });
		matrix[0] /= sx; matrix[1] /= sx; matrix[2] /= sy; matrix[3] /= sy;
		const origin = { x: width / 2 + (geometry.offset?.x || 0) * sx, y: height / 2 + (geometry.offset?.y || 0) * sy };
		const rect = { x: 0, y: 0, width, height };
		const stack = geometry.stack || buildSlotStack(layer, entry => {
			const source = resolvePaintSlotSource(layer, entry);
			// Whole-layer opacity is already on the enclosing group.
			return source && entry.definition.wholeLayer ? { ...source, opacity: 1 } : source;
		});
		const parts = [];
		for (const slot of stack) {
			if (job.callbacks.isCancelled?.()) throw new Error('Export cancelled');
			if (slot.source.mode === 'image') continue;
			const canvas = masks[slot.key];
			if (!canvas) continue;
			const key = slot.key === 'stroke' ? 'stroke' : 'fill';
			const editable = slot.key === 'fill' && geometry.text && geometry.editableText && job.settings.svgTextMode === 'editable';
			const paintTransform = editable ? `matrix(${1 / sx} 0 0 ${1 / sy} ${-origin.x / sx} ${-origin.y / sy})` : '';
			const paint = await this.serializePaint(slot.source, slot.data, rect, canvas, layer, job, key, paintTransform);
			if (!paint) continue;
			if (slot.key === 'fill' && geometry.subpaths) {
				const paths = structuredClone(geometry.subpaths);
				SvgImport.mapSubpaths(paths, [sx, 0, 0, sy, origin.x, origin.y]);
				parts.push(`<path d="${SvgExporter.escape(PathGeometry.toSvgPath(paths))}" ${paint} fill-rule="${geometry.fillRule || 'nonzero'}"/>`);
			} else if (editable) {
				const text = geometry.text;
				parts.push(`<text ${paint} transform="translate(${origin.x} ${origin.y}) scale(${sx} ${sy})" font-family="${SvgExporter.escape(text.family)}" font-size="${text.size}" font-weight="${SvgExporter.escape(text.weight)}" font-style="${SvgExporter.escape(text.style)}" letter-spacing="${text.spacing}" text-decoration="${SvgExporter.escape(text.decoration)}" xml:space="preserve">${text.runs.map(run => `<tspan x="${run.x}" y="${run.baseline}">${SvgExporter.escape(run.text)}</tspan>`).join('')}</text>`);
			} else if (slot.key === 'stroke' && geometry.subpaths) {
				parts.push(`<g data-slot="stroke">${this.serializeStroke(geometry.subpaths, slot.data, origin, paint)}</g>`);
			} else {
				// Text and effects reuse the preview's settled silhouettes.
				const fillPaint = key === 'stroke' ? paint.replaceAll('stroke', 'fill') : paint;
				parts.push(`<g data-slot="${SvgExporter.escape(slot.key)}">${this.serializeContours(canvas, fillPaint)}</g>`);
			}
		}
		return `<g transform="matrix(${matrix.join(' ')})">${parts.join('')}</g>`;
	}
	serializeStroke(subpaths, stroke, origin, paint) {
		const dash = getStrokeLineDash(stroke);
		const caps = getStrokeDashStyle(stroke) === 'dotted' ? 'round' : STROKE_LINE_CAPS[getStrokeCap(stroke)];
		const filled = paint.replaceAll('stroke', 'fill');
		return subpaths.map(subpath => {
			if (subpath.points.length === 1) {
				const point = subpath.points[0];
				return `<circle cx="${origin.x + point.x}" cy="${origin.y + point.y}" r="${stroke.widthPx / 2}" ${filled}/>`;
			}
			const plan = planStrokeSubpath(subpath, stroke);
			const parts = [];
			if (plan.path) {
				const paths = structuredClone([plan.path]);
				SvgImport.mapSubpaths(paths, [1, 0, 0, 1, origin.x, origin.y]);
				parts.push(`<path d="${SvgExporter.escape(PathGeometry.toSvgPath(paths))}" fill="none" ${paint} stroke-width="${stroke.widthPx}" stroke-linecap="${caps}" stroke-linejoin="${getStrokeEdgeStyle(stroke)}" stroke-miterlimit="${CONFIG.tools.path.stroke.miterLimit}"${dash ? ` stroke-dasharray="${dash.join(' ')}" stroke-dashoffset="${(Number(stroke.dashOffsetPx) || 0) + plan.dashShift}"` : ''}/>`);
			}
			for (const placement of plan.ornaments) {
				const bounds = getStrokeOrnament(placement.shapeId).bounds;
				const paths = ShapeLibrary.getSubpaths(placement.shapeId, (bounds.maxX - bounds.minX) / 2, (bounds.maxY - bounds.minY) / 2, { fit: 'fill' });
				const a = Math.cos(placement.rotation) * placement.scale, b = Math.sin(placement.rotation) * placement.scale;
				const dx = (bounds.minX + bounds.maxX) / 2 - placement.originX, dy = (bounds.minY + bounds.maxY) / 2 - placement.originY;
				SvgImport.mapSubpaths(paths, [a, b, -b, a, origin.x + placement.x + a * dx - b * dy, origin.y + placement.y + b * dx + a * dy]);
				parts.push(`<path d="${SvgExporter.escape(PathGeometry.toSvgPath(paths))}" ${filled}/>`);
			}
			return parts.join('');
		}).join('');
	}
	serializeContours(canvas, paint) {
		const { width, height } = canvas;
		const pixels = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
		const levels = CONFIG.export.svg.alphaLevels;
		const alpha = new Uint8Array(width * height);
		const used = new Set();
		for (let index = 0; index < alpha.length; index++) {
			alpha[index] = Math.round(pixels[index * 4 + 3] / 255 * levels);
			if (alpha[index]) used.add(alpha[index]);
		}
		const coverage = new Uint8Array(alpha.length);
		return [...used].sort((a, b) => a - b).map(level => {
			for (let index = 0; index < alpha.length; index++) coverage[index] = alpha[index] === level ? 1 : 0;
			// Disjoint bands preserve soft alpha without repeatedly stacking opacity.
			const rings = traceMaskContours(coverage, width, height, 0);
			const d = rings.map(ring => `M${ring.map(point => `${point.x} ${point.y}`).join('L')}Z`).join('');
			return `<path d="${d}" ${paint} fill-rule="nonzero" opacity="${level / levels}"/>`;
		}).join('');
	}
	async serializePaint(source, data, rect, canvas, layer, job, key = 'fill', paintTransform = '') {
		if (!source || source.mode === 'image') return '';
		let color = source.color;
		if (source.mode === 'glitter') color = await this.dominantColor(source, data, job);
		if (source.mode === 'gradient') {
			const id = `svg-gradient-${job.nextId++}`;
			const g = getEffectGradientGeometry(source.gradient, rect);
			const tag = g.type === 'radial' ? 'radialGradient' : 'linearGradient';
			const coords = g.type === 'radial' ? `cx="${g.cx}" cy="${g.cy}" r="${g.radius}"` : `x1="${g.x0}" y1="${g.y0}" x2="${g.x1}" y2="${g.y1}"`;
			const stops = getEffectGradientRenderStops(g).map(stop => `<stop offset="${stop.offset}" stop-color="${stop.color}" stop-opacity="${Math.round(stop.alpha * 255) / 255}"/>`).join('');
			job.defs.push(`<${tag} id="${id}" gradientUnits="userSpaceOnUse" color-interpolation="sRGB"${paintTransform ? ` gradientTransform="${paintTransform}"` : ''} ${coords}>${stops}</${tag}>`);
			color = `url(#${id})`;
		} else if (source.mode === 'pattern') {
			const id = `svg-pattern-${job.nextId++}`;
			const tile = getPatternTile(source.pattern, source.scale);
			const origin = getPatternTextureOrigin(canvas, source, layer);
			job.defs.push(`<pattern id="${id}" patternUnits="userSpaceOnUse" x="${origin.x}" y="${origin.y}" width="${tile.width}" height="${tile.height}"${paintTransform ? ` patternTransform="${paintTransform}"` : ''}>${this.serializePatternTile(tile.canvas)}</pattern>`);
			color = `url(#${id})`;
		}
		return `${key}="${SvgExporter.escape(color)}" ${key}-opacity="${source.opacity}"`;
	}
	serializePatternTile(canvas) {
		const { width, height } = canvas;
		const pixels = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
		const parts = [];
		// Run-length rectangles encode procedural tiles, never uploaded image pixels.
		for (let y = 0; y < height; y++) for (let x = 0; x < width;) {
			const i = (y * width + x) * 4;
			let end = x + 1;
			while (end < width && [0, 1, 2, 3].every(c => pixels[(y * width + end) * 4 + c] === pixels[i + c])) end++;
			if (pixels[i + 3]) parts.push(`<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="rgb(${pixels[i]},${pixels[i + 1]},${pixels[i + 2]})" fill-opacity="${pixels[i + 3] / 255}"/>`);
			x = end;
		}
		return `<g shape-rendering="crispEdges">${parts.join('')}</g>`;
	}
	async dominantColor(source, data, job) {
		if (!job.colors.has(source.glitterId)) {
			// Palette metadata is optional; a missing detail file need not prevent vectors.
			const item = await this.editor.glitterLibrary.ensureAssetDetails(source.glitterId).catch(() => this.editor.glitterLibrary.getItemById(source.glitterId));
			const colors = item?.colorCodes || [];
			const weights = item?.colorWeights || [];
			let winner = 0;
			for (let i = 1; i < colors.length; i++) if ((weights[i] || 0) > (weights[winner] || 0)) winner = i;
			job.colors.set(source.glitterId, colors[winner] || null);
		}
		const rgb = parseHexColor(job.colors.get(source.glitterId) || data.color);
		const pixel = { data: new Uint8ClampedArray([...rgb, 255]) };
		applyColorAdjustToImageData(pixel, source.colorAdjust);
		return `#${[...pixel.data.slice(0, 3)].map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
	}
	async process({ visibleLayers, canvasData, target, exportSettings = this.editor.exportSettings, callbacks }) {
		const source = await this.serialize(visibleLayers, canvasData.width, canvasData.height, exportSettings, callbacks);
		if (callbacks.isCancelled?.()) throw new Error('Export cancelled');
		const blob = new Blob([source], { type: target.mimeType });
		deliverExportResult(callbacks, this.resultPresenter, { blob, fileName: this.fileName, completion: { still: true }, target, width: canvasData.width, height: canvasData.height });
		return blob;
	}
}
