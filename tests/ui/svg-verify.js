'use strict';
const assert = require('assert');
const fs = require('fs');
const { chromium } = require('playwright');
(async () => {
	const browser=await chromium.launch({ headless: true });
	try {
		const page=await browser.newPage({ viewport: { width: 1400, height: 1000 } });
		if (process.env.GLITTER_TEST_CSS) await page.route('**/css/style.css*',(route) => route.fulfill({ contentType: 'text/css',body: fs.readFileSync(process.env.GLITTER_TEST_CSS) }));
		const errors=[]; page.on('pageerror',e => errors.push(e.message));
		await page.goto(process.env.GLITTER_URL || 'http://localhost/glitter/',{ waitUntil: 'networkidle' });
		await page.waitForFunction(() => window.editor);
		await page.evaluate(async () => { await editor.modalManager.open('exportSettingsModal'); editor.modalManager.closeAll({ force: true }); });
		const checks=await page.evaluate(async () => {
			const check=(condition,message) => { if (!condition) throw new Error(message); };
			const wrap=(body,attrs='viewBox="0 0 100 100"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
			const parsed=parseSvgDocument(wrap('<g transform="translate(10 20)"><rect x="1" y="2" width="10" height="20"/><rect x="20" width="4" height="5"/></g>'));
			check(parsed.items.length===1,'consecutive equal paints group');
			check(parsed.items[0].subpaths[0].points[0].x===11,'ancestor transform');
			const offset=parseSvgDocument(wrap('<path d="M10 20L110 120" fill="none" stroke="red"/>','viewBox="10 20 100 100"'));
			check(offset.items[0].subpaths[0].points[0].x===0,'viewBox origin');
			const use=parseSvgDocument(wrap('<defs><circle id="c" r="3"/></defs><use href="#c" x="20" y="30" fill="blue"/>'));
			check(use.items[0].fill.color==='#0000ff','use paint');
			const gradient=parseSvgDocument(wrap('<defs><linearGradient id="g"><stop stop-color="#ff0000"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/>'));
			check(gradient.items[0].fill.color==='#ff0000','gradient stand-in');
			for (const content of ['<image/>','<text>x</text>','<filter/>','<mask/>','<clipPath/>','<use href="#bad"/>','<rect width="10" height="10" style="filter:blur(2px)"/>']) {
				let rejected=false; try { parseSvgDocument(wrap(content)); } catch (_) { rejected=true; } check(rejected,`unsupported fallback: ${content}`);
			}
			const styled=parseSvgDocument(wrap('<style>rect { fill: red; } .paint { fill: blue; stroke: green; stroke-width: 2px; } #box { fill: yellow; } .paint { fill: purple !important; }</style><defs><filter id="unused"/><mask id="unusedMask"/><clipPath id="unusedClip"/></defs><rect id="box" class="paint" width="10px" height="20px" style="fill: orange"/>'));
			check(styled.items[0].fill.color==='#800080','stylesheet importance overrides normal inline style');
			check(styled.items[0].stroke.color==='#008000' && styled.items[0].stroke.widthPx===2,'class stroke and px units');
			check(styled.items[0].subpaths[0].points[1].x===10,'px geometry');
			const cascade=parseSvgDocument(wrap('<style>#box { fill: blue; } rect { fill: red; } .paint { fill: green; }</style><rect id="box" class="paint" width="10" height="10"/>'));
			check(cascade.items[0].fill.color==='#0000ff','id specificity wins over later rules');
			for (const property of ['filter','mask','clip-path']) {
				let rejected=false;
				try { parseSvgDocument(wrap(`<style>.paint { ${property}: url(#effect); }</style><rect class="paint" width="10" height="10"/>`)); } catch (_) { rejected=true; }
				check(rejected,`used stylesheet ${property} falls back`);
			}
			await openEditorFiles(editor,[new File([wrap('<path id="sample" d="M10 10L80 10L80 70Z" fill="#ff0000"/>')],'sample.svg',{ type: 'image/svg+xml' })]);
			check(editor.originalCanvas.width===100 && editor.originalCanvas.height===100,'SVG creates sized canvas');
			const layer=editor.layers.find(l=>l.type===LayerType.PATH); check(layer,'path imported');
			check(editor.layers.filter(l=>l.type===LayerType.STICKER).length===0,'no raster sticker');
			const exported=await editor.svgExporter.serialize([layer],100,100);
			let delivered; editor.svgExporter.setFileName('sample.svg');
			await editor.svgExporter.process({ visibleLayers: [layer],canvasData: { width: 100,height: 100 },target: EXPORT_TARGETS['still:svg'],callbacks: { onStatus: () => {},onComplete: () => {},present: (result) => { delivered=result; } } });
			check(delivered.file.name === 'sample.svg' && delivered.blob.type === 'image/svg+xml', 'SVG delivered through result contract');
			check(await delivered.blob.text() === exported, 'SVG blob content');
			const round=parseSvgDocument(exported);
			const original=structuredClone(layer.pathData.subpaths); SvgImport.mapSubpaths(original,SvgExporter.matrix(layer));
			const a=PathGeometry.getBounds(original),b=PathGeometry.getBounds(round.items[0].subpaths);
			check(Math.abs(a.minX-b.minX)<0.01 && Math.abs(a.maxY-b.maxY)<0.01,'export/import world geometry');
			const text=editor.layerManager.addLayer(LayerType.TEXT_GLITTER,{ textLayer: { text: 'A & B\nSecond' } });
			const shape=editor.layerManager.addLayer(LayerType.SHAPE);
			const all=await editor.svgExporter.serialize([layer,text,shape],100,100);
			const xml=new DOMParser().parseFromString(all,'image/svg+xml'); check(!xml.querySelector('parsererror'),'valid XML'); check(xml.querySelectorAll('path').length===2 && xml.querySelector('text'),'all vector kinds');
			check(xml.querySelector('text').textContent.includes('A & B'),'escaped text');
			setActiveExportTarget(editor.exportSettings,'still:svg'); editor.updateExportFormatUI();
			check(!document.getElementById('exportSettingsExport').disabled,'vectors enable export');
			for (const key of ['outputScale','targetSize','matteColor','baseImage','watermarkEnabled']) check(document.getElementById(EXPORT_SETTINGS_SCHEMA[key].element).closest('.settings-row').hidden,`${key} hidden`);
			for (const item of [layer,text,shape]) item.visible=false;
			editor.updateExportFormatUI(); check(document.getElementById('exportSettingsExport').disabled,'no vector export disabled');
			shape.visible=true; editor.layerManager.setActiveLayer(shape.id); editor.setTool(ToolType.CROP);
			check(document.getElementById('inspectorTitleText').textContent==='Canvas','Crop header');
			document.querySelector('#inspectorSwitch [data-value="shapeSettings"]').click();
			check(document.getElementById('inspectorTitleText').textContent==='Shape','switch retitles');
			check(document.getElementById('canvasSizeAnchor').tagName==='SELECT','shared anchor');
			editor.setCanvasAnchor('1,1'); editor.setCanvasBoundsDimension('width',120,false); check(editor.canvasBounds.rect.x===-20,'canvas right anchor');
			editor.setTool(ToolType.SELECT);
			editor.autoGlitterManager.applySessionSettings({ ...editor.autoGlitterManager.captureSessionSettings(),sourceAdjust: { hue: 30,saturation: 120,brightness: 90 } });
			check(editor.autoGlitterManager.captureSessionSettings().sourceAdjust.hue===30,'source adjust settings roundtrip');
			check(document.getElementById('autoGlitterSourceSummary').textContent==='Adjusted','source summary');
			const manager=editor.autoGlitterManager;
			manager.applySessionSettings({ ...manager.captureSessionSettings(),maxHueShift: 90 });
			check(manager.captureSessionSettings().maxHueShift===90 && manager.getWorkerOptions().maxHueShift===90,'hue limit saved and sent to worker');
			manager.applySessionSettings({ tuneHue: true });
			check(manager.captureSessionSettings().maxHueShift===20,'legacy sessions retain the old hue limit');
			manager.applySessionSettings({ ...manager.captureSessionSettings(),maxHueShift: 500 });
			check(manager.captureSessionSettings().maxHueShift===180,'hue limit clamped on restore');
			const schedule=manager.scheduleReduce;
			let reductions=0;
			manager.scheduleReduce=()=>{ reductions++; };
			const dirty=manager.segmentDirty;
			try {
				manager.ui.hueLimit.value='45';
				manager.ui.hueLimit.dispatchEvent(new Event('input',{ bubbles: true }));
				check(reductions===0,'hue slider waits for release');
				manager.ui.hueLimit.dispatchEvent(new Event('change',{ bubbles: true }));
				check(reductions===1 && manager.getWorkerOptions().maxHueShift===45,'slider release rematches glitter');
				document.getElementById('resetAutoGlitterHueLimit').click();
				check(manager.getWorkerOptions().maxHueShift===20 && reductions===2,'hue limit reset rematches at default');
				check(manager.segmentDirty===dirty,'hue limit changes preserve segmentation');
			} finally { manager.scheduleReduce=schedule; }


			const stickersBefore=editor.layers.filter(l=>l.type===LayerType.STICKER).length;
			await importSvgFile(editor,new File([all],'mixed.svg',{ type: 'image/svg+xml' }));
			check(editor.layers.filter(l=>l.type===LayerType.STICKER).length===stickersBefore+1,'mixed SVG falls back as a whole sticker');
			const canAdd=editor.layerManager.canAddLayers.bind(editor.layerManager);
			const save=editor.saveState.bind(editor); const labels=[];
			editor.layerManager.canAddLayers=(count=1)=>count>1 ? { ok: false, reason: 'fixture capacity' } : canAdd(count);
			editor.saveState=(label,...args)=>{ labels.push(label); return save(label,...args); };
			const pathsBefore=editor.layers.filter(l=>l.type===LayerType.PATH).length;
			try { await importSvgFile(editor,new File([wrap('<rect width="10" height="10" fill="red"/><circle cx="50" cy="50" r="10" fill="blue"/>')],'limited.svg',{ type: 'image/svg+xml' })); }
			finally { editor.layerManager.canAddLayers=canAdd; editor.saveState=save; }
			check(editor.layers.filter(l=>l.type===LayerType.PATH).length===pathsBefore+1,'capacity fallback makes one compound layer');
			check(labels.length===1 && labels[0]==='Import SVG','one history step per import');
			return true;
		});
		assert(checks); assert.deepStrictEqual(errors,[]); console.log('PASS SVG document import, fallback, export, UI flags, Inspector and Source settings');
	} finally { await browser.close(); }
})().catch(error=>{ console.error(error); process.exit(1); });
