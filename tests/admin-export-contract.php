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
	echo 'PASS ', $type, ' public export contract (', count($assets), " assets)\n";
}

