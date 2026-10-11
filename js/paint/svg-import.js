'use strict';

const SvgImport = (() => {
	const ratio = (value) => Math.max(0,Math.min(1,String(value).endsWith('%') ? parseFloat(value)/100 : Number(value)));
	const identity = () => [1, 0, 0, 1, 0, 0];
	const multiply = (a, b) => [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
	function transform(value) {
		let matrix = identity();
		if (String(value || '').replace(/([a-z]+)\s*\(([^)]*)\)/gi, '').replace(/[\s,]/g, '')) throw new Error('Invalid SVG transform');
		for (const match of String(value || '').matchAll(/([a-z]+)\s*\(([^)]*)\)/gi)) {
			const v = match[2].trim().split(/[\s,]+/).map(Number);
			if (!v.every(Number.isFinite)) throw new Error('Invalid SVG transform');
			const angle = v[0] * Math.PI / 180;
			let next;
			switch (match[1]) {
			case 'matrix': if (v.length === 6) next = v; break;
			case 'translate': if (v.length < 1 || v.length > 2) break; next = [1,0,0,1,v[0],v[1] || 0]; break;
			case 'scale': if (v.length < 1 || v.length > 2) break; next = [v[0],0,0,v[1] ?? v[0],0,0]; break;
			case 'rotate': if (v.length !== 1 && v.length !== 3) break; next = [Math.cos(angle),Math.sin(angle),-Math.sin(angle),Math.cos(angle),0,0]; if (v.length === 3) next = multiply(multiply([1,0,0,1,v[1],v[2]],next),[1,0,0,1,-v[1],-v[2]]); break;
			case 'skewX': if (v.length !== 1) break; next = [1,0,Math.tan(angle),1,0,0]; break;
			case 'skewY': if (v.length !== 1) break; next = [1,Math.tan(angle),0,1,0,0]; break;
			}
			if (!next || !next.every(Number.isFinite)) throw new Error('Unsupported SVG transform');
			matrix = multiply(matrix, next);
		}
		return matrix;
	}
	function mapSubpaths(subpaths, matrix) {
		const map = (p, translated) => ({ x: matrix[0]*p.x+matrix[2]*p.y+(translated ? matrix[4] : 0), y: matrix[1]*p.x+matrix[3]*p.y+(translated ? matrix[5] : 0) });
		for (const subpath of subpaths) for (const point of subpath.points) {
			if (point.in) point.in = map(point.in, false);
			if (point.out) point.out = map(point.out, false);
			Object.assign(point, map(point, true));
		}
		return subpaths;
	}
	function length(value) {
		if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:px)?$/i.test(String(value).trim())) throw new Error('Unsupported SVG geometry units');
		return parseFloat(value);
	}
	function primitive(element) {
		const n = (key, fallback = 0) => { const raw = element.getAttribute(key); const value = raw === null ? fallback : length(raw); if (!Number.isFinite(value)) throw new Error('Unsupported SVG geometry units'); return value; };
		const tag = element.localName;
		if (tag === 'path') { const d = element.getAttribute('d') || ''; if (/[^MmLlHhVvCcSsQqTtAaZz\deE.,+\s-]/.test(d)) throw new Error('Unreadable SVG path'); return d; }
		if (tag === 'line') return `M${n('x1')} ${n('y1')}L${n('x2')} ${n('y2')}`;
		if (tag === 'polygon' || tag === 'polyline') { const values = (element.getAttribute('points') || '').trim(); return values ? `M${values}${tag === 'polygon' ? 'Z' : ''}` : ''; }
		if (tag === 'circle' || tag === 'ellipse') {
			const x=n('cx'), y=n('cy'), rx=tag === 'circle' ? n('r') : n('rx'), ry=tag === 'circle' ? rx : n('ry');
			return rx > 0 && ry > 0 ? `M${x-rx} ${y}A${rx} ${ry} 0 1 0 ${x+rx} ${y}A${rx} ${ry} 0 1 0 ${x-rx} ${y}Z` : '';
		}
		if (tag === 'rect') {
			const x=n('x'), y=n('y'), w=n('width'), h=n('height');
			if (w <= 0 || h <= 0) return '';
			const rx=Math.min(w/2, Math.max(0,n('rx',n('ry')))), ry=Math.min(h/2, Math.max(0,n('ry',n('rx'))));
			return rx && ry ? `M${x+rx} ${y}H${x+w-rx}A${rx} ${ry} 0 0 1 ${x+w} ${y+ry}V${y+h-ry}A${rx} ${ry} 0 0 1 ${x+w-rx} ${y+h}H${x+rx}A${rx} ${ry} 0 0 1 ${x} ${y+h-ry}V${y+ry}A${rx} ${ry} 0 0 1 ${x+rx} ${y}Z` : `M${x} ${y}H${x+w}V${y+h}H${x}Z`;
		}
		return null;
	}
	function attributes(element, inherited, stylesheet = new Map()) {
		const paint = { ...inherited };
		for (const key of ['fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','fill-rule','fill-opacity','stroke-opacity','color','display','visibility']) if (element.hasAttribute(key)) paint[key] = element.getAttribute(key);
		const style = { ...(stylesheet.get(element) || {}) };
		const inline = document.createElement('span').style;
		inline.cssText = element.getAttribute('style') || '';
		for (const key of inline) {
			if (stylesheet.get(element)?.[`${key}!important`] && !inline.getPropertyPriority(key)) continue;
			style[key] = inline.getPropertyValue(key);
		}
		for (const [key, value] of Object.entries(style)) if (value === 'inherit') style[key] = inherited[key];
		Object.assign(paint, style);
		for (const key of ['filter','mask','mask-image','clip-path']) if ((style[key] || element.getAttribute(key)) && (style[key] || element.getAttribute(key)) !== 'none') throw new Error(`${key} content`);
		if (style.transform && style.transform !== 'none') throw new Error('CSS transform content');
		if (style['mix-blend-mode'] && style['mix-blend-mode'] !== 'normal') throw new Error('Blend mode content');
		paint.opacity = Number(inherited.opacity ?? 1) * ratio(style.opacity ?? element.getAttribute('opacity') ?? 1);
		return paint;
	}
	function styles(doc) {
		const result = new Map();
		for (const node of doc.querySelectorAll('style')) {
			if (/@import/i.test(node.textContent)) throw new Error('External SVG stylesheet');
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(node.textContent);
			for (const rule of sheet.cssRules) {
				if (rule.type !== 1) throw new Error('Unsupported SVG stylesheet rule');
				for (const selector of rule.selectorText.split(',')) {
					// Restrict selectors to ordinary SVG authoring classes, ids and ancestry.
					if (selector.replace(/:root\b/g, '').includes(':')) throw new Error('Unsupported SVG stylesheet selector');
					const ids = (selector.match(/#[\w-]+/g) || []).length;
					const classes = (selector.match(/\.[\w-]+|\[[^\]]*\]|:root\b/g) || []).length;
					const tags = (selector.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|:root\b/g, '').match(/[a-z_][\w-]*/gi) || []).length;
					for (const element of doc.querySelectorAll(selector)) {
						let values = result.get(element);
						if (!values) { values = {}; result.set(element, values); }
						for (const key of rule.style) {
							const rank = [rule.style.getPropertyPriority(key) ? 1 : 0, ids, classes, tags];
							const old = values[`${key}!rank`];
							const difference = old ? rank.findIndex((value, i) => value !== old[i]) : -1;
							if (old && difference >= 0 && rank[difference] < old[difference]) continue;
							values[key] = rule.style.getPropertyValue(key);
							values[`${key}!rank`] = rank;
							values[`${key}!important`] = rank[0];
						}
					}
				}
			}
		}
		return result;
	}
	function parse(text) {
		const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
		const root = doc.documentElement;
		if (root.localName !== 'svg' || doc.querySelector('parsererror')) throw new Error('Invalid SVG document');
		const stylesheet = styles(doc);
		const view = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
		const hasView = view.length === 4 && view.every(Number.isFinite) && view[2] > 0 && view[3] > 0;
		const dimension = (key, fallback) => { const v = root.getAttribute(key); return v && /^\d+(?:\.\d+)?(?:px)?$/.test(v) ? parseFloat(v) : fallback; };
		const width=dimension('width',hasView ? view[2] : 300), height=dimension('height',hasView ? view[3] : 150);
		if (!(width > 0 && height > 0)) throw new Error('Invalid SVG size');
		let mapping = identity();
		if (hasView) {
			let sx=width/view[2], sy=height/view[3], dx=0, dy=0;
			const aspect = root.getAttribute('preserveAspectRatio') || 'xMidYMid meet';
			if (!aspect.includes('none')) { sx=sy=aspect.includes('slice') ? Math.max(sx,sy) : Math.min(sx,sy); dx=(width-view[2]*sx)*(aspect.includes('xMin') ? 0 : aspect.includes('xMax') ? 1 : 0.5); dy=(height-view[3]*sy)*(aspect.includes('YMin') ? 0 : aspect.includes('YMax') ? 1 : 0.5); }
			mapping=[sx,0,0,sy,dx-view[0]*sx,dy-view[1]*sy];
		}
		const items=[];
		const colorCanvas = createAppCanvas(1, 1, 'paint/svg-import');
		const colorContext = colorCanvas.getContext('2d', { willReadFrequently: true });
		const paintColor = (value, paint) => {
			if (value === 'currentColor') value=paint.color || '#000000';
			const ref=/^url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)$/.exec(value);
			if (ref) {
				const target=doc.getElementById(ref[1]);
				const first=target?.querySelector('stop, [fill]');
				if (!first) return { color: '#000000', opacity: 1 };
				const p=attributes(first,{},stylesheet);
				const color=first.localName === 'stop' ? (p['stop-color'] || first.getAttribute('stop-color') || '#000000') : (p.fill || '#000000');
				if (/url\(|var\(/i.test(color) || !CSS.supports('color',color)) throw new Error('Unsupported SVG paint');
				return { color, opacity: ratio(first.localName === 'stop' ? (p['stop-opacity'] || first.getAttribute('stop-opacity') || 1) : (p['fill-opacity'] ?? 1)) };
			}
			if (/url\(/i.test(value) || !CSS.supports('color',value)) throw new Error('Unsupported SVG paint');
			return { color: value, opacity: 1 };
		};
		const walk = (el, parentMatrix, inherited, chain = new Set(), referenced = false) => {
			if (['defs','symbol','linearGradient','radialGradient','pattern','metadata','title','desc','script','style','filter','mask','clipPath'].includes(el.localName) && !referenced) return;
			if (el.localName === 'svg' && el !== root) throw new Error('Nested SVG viewport');
			const paint=attributes(el,inherited,stylesheet);
			if (paint.display === 'none') return;
			let matrix=multiply(parentMatrix,transform(el.getAttribute('transform')));
			if (el.localName === 'use') {
				const href=el.getAttribute('href') || el.getAttribute('xlink:href') || '';
				const target=href.startsWith('#') ? doc.getElementById(href.slice(1)) : null;
				if (!target || chain.has(target)) throw new Error('Unsupported SVG use reference');
				const next=new Set(chain); next.add(target);
				matrix=multiply(matrix,[1,0,0,1,Number(el.getAttribute('x') || 0),Number(el.getAttribute('y') || 0)]);
				walk(target,matrix,paint,next,true); return;
			}
			const d=primitive(el);
			if (d && paint.visibility !== 'hidden') {
				const subpaths=mapSubpaths(PathGeometry.parseSvgPath(d),matrix);
				if (!subpaths.length) throw new Error('Unreadable SVG path');
				const slot=(key) => {
					const value=paint[key] || (key === 'fill' ? '#000000' : 'none');
					if (value === 'none') return { mode: 'none', color: '#000000', opacity: 100 };
					const resolved=paintColor(value,paint);
					const color=resolved.color;
					if (/var\(|^(inherit|initial|unset|revert)$/i.test(color)) throw new Error('Unsupported SVG paint');
					colorContext.clearRect(0,0,1,1); colorContext.fillStyle=color; colorContext.fillRect(0,0,1,1);
					const rgba=colorContext.getImageData(0,0,1,1).data;
					return { mode: 'solid', color: rgbToHex(Array.from(rgba).slice(0,3)), opacity: 100 * ratio(paint[`${key}-opacity`] ?? 1) * rgba[3]/255 * resolved.opacity };
				};
				const fill=slot('fill'), stroke=slot('stroke');
				stroke.widthPx=length(paint['stroke-width'] ?? 1)*Math.sqrt(Math.abs(matrix[0]*matrix[3]-matrix[1]*matrix[2]));
				stroke.cap=paint['stroke-linecap'] === 'round' ? 'round' : paint['stroke-linecap'] === 'square' ? 'square' : 'flat'; stroke.edgeStyle=paint['stroke-linejoin'] === 'round' ? 'round' : 'miter';
				const item={ subpaths, fill, stroke: stroke.mode === 'none' ? null : stroke, fillRule: paint['fill-rule'] || 'nonzero', opacity: paint.opacity * 100, name: el.id || '' };
				const previous=items[items.length-1];
				const signature=JSON.stringify([fill,item.stroke,item.fillRule,item.opacity]);
				if (previous?.signature === signature) previous.subpaths.push(...subpaths); else items.push({ ...item,signature });
			} else if (d === null && !['svg','g','a'].includes(el.localName)) throw new Error(`${el.localName} content`);
			for (const child of el.children) walk(child,matrix,paint,chain);
		};
		walk(root,mapping,{ opacity: 1 });
		if (!items.length) throw new Error('No readable geometry');
		for (const item of items) {
			if (!['nonzero','evenodd'].includes(item.fillRule)) throw new Error('Unsupported SVG fill rule');
			if (![item.opacity, item.fill.opacity, item.stroke?.opacity ?? 100, item.stroke?.widthPx ?? 0].every(Number.isFinite)) throw new Error('Unsupported SVG paint units');
			for (const subpath of item.subpaths) for (const point of subpath.points) if (![point.x,point.y,point.in?.x ?? 0,point.in?.y ?? 0,point.out?.x ?? 0,point.out?.y ?? 0].every(Number.isFinite)) throw new Error('Invalid SVG geometry');
		}
		return { width,height,items };
	}
	return { parse, primitive, transform, multiply, mapSubpaths };
})();

function parseSvgDocument(text) { return SvgImport.parse(text); }
