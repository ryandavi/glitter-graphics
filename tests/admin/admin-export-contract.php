<?php

require_once(__DIR__ . '/../../admin/includes/config.php');
require_once(__DIR__ . '/../../admin/includes/database.php');
require_once(__DIR__ . '/../../admin/includes/glitterAPI.php');
require_once(__DIR__ . '/../../admin/includes/stickerAPI.php');

function failContract($message)
{
	fwrite(STDERR, "FAIL $message\n");
	exit(1);
}

$slice = ['top' => 0, 'right' => 45, 'bottom' => 0, 'left' => 45, 'mode' => 'stretch'];
if (StickerAPI::normalizeSlice($slice, 300, 69) !== $slice) failContract('horizontal slice failed');
if (StickerAPI::normalizeSlice(null, 300, 69) !== null) failContract('slice clearing failed');
foreach ([array_replace($slice, ['left' => -1]), array_replace($slice, ['top' => 0.5]), array_replace($slice, ['right' => 255]), array_replace($slice, ['mode' => 'repeat'])] as $badSlice) {
	try {
		StickerAPI::normalizeSlice($badSlice, 300, 69);
		failContract('invalid slice was accepted');
	} catch (InvalidArgumentException $error) {}
}
echo "PASS slice validation and clearing\n";

$db = new Database($CONFIG);
$apis = [
	'glitter' => new GlitterAPI($db, $CONFIG),
	'sticker' => new StickerAPI($db, $CONFIG),
];

$db->query('START TRANSACTION');
try {
	$apis['sticker']->updateAsset(['id' => 78, 'slice' => null]);
	if ($apis['sticker']->getAsset(78)['slice'] !== null) failContract('slice null was not persisted');
	try {
		$apis['sticker']->updateAsset(['id' => 78, 'slice' => array_replace($slice, ['left' => -1])]);
		failContract('invalid slice update succeeded');
	} catch (InvalidArgumentException $error) {}
} finally {
	$db->query('ROLLBACK');
}
echo "PASS slice database clearing and invalid update rejection\n";

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
		if ($type === 'sticker' && ($asset['sliced'] !== ($asset['slice'] !== null))) failContract('slice browse flag differs from detail');
		if ($type === 'glitter') {
			if (count($asset['colorCodes']) !== count($asset['colorWeights'])) failContract('glitter palette arrays differ');
			foreach ($asset['colorWeights'] as $weight) {
				if (!is_finite($weight) || $weight < 0) failContract('glitter palette weight is invalid');
			}
		}
	}
	$manifestName = $type === 'sticker' ? 'stickers' : 'glitter';
	$indexPath = __DIR__ . "/../../data/$manifestName.index.json";
	$detailDirectory = __DIR__ . "/../../data/$manifestName";
	$index = json_decode(file_get_contents($indexPath), true);
	if (!is_array($index) || count($index) !== count($assets)) failContract("$type browse index count differs");
	$indexById = [];
	foreach ($index as $record) {
		$indexById[$record['id']] = $record;
		if (array_key_exists('slice', $record) || array_key_exists('fileSize', $record) || array_key_exists('frameCount', $record)) {
			failContract("$type browse index contains deferred detail fields");
		}
		if ($type === 'glitter' && (!array_key_exists('colorCodes', $record) || !array_key_exists('colorWeights', $record))) {
			failContract('glitter browse index omits palette metadata needed for Auto Glitter');
		}
		if ($type === 'glitter' && (empty($record['width']) || empty($record['height']))) {
			failContract('glitter browse index omits the tile size the preview needs before decoding');
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
