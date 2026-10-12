'use strict';
const assert = require('assert');
const { openApp } = require('../lib/app');
(async () => {
	const { browser, page, errors } = await openApp({ viewport: { width: 1400, height: 1000 } });
	try {
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
			editor.exportSettings.svgTextMode = 'paths';
			const outlineSvg=await editor.svgExporter.serialize([layer,text,shape],100,100);
			const read = source => new DOMParser().parseFromString(source, 'image/svg+xml');
			const rasterize = async source => {
				const url=URL.createObjectURL(new Blob([source],{ type: 'image/svg+xml' }));
				try {
					const image=new Image(); image.src=url; await image.decode();
					const canvas=document.createElement('canvas'); canvas.width=image.width; canvas.height=image.height;
					canvas.getContext('2d').drawImage(image,0,0); return canvas;
				} finally { URL.revokeObjectURL(url); }
			};
			const compareSurface = async (source, mask, sourcePaint) => {
				const doc=read(source), root=doc.documentElement;
				root.setAttribute('width',mask.width); root.setAttribute('height',mask.height); root.setAttribute('viewBox',`0 0 ${mask.width} ${mask.height}`);
				const group=root.querySelector(':scope > g'); group.removeAttribute('opacity'); group.removeAttribute('style'); group.firstElementChild.remove();
				group.firstElementChild.removeAttribute('transform');
				const actual=await rasterize(new XMLSerializer().serializeToString(root));
				const expected=document.createElement('canvas'); expected.width=mask.width; expected.height=mask.height;
				const ctx=expected.getContext('2d');
				editor.sceneCompositor._paintSourceInto(ctx,mask.width,mask.height,sourcePaint,{ maskCanvas: mask });
				ctx.globalAlpha=1; ctx.globalCompositeOperation='destination-in'; ctx.drawImage(mask,0,0);
				const a=actual.getContext('2d').getImageData(0,0,mask.width,mask.height).data;
				const b=ctx.getImageData(0,0,mask.width,mask.height).data;
				let delta=0, reference=0;
				for (let i=0;i<a.length;i+=4) {
					reference+=b[i+3];
					for (let c=0;c<3;c++) delta+=Math.abs(a[i+c]*a[i+3]/255-b[i+c]*b[i+3]/255);
					delta+=Math.abs(a[i+3]-b[i+3]);
				}
				check(reference>0 && delta/(reference*4)<0.06,`rendered SVG surface differs: ${delta/(reference*4)}`);
			};
			const outlines=read(outlineSvg);
			check(!outlines.querySelector('parsererror') && !outlines.querySelector('text') && outlines.querySelectorAll('path').length >= 3,'default text is font-independent geometry');
			const all=await editor.svgExporter.serialize([layer,text,shape],100,100,{ ...editor.exportSettings, svgTextMode: 'editable' });
			const xml=read(all); check(!xml.querySelector('parsererror') && xml.querySelector('text'),'optional editable text');
			check(xml.querySelector('text').textContent.includes('A & B'),'escaped text');
			text.textData.warp = { type: 'arc', bend: 50 };
			check(isTextWarpActive(text.textData.warp), 'fixture has active warp');
			const warped=read(await editor.svgExporter.serialize([text],100,100,{ ...editor.exportSettings, svgTextMode: 'editable' }));
			check(!warped.querySelector('text') && warped.querySelector('[data-slot="fill"] path'),'warped text stays geometry in editable mode');
			text.textData.warp.bend=0;
			Object.assign(text.textData.fill,{ mode: 'solid',color: '#8844ff' });
			text.textData.text='O & B'; text.textData.warp.bend=35;
			text.transform.scale={ x: 140,y: 80 };
			let textMasks=await editor.textGlitterManager.renderSlotMasks(text);
			await compareSurface(await editor.svgExporter.serialize([text],100,100),textMasks.fill,{ mode: 'solid',color: '#8844ff',opacity: 1 });
			text.transform.position={ x: 200,y: 200 }; text.transform.rotation=23; text.transform.flipX=true;
			const world=await rasterize(await editor.svgExporter.serialize([text],400,400));
			const expectedWorld=document.createElement('canvas'); expectedWorld.width=expectedWorld.height=400;
			const worldCtx=expectedWorld.getContext('2d'), transform=text.transform;
			worldCtx.translate(transform.position.x,transform.position.y); worldCtx.rotate(transform.rotation*Math.PI/180);
			worldCtx.scale(-transform.scale.x/100/(textMasks.rasterScale?.x || 1),transform.scale.y/100/(textMasks.rasterScale?.y || 1));
			worldCtx.drawImage(textMasks.fill,-textMasks.renderWidth/2,-textMasks.renderHeight/2);
			const actualAlpha=world.getContext('2d').getImageData(0,0,400,400).data, expectedAlpha=worldCtx.getImageData(0,0,400,400).data;
			let alphaDelta=0, alphaTotal=0;
			for (let i=3;i<actualAlpha.length;i+=4) { alphaDelta+=Math.abs(actualAlpha[i]-expectedAlpha[i]); alphaTotal+=expectedAlpha[i]; }
			check(alphaTotal>0 && alphaDelta/alphaTotal<0.08,'warped text world placement preserves unequal scale, rotation and flip');
			text.textData.textBackground.enabled=true;
			Object.assign(text.textData.textBackground.fill,{ mode: 'solid',color: '#ffcc00' });
			check(read(await editor.svgExporter.serialize([text],100,100)).querySelector('[data-slot="backgroundFill"] path'),'warped text backing shape');
			text.textData.textBackground.enabled=false; text.textData.warp.bend=0;
			const fill=shape.shapeData.fill;
			Object.assign(fill,{ mode: 'gradient', opacity: 60, gradient: { type: 'linear', angle: 45, interpolation: 'steps', stops: [{ offset: 0,color: '#ff0000',alpha: 0.5 },{ offset: 1,color: '#0000ff',alpha: 1 }] } });
			shape.opacity=50; shape.blendMode='multiply';
			let result=read(await editor.svgExporter.serialize([shape],100,100));
			check(result.querySelector('linearGradient stop[stop-color="#ff0000"]') && result.querySelectorAll('stop').length===3,'step gradient exported with alpha');
			check(result.querySelector('path[fill-opacity="0.6"]') && result.querySelector('g[opacity="0.5"][style="mix-blend-mode:multiply"]'),'slot and layer opacity and blend preserved');
			fill.gradient.type='radial'; fill.gradient.interpolation='smooth';
			result=read(await editor.svgExporter.serialize([shape],100,100));
			check(result.querySelector('radialGradient') && result.querySelectorAll('stop').length>2,'radial and smooth gradients');
			await compareSurface(new XMLSerializer().serializeToString(result),editor.shapeGlitterManager.renderSlotMasks(shape).fill,resolveEffectPaintSource(fill));
			Object.assign(fill,{ mode: 'pattern', pattern: { type: 'gingham', color: '#ff0000',backgroundColor: '#ffffff' } });
			result=read(await editor.svgExporter.serialize([shape],100,100));
			check(result.querySelector('pattern rect') && !result.querySelector('image'),'patterns contain vector tiles');
			await compareSurface(new XMLSerializer().serializeToString(result),editor.shapeGlitterManager.renderSlotMasks(shape).fill,resolveEffectPaintSource(fill));
			Object.assign(fill,{ mode: 'solid',color: '#336699' });
			shape.shapeData.border={ ...getSlotDefaults(LayerType.SHAPE,'border'),mode: 'solid',color: '#ff00ff',widthPx: 5 };
			shape.shapeData.shadow={ ...getSlotDefaults(LayerType.SHAPE,'shadow'),mode: 'solid',color: '#000000',blur: 5,offsetX: 10,offsetY: 8 };
			shape.shapeData.bevel={ enabled: true, highlight: { ...getSlotDefaults(LayerType.SHAPE,'bevelHighlight'),mode: 'solid',color: '#ffffff' },shade: { ...getSlotDefaults(LayerType.SHAPE,'bevelShade'),mode: 'solid',color: '#000000' } };
			result=read(await editor.svgExporter.serialize([shape],100,100));
			for (const key of ['border','shadow','bevelHighlight','bevelShade']) check(result.querySelector(`[data-slot="${key}"] path`),`${key} geometry`);
			check([...result.querySelectorAll('[data-slot="shadow"] path')].some(path => Number(path.getAttribute('opacity'))<1),'soft shadow carries alpha contours');
			const stroke=layer.pathData.stroke={ ...buildDefaultStroke(),mode: 'solid',color: '#00ff00',dashStyle: 'dashed',dashPx: 7,gapPx: 3,dashOffsetPx: 2,widthPx: 4 };
			result=read(await editor.svgExporter.serialize([layer],100,100));
			check(result.querySelector('path[stroke-dasharray="7 3"][stroke-dashoffset="2"]'),'native dashed stroke');
			stroke.endShapeId='arrowHead'; layer.pathData.subpaths[0].closed=false;
			result=read(await editor.svgExporter.serialize([layer],100,100));
			check(result.querySelector('[data-slot="stroke"] path[fill="#00ff00"]'),'arrowhead and trimmed stroke exported');
			const originalDetails=editor.glitterLibrary.ensureAssetDetails;
			editor.glitterLibrary.ensureAssetDetails=async () => ({ colorCodes: ['#ff0000','#0000ff'],colorWeights: [0.2,0.8] });
			try {
				Object.assign(fill,{ mode: 'glitter',glitterId: 67,colorAdjust: { brightness: 50 } });
				result=read(await editor.svgExporter.serialize([shape],100,100));
				check(result.querySelector('path[fill="#000080"]'),'dominant glitter color respects adjustment');
				editor.glitterLibrary.ensureAssetDetails=async () => null;
				const job={ colors: new Map() }, missing={ mode: 'glitter',glitterId: 'missing' };
				check(await editor.svgExporter.dominantColor(missing,{ color: '#ff0000' },job)==='#ff0000' && await editor.svgExporter.dominantColor(missing,{ color: '#0000ff' },job)==='#0000ff','missing palette falls back per slot');
			} finally { editor.glitterLibrary.ensureAssetDetails=originalDetails; }
			fill.mode='image';
			result=read(await editor.svgExporter.serialize([shape],100,100));
			check(!result.querySelector('image') && result.querySelector('[data-slot="border"]'),'image fill omitted while outline remains');
			const frame=editor.layerManager.addLayer(LayerType.FRAME);
			const base=editor.getBaseLayer(); base.background.mode='gradient';
			result=read(await editor.svgExporter.serialize([base,frame],100,100));
			check(result.querySelector('rect[width="100"][height="100"]') && result.querySelector('[data-slot^="shade"] path'),'canvas background and style frame');
			frame.frameData.kind='image'; base.background.mode='image';
			check(SvgExporter.count([frame,base]).vectors===0,'raster frames and backgrounds excluded from eligibility');
			frame.visible=false;
			const painted=editor.layerManager.addLayer(LayerType.GLITTER_FILL);
			const buffer=editor.paintMaskStore.ensurePaintMask(painted.id);
			buffer.add.getContext('2d').fillRect(10,10,40,40); buffer.hasContent=true; buffer.liveRevision++; painted.maskHasContent=true;
			Object.assign(painted.fill,{ mode: 'solid',color: '#ff6600' }); painted.opacity=40;
			editor.maskCompositor.reset();
			const paintedSvg=await editor.svgExporter.serialize([painted],100,100);
			check(read(paintedSvg).querySelector('[data-slot="fill"] path[fill-opacity="1"]'),'painted mask converted to vectors with opacity applied once');
			await compareSurface(paintedSvg,editor.glitterManager.renderSlotMasks(painted).fill,{ mode: 'solid',color: '#ff6600',opacity: 1 });
			painted.visible=false;
			let cancelled=false;
			try { await editor.svgExporter.serialize([shape],100,100,editor.exportSettings,{ isCancelled: () => true }); } catch (error) { cancelled=error.message==='Export cancelled'; }
			check(cancelled,'SVG cancellation');
			check(await editor.svgExporter.serialize([shape],100,100)===await editor.svgExporter.serialize([shape],100,100),'repeated SVG exports stable');
			setActiveExportTarget(editor.exportSettings,'still:svg'); editor.updateExportFormatUI();
			check(!document.getElementById('exportSettingsExport').disabled,'vectors enable export');
			check(!document.getElementById('exportSvgTextMode').closest('.settings-row').hidden,'SVG text option shown');
			const textOption=document.getElementById('exportSvgTextMode'); textOption.value='editable'; textOption.dispatchEvent(new Event('change',{ bubbles: true }));
			check(editor.exportSettings.svgTextMode==='editable' && editor.settingsStore.serialize(editor.exportSettings).exportSvgTextMode==='editable','text option persists');
			setActiveExportTarget(editor.exportSettings,'still:png'); editor.updateExportFormatUI();
			check(textOption.closest('.settings-row').hidden,'text option hidden outside SVG');
			setActiveExportTarget(editor.exportSettings,'still:svg'); editor.updateExportFormatUI();
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
			manager.applySessionSettings(null);
			check(manager.captureSessionSettings().maxHueShift===20,'defaults restore the default hue limit');
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
		assert(checks);
		await page.evaluate(async () => {
			const asset=editor.stickerLibrary.getRenderContent().find(item => item.isAnimated);
			if (!asset) throw new Error('Animated sticker fixture unavailable');
			const sticker=editor.stickerManager.createLayer(asset.id); editor.layerManager.insertLayer(sticker);
			const shape=editor.layerManager.addLayer(LayerType.SHAPE);
			Object.assign(shape.shapeData.fill,{ mode: 'solid',color: '#2266aa' });
			editor.saveState('SVG baseline');
			const ids=[shape.id,sticker.id], render=() => editor.svgExporter.serialize(editor.layers.filter(layer => ids.includes(layer.id)),editor.originalCanvas.width,editor.originalCanvas.height);
			const baseline=await render();
			if (baseline!==await render() || baseline.includes('<image')) throw new Error('Repeated SVG with animated sticker is unstable or contains image');
			shape.shapeData.fill.color='#aa6622'; editor.saveState('Change SVG fill');
			if (baseline===await render()) throw new Error('SVG edit did not change output');
			await editor.undo();
			if (baseline!==await render() || baseline!==await render()) throw new Error('SVG edit/undo or repeated export is unstable');
		});
		assert.deepStrictEqual(errors,[]); console.log('PASS SVG import, image-free vector export, paints/effects, text modes, rendering, settings and edit/undo stability');
	} finally { await browser.close(); }
})().catch(error=>{ console.error(error); process.exit(1); });
