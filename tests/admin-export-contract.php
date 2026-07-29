<?php

require_once(__DIR__ . '/../admin/includes/config.php');
require_once(__DIR__ . '/../admin/includes/database.php');
require_once(__DIR__ . '/../admin/includes/glitterAPI.php');
require_once(__DIR__ . '/../admin/includes/stickerAPI.php');

function failContract($message)
{
	fwrite(STDERR, "FAIL $message\n");
	exit(1);
}

$db = new Database($CONFIG);
$apis = [
	'glitter' => new GlitterAPI($db, $CONFIG),
	'sticker' => new StickerAPI($db, $CONFIG),
];

foreach ($apis as $type => $api) {
	$assets = $api->exportAssets();
	if (!is_array($assets)) failContract("$type export is not an array");
	$ids = [];
	foreach ($assets as $asset) {
		if (!is_int($asset['id']) || isset($ids[$asset['id']])) failContract("$type IDs are not stable and unique");
		$ids[$asset['id']] = true;
		if (!is_string($asset['url']) || $asset['url'] === '') failContract("$type URL missing");
		if (!is_string($asset['category']) || $asset['category'] === '') failContract("$type category slug missing");
		if (!is_array($asset['tags'])) failContract("$type tags are not an array");
		foreach ($asset['tags'] as $tag) {
			if (!is_string($tag)) failContract("$type tag is not a string");
		}
		if ($type === 'glitter') {
			if (count($asset['colorCodes']) !== count($asset['colorWeights'])) failContract('glitter palette arrays differ');
			foreach ($asset['colorWeights'] as $weight) {
				if (!is_finite($weight) || $weight < 0) failContract('glitter palette weight is invalid');
			}
		}
	}
	$manifestName = $type === 'sticker' ? 'stickers' : 'glitter';
	$indexPath = __DIR__ . "/../data/$manifestName.index.json";
	$detailDirectory = __DIR__ . "/../data/$manifestName";
	$index = json_decode(file_get_contents($indexPath), true);
	if (!is_array($index) || count($index) !== count($assets)) failContract("$type browse index count differs");
	$indexById = [];
	foreach ($index as $record) {
		$indexById[$record['id']] = $record;
		if (array_key_exists('fileSize', $record) || array_key_exists('frameCount', $record)) {
			failContract("$type browse index contains deferred detail fields");
		}
	}
	foreach ($assets as $asset) {
		if (!isset($indexById[$asset['id']])) failContract("$type browse index is missing asset {$asset['id']}");
		$detailPath = $detailDirectory . '/' . rawurlencode((string)$asset['id']) . '.json';
		$detail = json_decode(file_get_contents($detailPath), true);
		if (json_encode($detail) !== json_encode($asset)) failContract("$type detail record differs for asset {$asset['id']}");
	}
	echo 'PASS ', $type, ' public export contract (', count($assets), " assets)\n";
}
