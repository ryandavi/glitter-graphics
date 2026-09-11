(function (root) {
	// TODO(ryan): replace blank `name` values with the editor's display names.
	const attribution = Object.freeze({ source: 'Recipe after CSSgram (Una Kravets, MIT)', license: 'MIT' });
	const fill = (color, mode, opacity = 1) => ({ kind: 'fill', color, mode, opacity });
	const radial = (radius, stops, mode, opacity = 1, center = [0.5, 0.5]) => ({
		kind: 'gradient', mode, opacity,
		gradient: { type: 'radial', center, radius, shape: 'circle', sizing: 'farthest-corner', stops }
	});
	const stop = (at, color) => ({ at, color });
	const recipe = (instagramName, tone, ops) => ({ name: '', instagramName, attribution, tone: tone || null, ops: ops || [] });

	const FILTER_PRESETS = Object.freeze({
		rio: recipe('Rio de Janeiro', { contrast: 1.05, saturate: 1.18, brightness: 1.02 }, [
			{ kind: 'gradient', mode: 'soft-light', opacity: 0.55, gradient: { type: 'linear', angle: 160, stops: [
				stop(0, '#4a48b1'), stop(0.35, '#922b83'), stop(0.7, '#c13d5b'), stop(1, '#e07a35')
			] } }
		]),
		clarendon: recipe('Clarendon', { contrast: 1.2, saturate: 1.35 }, [fill('rgba(127,187,227,0.2)', 'overlay')]),
		juno: recipe('Juno', { sepia: 0.35, contrast: 1.15, brightness: 1.15, saturate: 1.8 }, [fill('rgba(255,190,100,0.3)', 'overlay')]),
		lark: recipe('Lark', { contrast: 0.9 }, [fill('#22253f', 'color-dodge'), fill('rgba(242,242,242,0.8)', 'darken')]),
		gingham: recipe('Gingham', { brightness: 1.05, hueRotate: -10 }, [fill('#e6e6fa', 'soft-light')]),
		valencia: recipe('Valencia', { contrast: 1.08, brightness: 1.08, sepia: 0.08 }, [fill('#3a0339', 'exclusion', 0.5)]),
		f1977: recipe('1977', { contrast: 1.1, brightness: 1.1, saturate: 1.3 }, [fill('rgba(243,106,188,0.3)', 'screen')]),
		nashville: recipe('Nashville', { sepia: 0.2, contrast: 1.2, brightness: 1.05, saturate: 1.2 }, [fill('rgba(247,176,153,0.56)', 'darken'), fill('rgba(0,70,150,0.4)', 'lighten')]),
		crossprocess: recipe('X-Pro II', { sepia: 0.3 }, [radial(1, [stop(0.4, '#e6e7e0'), stop(1.1, 'rgba(43,42,161,0.6)')], 'color-burn')]),
		lofi: recipe('Lo-Fi', { saturate: 1.1, contrast: 1.5 }, [radial(1, [stop(0.7, 'transparent'), stop(1.5, '#222222')], 'multiply')]),
		toaster: recipe('Toaster', { contrast: 1.5, brightness: 0.9 }, [radial(1, [stop(0, '#804e0f'), stop(1, '#3b003b')], 'screen')]),
		kelvin: recipe('Kelvin', null, [fill('#382c34', 'color-dodge'), fill('#b77d21', 'overlay')]),
		walden: recipe('Walden', { brightness: 1.1, hueRotate: -10, sepia: 0.3, saturate: 1.6 }, [fill('#0044cc', 'screen', 0.3)]),
		hudson: recipe('Hudson', { brightness: 1.2, contrast: 0.9, saturate: 1.1 }, [radial(1, [stop(0.5, '#a6b1ff'), stop(1, '#342134')], 'multiply', 0.5)]),
		rise: recipe('Rise', { brightness: 1.05, sepia: 0.2, contrast: 0.9, saturate: 0.9 }, [radial(1, [stop(0.55, 'rgba(236,205,169,0.15)'), stop(1, 'rgba(50,30,7,0.4)')], 'multiply'), radial(1, [stop(0, 'rgba(232,197,152,0.8)'), stop(0.9, 'transparent')], 'overlay', 0.6)]),
		amaro: recipe('Amaro', { contrast: 0.9, brightness: 1.1, saturate: 1.5 }, [radial(1, [stop(0, 'rgba(125,105,24,0.2)'), stop(1, 'transparent')], 'overlay')]),
		sierra: recipe('Sierra', { contrast: 0.95, saturate: 0.9 }, [radial(0.9, [stop(0.4, 'rgba(128,78,15,0.5)'), stop(1, 'rgba(128,78,15,0.65)')], 'screen')]),
		willow: recipe('Willow', { grayscale: 0.5, contrast: 0.95, brightness: 0.9 }, [radial(0.85, [stop(0.55, '#d4a9af'), stop(1, '#562135')], 'overlay'), fill('#d8cdcb', 'color')]),
		inkwell: recipe('Inkwell', { sepia: 0.3, contrast: 1.1, brightness: 1.1, grayscale: 1 }, []),
		mayfair: recipe('Mayfair', { contrast: 1.1, saturate: 1.1 }, [radial(1, [stop(0, 'rgba(255,255,255,0.8)'), stop(0.3, 'rgba(255,200,200,0.6)'), stop(0.6, '#111111')], 'overlay', 0.4, [0.4, 0.4])]),
		hefe: recipe('Hefe', { contrast: 1.5, brightness: 1.05, saturate: 1.3 }, [radial(1.1, [stop(0.7, 'transparent'), stop(1.5, '#222222')], 'multiply'), fill('#302011', 'overlay', 0.4)])
	});

	root.FILTER_PRESETS = FILTER_PRESETS;
	if (typeof module !== 'undefined' && module.exports) module.exports = FILTER_PRESETS;
})(typeof self !== 'undefined' ? self : globalThis);
