<?php

require_once(__DIR__ . '/../../admin/includes/manifestLibraryService.php');

function assertManifest($condition, $label)
{
	if (!$condition) {
		fwrite(STDERR, "FAIL $label\n");
		exit(1);
	}
	echo "PASS $label\n";
}

$fonts = (new ManifestLibraryService('fonts'))->get();
assertManifest(array_is_list($fonts['manifest']['tagGroups']), 'font tag groups are present');
assertManifest(array_is_list($fonts['manifest']['fonts']), 'fonts manifest contains a font list');
assertManifest(count($fonts['manifest']['tagGroups']) > 0, 'font taxonomy has tag groups');
assertManifest($fonts['health']['tags'] === array_sum(array_map(function ($group) { return count($group['tags']); }, $fonts['manifest']['tagGroups'])), 'font taxonomy count matches its manifest');
assertManifest($fonts['health']['registered'] === count($fonts['manifest']['fonts']), 'font health count matches manifest');
assertManifest(count($fonts['health']['issues']) === 0, 'every font file is registered and available');
assertManifest(
	count(array_filter($fonts['manifest']['fonts'], function ($font) {
		return !empty($font['system']);
	})) >= 1,
	'system fonts remain supported'
);

$shapes = (new ManifestLibraryService('shapes'))->get();
assertManifest($shapes['health']['registered'] === count($shapes['manifest']['shapes']), 'shape health count matches manifest');
assertManifest(count($shapes['health']['issues']) === 0, 'shapes manifest validates');
$shapeIds = array_column($shapes['manifest']['shapes'], 'id');
assertManifest(in_array('circle', $shapeIds, true), 'default circle shape is present');
assertManifest(in_array('calligraphy', $shapeIds, true), 'brush-only calligraphy shape is present');
