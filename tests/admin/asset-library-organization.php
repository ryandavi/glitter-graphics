<?php
require_once(__DIR__ . '/../../admin/tools/import-glitter-sources.php');

function checkLibrary($condition, $message)
{
	if (!$condition) throw new RuntimeException($message);
}

$name = 'glitter_library_test_' . bin2hex(random_bytes(5));
$directory = '.tmp/' . $name;
$root = realpath(__DIR__ . '/../..');
$connection = new mysqli($CONFIG['db_host'], $CONFIG['db_user'], $CONFIG['db_pass']);
$connection->query("CREATE DATABASE `$name`");
$testConfig = $CONFIG;
$testConfig['db_name'] = $name;
$testConfig['managed_asset_roots']['glitter'] = "$directory/images";
$testConfig['incoming_root'] = "$directory/incoming";
$testConfig['asset_types']['glitter']['json_file'] = "$directory/data/glitter.json";
$testConfig['asset_types']['glitter']['categories_json_file'] = "$directory/data/glitter-categories.json";
$testConfig['asset_types']['glitter']['thumbnail_root'] = "$directory/thumbs";

try {
	foreach ($connection->query('SHOW TABLES FROM `' . $CONFIG['db_name'] . '`')->fetch_all(MYSQLI_NUM) as $table) {
		$connection->query("CREATE TABLE `$name`.`{$table[0]}` LIKE `{$CONFIG['db_name']}`.`{$table[0]}`");
	}
	$db = new Database($testConfig);
	$api = new GlitterSourceImportAPI($db, $testConfig);
	$stickerApi = new StickerAPI($db, $testConfig);
	// Stickers share the style/set code: a set row exports with its kind and
	// may change kind only while nothing uses it.
	$stickerApi->addCategory(['name' => 'Stickers', 'slug' => 'stickers']);
	$stickerSet = $stickerApi->addCategory(['name' => 'Set', 'slug' => 'set', 'is_set' => 1, 'attribution' => ['author' => 'Someone', 'authorId' => 'someone']])['id'];
	$stickerExport = array_column($stickerApi->exportCategories(), null, 'id');
	checkLibrary(!isset($stickerExport['stickers']['kind']) && $stickerExport['set']['kind'] === 'set' && !array_key_exists('parent', $stickerExport['set']), 'Sticker set kind export failed');
	$stickerApi->updateCategory(['id' => $stickerSet, 'is_set' => 0]);
	checkLibrary(!isset(array_column($stickerApi->exportCategories(), null, 'id')['set']['kind']), 'An unused set could not become a style');
	foreach (['sparkle', 'stardrops', 'sparkelies', 'bring-on-the-glitter/red', 'unsorted'] as $folder) mkdir("$root/$directory/images/$folder", 0775, true);
	mkdir("$root/$directory/data", 0775, true);
	$files = [
		'stardrops/Sparkbutton-gray.gif' => 'stardrops/Sparkbutton-gray.gif',
		'sparkelies/ruby.gif' => 'sparkelies/ruby.gif',
		'sparkelies/z-ruby-copy.gif' => 'sparkelies/ruby.gif',
		'bring-on-the-glitter/red/red-02.gif' => 'sparkelies/ruby.gif',
		'bring-on-the-glitter/red/gray-01.gif' => 'stardrops/Sparkbutton-gray.gif',
		'bring-on-the-glitter/red/crimson-001.gif' => 'bring-on-the-glitter/red/crimson-001.gif',
		'bring-on-the-glitter/red/satinhearts-010.gif' => 'bring-on-the-glitter/bring-on-the-hearts/satinhearts-010.gif',
		'sparkle/library-ruby.gif' => 'sparkelies/ruby.gif',
		'sparkle/duplicate-ruby.gif' => 'sparkelies/ruby.gif',
	];
	foreach ($files as $to => $from) {
		$source = "$root/images/glitter/$from";
		if (!is_file($source)) {
			$set = strpos($from, '/bring-on-the-hearts/') !== false ? 'bring-on-the-hearts' : dirname(dirname($from));
			$source = "$root/images/glitter/$set/" . basename($from);
		}
		checkLibrary(copy($source, "$root/$directory/images/$to"), "Missing fixture $from");
	}
	$image = imagecreatetruecolor(3, 3);
	imagefill($image, 0, 0, imagecolorallocate($image, 21, 42, 84));
	imagepng($image, "$root/$directory/images/unknown.png");
	imagedestroy($image);
	// The style keeps the name it was given here; the import only creates
	// what is missing.
	$style = $api->addCategory(['name' => 'Hand-named Sparkle', 'slug' => 'sparkle'])['id'];
	$other = $api->addCategory(['name' => 'Other', 'slug' => 'other'])['id'];
	$first = $api->addAsset(['name' => 'Library Ruby', 'url' => "$directory/images/sparkle/library-ruby.gif", 'category_id' => $style])['id'];
	$duplicate = $api->addAsset(['name' => 'Ruby Copy', 'url' => "$directory/images/sparkle/duplicate-ruby.gif", 'category_id' => $style])['id'];
	$db->query("UPDATE glitter SET original_name = 'Migration fixture', sort_order = 77 WHERE id = $first");
	$db->query('ALTER TABLE glitter DROP COLUMN original_order');
	new Database($testConfig);
	checkLibrary((int)$api->getAsset($first)['original_order'] === 77, 'Original order was not backfilled');
	checkLibrary($api->getAsset($duplicate)['original_order'] === null, 'Unsourced asset gained original order');
	$db->query("UPDATE glitter SET original_order = NULL, sort_order = 88 WHERE id = $first");
	new Database($testConfig);
	checkLibrary($api->getAsset($first)['original_order'] === null, 'Backfill repeated on a later connection');
	$db->query("UPDATE glitter SET original_name = NULL, sort_order = 0 WHERE id = $first");
	$api->updateCategory(['id' => $style, 'previews' => [$first, $duplicate]]);
	checkLibrary(array_column($api->exportCategories(), null, 'id')['sparkle']['previews'] === [(int)$first, (int)$duplicate], 'Ordered preview ids did not export');
	foreach ([[$first, $first], [999999], [$first, $duplicate, 1, 2, 3], 'bad'] as $invalid) {
		try { $api->updateCategory(['id' => $style, 'previews' => $invalid]); throw new RuntimeException('Invalid previews accepted'); }
		catch (InvalidArgumentException $expected) {}
	}
	$api->updateAsset(['id' => $duplicate, 'is_active' => 0]);
	checkLibrary(array_column($api->exportCategories(), null, 'id')['sparkle']['previews'] === [(int)$first], 'Unpublished preview leaked');
	$api->updateAsset(['id' => $duplicate, 'is_active' => 1]);
	$api->updateCategory(['id' => $style, 'previews' => [], 'icon' => 'custom/cover.png']);
	checkLibrary(array_column($api->exportCategories(), null, 'id')['sparkle']['icon'] === 'custom/cover.png', 'Custom cover lost');
	$api->updateCategory(['id' => $style, 'icon' => '']);
	$exportCwd = getcwd();
	chdir(__DIR__ . '/../../admin/includes');
	try { $api->saveExport(); } finally { chdir($exportCwd); }
	// A real tag on the removed record must survive the merge.
	$db->query("INSERT INTO glitter_tag_categories (name, slug) VALUES ('Test', 'test')");
	$tagCategory = $db->lastInsertId();
	$db->query("INSERT INTO glitter_tags (name, slug, glitter_tag_category_id) VALUES ('Jewel', 'jewel', $tagCategory)");
	$tagId = $db->lastInsertId();
	$db->query("INSERT INTO glitter_tags_map (glitter_id, glitter_tag_id) VALUES ($duplicate, $tagId)");
	$map = [
		'precedence' => ['stardrops', 'sparkelies', 'bring-on-the-glitter'],
		'styles' => [['slug' => 'sparkle', 'name' => 'Classic Sparkle', 'sort_order' => 0], ['slug' => 'unsorted', 'name' => 'Unsorted', 'sort_order' => 1]],
		'sources' => [
			['slug' => 'stardrops', 'name' => "Stardrops' Open Directory", 'sort_order' => 0, 'attribution' => ['author' => 'Mica', 'authorId' => 'mica', 'sourceId' => 'stardrops']],
			['slug' => 'sparkelies', 'name' => 'Sparkelies', 'sort_order' => 1, 'attribution' => ['author' => 'DAN-411', 'authorId' => 'dan', 'sourceId' => 'sparkelies']],
			['slug' => 'bring-on-the-glitter', 'name' => 'Bring On The Glitter', 'sort_order' => 2, 'attribution' => ['author' => 'Aylana', 'authorId' => 'aylana', 'sourceId' => 'bring-on-the-glitter']],
		],
		'sections' => [
			['from' => 'stardrops/', 'slug' => 'stardrops', 'source' => 'stardrops', 'style' => 'sparkle', 'names' => 'original'],
			['from' => 'sparkelies/', 'slug' => 'sparkelies', 'source' => 'sparkelies', 'style' => 'sparkle', 'names' => 'original'],
			['from' => 'bring-on-the-glitter/{red}/', 'slug' => 'bring-on-the-glitter', 'source' => 'bring-on-the-glitter', 'style' => 'sparkle', 'names' => 'generated'],
		],
	];
	$import = new GlitterSourceImport($db, $testConfig, $map);
	copy("$root/images/glitter/sparkelies/platinum.gif", "$root/$directory/images/deferred.gif");
	$map['deferredFiles'] = ['deferred.gif'];
	$import = new GlitterSourceImport($db, $testConfig, $map);
	$plan = $import->plan();
	checkLibrary(count($plan) === 5, 'Wrong distinct-image count');
	checkLibrary((int)$db->query('SELECT COUNT(*) FROM glitter')->fetch_row()[0] === 2, 'Dry run changed records');
	checkLibrary(is_file("$root/$directory/images/sparkle/duplicate-ruby.gif"), 'Dry run removed a file');
	$import->apply($plan);
	checkLibrary(!is_file("$root/$directory/data/glitter/$duplicate.json"), 'Removed duplicate retained a stale detail export');
	checkLibrary(md5_file("$root/$directory/images/deferred.gif") === md5_file("$root/images/glitter/sparkelies/platinum.gif"), 'Deferred file changed');
	$assets = $api->exportAssets();
	checkLibrary(count($assets) === 4, 'Import did not collapse duplicates');
	$heartsPath = "$root/$directory/images/bring-on-the-glitter/satinhearts-010.gif";
	$heartsSource = "$root/images/glitter/bring-on-the-hearts/satinhearts-010.gif";
	if (!is_file($heartsSource)) $heartsSource = "$root/images/glitter/bring-on-the-glitter/bring-on-the-hearts/satinhearts-010.gif";
	checkLibrary(md5_file($heartsPath) === md5_file($heartsSource), 'GIF decoder changed source bytes');
	$heartsAnalysis = $api->analyzeLocal($heartsPath)['normalized'];
	checkLibrary($heartsAnalysis['dimensions'] === ['width' => 50, 'height' => 50], 'Undersized GIF screen hid the real frame dimensions');
	$ruby = array_values(array_filter($assets, function ($asset) { return $asset['name'] === 'Ruby'; }))[0];
	checkLibrary($ruby['id'] === $first && $ruby['name'] === 'Ruby' && $ruby['originalName'] === 'ruby', 'Original naming or retained record failed');
	checkLibrary(in_array('Jewel', $ruby['tags'], true), 'Merged tag lost');
	checkLibrary(in_array('Library Ruby', $ruby['searchTerms'], true) && in_array('Ruby Copy', $ruby['searchTerms'], true), 'Old display names lost');
	checkLibrary($ruby['appearances'] === [['set' => 'bring-on-the-glitter', 'originalName' => 'red-02']], 'Later appearance lost');
	checkLibrary(in_array('z-ruby-copy', $ruby['searchTerms'], true), 'Same-set duplicate name lost');
	checkLibrary(is_file("$root/$directory/images/stardrops/Sparkbutton-gray.gif"), 'Original filename casing lost');
	checkLibrary($ruby['category'] === 'sparkle' && $ruby['set'] === 'sparkelies' && !isset($ruby['attribution']), 'Sourced tile is not filed by style with its set');
	$generated = array_values(array_filter($assets, function ($asset) { return ($asset['set'] ?? null) === 'bring-on-the-glitter'; }))[0];
	checkLibrary($generated['category'] === 'sparkle', 'New sourced tile did not start in its section style');
	checkLibrary($generated['name'] === $generated['generatedName'], 'New numbered tile lacks its generated display name');
	checkLibrary(count($api->ingestList('ready')) === 1, 'Unknown tile was not queued for review');
	checkLibrary(!is_file("$root/$directory/images/unknown.png"), 'Queued source was not moved');
	$categories = array_column($api->exportCategories(), null, 'id');
	checkLibrary($categories['sparkelies']['kind'] === 'set' && $categories['sparkelies']['attribution']['authorId'] === 'dan' && $categories['sparkelies']['count'] === 1, 'Set export failed');
	checkLibrary(!isset($categories['sparkle']['kind']) && $categories['sparkle']['count'] === 4 && $categories['sparkle']['name'] === 'Hand-named Sparkle', 'Style export failed or the import renamed an existing style');
	checkLibrary(!array_filter($categories, function ($entry) { return array_key_exists('parent', $entry); }), 'A category exported a parent');
	$setId = array_values(array_filter($api->getCategories(), function ($entry) { return $entry['slug'] === 'sparkelies'; }))[0]['id'];
	checkLibrary(!$api->deleteCategory($setId)['success'], 'A set in use was deleted');
	try { $api->updateCategory(['id' => $setId, 'is_set' => 0]); throw new RuntimeException('A set in use changed kind'); } catch (InvalidArgumentException $expected) {}
	checkLibrary(!array_filter($import->plan(), function ($entry) { return $entry['action'] !== 'keep'; }), 'A second dry run still plans changes');
	// Refiling a tile under another style keeps its set and credit, and the
	// import leaves it there.
	$api->updateAsset(['id' => $ruby['id'], 'glitter_category_id' => $other]);
	$sorts = array_column($api->exportAssets(), 'sortOrder', 'id');
	$import->apply($import->plan());
	$moved = array_values(array_filter($api->exportAssets(), function ($asset) use ($ruby) { return $asset['id'] === $ruby['id']; }))[0];
	checkLibrary($moved['category'] === 'other' && $moved['set'] === 'sparkelies', 'Import rerun refiled a tile or dropped its set');
	checkLibrary(array_column($api->exportAssets(), 'sortOrder', 'id') === $sorts, 'Rerun changed source section order');
	checkLibrary(count($api->exportAssets()) === 4 && count($api->ingestList('ready')) === 1, 'Rerun created duplicate records');
	$originalOrders = array_column($api->exportAssets(), 'originalOrder', 'id');
	checkLibrary(count($originalOrders) === 4, 'Sourced tiles lack original order');
	$db->query('UPDATE glitter SET sort_order = sort_order + 500');
	$import->apply($import->plan());
	checkLibrary(array_column($api->exportAssets(), 'originalOrder', 'id') === $originalOrders, 'Import rerun changed original order');
	// One style's order is rewritten without disturbing another's.
	$sparkleIds = array_column(array_filter($api->exportAssets(), function ($asset) { return $asset['category'] === 'sparkle'; }), 'id');
	$api->reorderAssets(['order' => array_reverse($sparkleIds)]);
	$reordered = $api->exportAssets();
	checkLibrary(array_column(array_filter($reordered, function ($asset) { return $asset['category'] === 'sparkle'; }), 'id') === array_reverse($sparkleIds), 'Style order was not saved');
	checkLibrary(array_column($reordered, 'originalOrder', 'id') == $originalOrders, 'Reordering changed original order');
	checkLibrary(array_column($reordered, 'category', 'id')[$ruby['id']] === 'other', 'Reordering one style moved a tile of another');
	$beforePublish = $api->exportAssets();
	$save = function () use ($api) {
		$cwd = getcwd();
		chdir(__DIR__ . '/../../admin/includes');
		try { $api->saveExport(); } finally { chdir($cwd); }
	};
	$save();
	$fullBefore = file_get_contents("$root/$directory/data/glitter.json");
	$indexBefore = file_get_contents("$root/$directory/data/glitter.index.json");
	$detailBefore = file_get_contents("$root/$directory/data/glitter/{$ruby['id']}.json");
	// Unpublishing a style hides its tiles, wherever their sets are used.
	$api->updateCategory(['id' => $other, 'is_active' => 0]);
	$save();
	checkLibrary(count($api->exportAssets()) === 3, 'Unpublished style still exports assets');
	$hidden = array_column($api->exportCategories(), null, 'id');
	checkLibrary(!isset($hidden['other']) && $hidden['sparkelies']['count'] === 0, 'Unpublished style exports, or its tiles still count toward their set');
	checkLibrary(!is_file("$root/$directory/data/glitter/{$ruby['id']}.json"), 'Unpublished detail remains');
	$index = json_decode(file_get_contents("$root/$directory/data/glitter.index.json"), true);
	checkLibrary(!in_array($ruby['id'], array_column($index, 'id')), 'Unpublished index entry remains');
	$health = (new AssetHealthService($db, $testConfig, 'glitter'))->report();
	checkLibrary(!array_filter($health['issues'], function ($issue) use ($ruby) { return $issue['id'] === $ruby['id'] && $issue['issue'] === 'missing'; }), 'Unpublished tile reported missing');
	checkLibrary(!array_filter($health['issues'], function ($issue) { return $issue['issue'] === 'category_path_mismatch'; }), 'A file outside its style folder was reported');
	$api->updateCategory(['id' => $other, 'is_active' => 1]);
	$save();
	checkLibrary(file_get_contents("$root/$directory/data/glitter.json") === $fullBefore, 'Republishing changed full export');
	checkLibrary(file_get_contents("$root/$directory/data/glitter.index.json") === $indexBefore, 'Republishing changed index');
	checkLibrary(file_get_contents("$root/$directory/data/glitter/{$ruby['id']}.json") === $detailBefore, 'Republishing changed detail');
	checkLibrary($api->exportAssets() === $beforePublish, 'Restoring a style changed assets');
	$db->query("UPDATE glitter SET is_active = 0 WHERE id = {$ruby['id']}");
	$import->apply($import->plan());
	checkLibrary((int)$db->query("SELECT is_active FROM glitter WHERE id = {$ruby['id']}")->fetch_row()[0] === 0, 'Import rerun republished an inactive sourced tile');
	$api->updateAsset(['id' => $first, 'is_active' => 1, 'attribution' => ['author' => 'Aylana', 'authorId' => 'aylana']]);
	$credited = array_values(array_filter($api->exportAssets(), function ($asset) use ($first) { return $asset['id'] === $first; }))[0];
	checkLibrary($credited['attribution']['authorId'] === 'aylana', 'Per-asset creator override lost in export');
	echo "PASS isolated import: precedence, names, tags, aliases, lineage, queue, styles and sets, order, exports and rerun\n";
} finally {
	$connection->query("DROP DATABASE `$name`");
	// The fixture path is generated under the workspace's ignored scratch directory.
	$absolute = realpath("$root/$directory");
	if ($absolute && strpos(str_replace('\\', '/', $absolute), str_replace('\\', '/', $root) . '/.tmp/glitter_library_test_') === 0) {
		$iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($absolute, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
		foreach ($iterator as $file) $file->isDir() ? rmdir($file->getPathname()) : unlink($file->getPathname());
		rmdir($absolute);
	}
}
