'use strict';

const PoseGeometry = {
	point(matrix, point) { return { x: matrix.a * point.x + matrix.c * point.y + matrix.e, y: matrix.b * point.x + matrix.d * point.y + matrix.f }; },
	vector(matrix, vector) { return { x: matrix.a * vector.x + matrix.c * vector.y, y: matrix.b * vector.x + matrix.d * vector.y }; },
	inverse(matrix) {
		const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
		if (!Number.isFinite(determinant) || Math.abs(determinant) <= CONFIG.ui.timeline.keySingularTolerance) return null;
		return { a: matrix.d / determinant, b: -matrix.b / determinant, c: -matrix.c / determinant, d: matrix.a / determinant,
			e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant, f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant };
	},
	basis(editor, layer, { canvasSpace = false } = {}) {
		const transform = getLayerTransform(layer);
		const raster = !canvasSpace && LAYER_UI_CONFIG[layer.type]?.rasterizesScale ? getCommittedRasterScale(editor, layer) : { x: 100, y: 100 };
		const sx = transform.scale.x / raster.x * (transform.flipX ? -1 : 1), sy = transform.scale.y / raster.y * (transform.flipY ? -1 : 1);
		const angle = transform.rotation * Math.PI / 180;
		return { a: Math.cos(angle) * sx, b: Math.sin(angle) * sx, c: -Math.sin(angle) * sy, d: Math.cos(angle) * sy, e: 0, f: 0 };
	},
	world(editor, layer, sample, { canvasSpace = false } = {}) {
		const transform = getLayerManagerForType(editor, layer.type).layerTransforms.get(layer.id);
		const dimensions = canvasSpace ? transform.getFrame() : transform.getDimensions();
		const rest = getLayerTransform(layer), metrics = computeLayerTransform(rest, dimensions);
		const angle = metrics.rotationRad;
		const x = (sample.originX - 0.5) * dimensions.width * metrics.signedScaleX, y = (sample.originY - 0.5) * dimensions.height * metrics.signedScaleY;
		const origin = { x: metrics.centerX + x * Math.cos(angle) - y * Math.sin(angle), y: metrics.centerY + x * Math.sin(angle) + y * Math.cos(angle) };
		const basis = this.basis(editor, layer, { canvasSpace }), inverseBasis = this.inverse(basis);
		if (!inverseBasis) return null;
		const local = GlitterAnimation.sampleMatrix({ ...sample, tx: 0, ty: 0, ...(sample.matrix ? { matrix: undefined } : {}) });
		const matrix = GlitterAnimation.multiplyMatrices(GlitterAnimation.multiplyMatrices(basis, sample.matrix ? { ...sample.matrix, e: 0, f: 0 } : local), inverseBasis);
		matrix.e = origin.x + sample.tx - matrix.a * origin.x - matrix.c * origin.y;
		matrix.f = origin.y + sample.ty - matrix.b * origin.x - matrix.d * origin.y;
		return { matrix, origin, basis, inverseBasis };
	},
	frame(editor, transform, sample) {
		const layer = transform.layer;
		const rest = transform.getFrameMetrics();
		const own = this.world(editor, layer, sample);
		if (!own) return null;
		const base = getClipBase(editor.layers, layer);
		const animatedBase = base && GlitterAnimation.isActive(base.animations);
		const baseSample = animatedBase && GlitterAnimation.sampleAt(base.animations, editor.animationTicker.getCurrentTime(), getLayerAnimationSamplingContext(editor, base));
		const parent = animatedBase ? this.world(editor, base, baseSample, { canvasSpace: true })?.matrix : { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
		if (!parent) return null;
		const matrix = GlitterAnimation.multiplyMatrices(parent, own.matrix);
		const corners = rest.corners.map(point => this.point(matrix, point));
		const center = this.point(matrix, { x: rest.centerX, y: rest.centerY });
		const u = { x: corners[1].x - corners[0].x, y: corners[1].y - corners[0].y };
		const v = { x: corners[3].x - corners[0].x, y: corners[3].y - corners[0].y };
		const width = Math.hypot(u.x, u.y), height = Math.hypot(v.x, v.y);
		const frame = { centerX: center.x, centerY: center.y, width, height, rotation: Math.atan2(u.y, u.x) * 180 / Math.PI,
			matrix: { a: width ? u.x / width : rest.cos, b: width ? u.y / width : rest.sin, c: height ? v.x / height : -rest.sin, d: height ? v.y / height : rest.cos } };
		return { ...own, parent, inverseParent: this.inverse(parent), rest, corners, frame, singular: !this.inverse(matrix) };
	}
};
