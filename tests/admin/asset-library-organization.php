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
	$stickerRoot = $stickerApi->addCategory(['name' => 'Stickers', 'slug' => 'stickers'])['id'];
	$stickerChild = $stickerApi->addCategory(['name' => 'Set', 'slug' => 'set', 'parent_id' => $stickerRoot])['id'];
	checkLibrary(!$stickerApi->deleteCategory($stickerRoot)['success'], 'Sticker root with children deleted');
	try { $stickerApi->updateCategory(['id' => $stickerRoot, 'parent_id' => $stickerChild]); throw new RuntimeException('Sticker cycle accepted'); } catch (InvalidArgumentException $expected) {}
	foreach (['sparkle', 'stardrops', 'sparkelies', 'bring-on-the-glitter/red', 'unsorted'] as $folder) mkdir("$root/$directory/images/$folder", 0775, true);
	mkdir("$root/$directory/data", 0775, true);
	$files = [
		'stardrops/Sparkbutton-gray.gif' => 'stardrops/Sparkbutton-gray.gif',
		'sparkelies/ruby.gif' => 'sparkelies/ruby.gif',
		'bring-on-the-glitter/red/red-02.gif' => 'sparkelies/ruby.gif',
		'bring-on-the-glitter/red/gray-01.gif' => 'stardrops/Sparkbutton-gray.gif',
		'bring-on-the-glitter/red/crimson-001.gif' => 'bring-on-the-glitter/red/crimson-001.gif',
		'sparkle/library-ruby.gif' => 'sparkelies/ruby.gif',
		'sparkle/duplicate-ruby.gif' => 'sparkelies/ruby.gif',
	];
	foreach ($files as $to => $from) checkLibrary(copy("$root/images/glitter/$from", "$root/$directory/images/$to"), "Missing fixture $from");
	$image = imagecreatetruecolor(3, 3);
	imagefill($image, 0, 0, imagecolorallocate($image, 21, 42, 84));
	imagepng($image, "$root/$directory/images/unknown.png");
	imagedestroy($image);
	$style = $api->addCategory(['name' => 'Classic Sparkle', 'slug' => 'sparkle'])['id'];
	$child = $api->addCategory(['name' => 'Sparkelies', 'slug' => 'dan-sparkelies', 'parent_id' => $style, 'attribution' => ['author' => 'DAN-411', 'authorId' => 'dan', 'sourceId' => 'sparkelies']])['id'];
	$other = $api->addCategory(['name' => 'Other', 'slug' => 'other'])['id'];
	foreach ([['id' => $style, 'parent_id' => $other], ['id' => $child, 'parent_id' => $child], ['id' => $other, 'parent_id' => $child]] as $bad) {
		try { $api->updateCategory($bad); throw new RuntimeException('Invalid parent accepted'); } catch (InvalidArgumentException $expected) {}
	}
	checkLibrary(!$api->deleteCategory($style)['success'], 'Root with children deleted');
	$first = $api->addAsset(['name' => 'Library Ruby', 'url' => "$directory/images/sparkle/library-ruby.gif", 'category_id' => $style])['id'];
	$duplicate = $api->addAsset(['name' => 'Ruby Copy', 'url' => "$directory/images/sparkle/duplicate-ruby.gif", 'category_id' => $style])['id'];
	// A real tag on the removed record must survive the merge.
	$db->query("INSERT INTO glitter_tag_categories (name, slug) VALUES ('Test', 'test')");
	$tagCategory = $db->lastInsertId();
	$db->query("INSERT INTO glitter_tags (name, slug, glitter_tag_category_id) VALUES ('Jewel', 'jewel', $tagCategory)");
	$tagId = $db->lastInsertId();
	$db->query("INSERT INTO glitter_tags_map (glitter_id, glitter_tag_id) VALUES ($duplicate, $tagId)");
	$map = [
		'precedence' => ['stardrops', 'sparkelies', 'bring-on-the-glitter'],
		'roots' => [['slug' => 'sparkle', 'name' => 'Classic Sparkle', 'sort_order' => 0], ['slug' => 'unsorted', 'name' => 'Unsorted', 'sort_order' => 1]],
		'sets' => [
			['from' => 'stardrops/', 'slug' => 'stardrops', 'name' => "Stardrops' Open Directory", 'parent' => 'sparkle', 'names' => 'original', 'sort_order' => 0, 'attribution' => ['author' => 'Mica', 'authorId' => 'mica', 'sourceId' => 'stardrops']],
			['from' => 'sparkelies/', 'slug' => 'sparkelies', 'renameFrom' => 'dan-sparkelies', 'name' => 'Sparkelies', 'parent' => 'sparkle', 'names' => 'original', 'sort_order' => 1, 'attribution' => ['author' => 'DAN-411', 'authorId' => 'dan', 'sourceId' => 'sparkelies']],
			['from' => 'bring-on-the-glitter/{red}/', 'slug' => 'bring-on-the-glitter', 'name' => 'Bring On The Glitter', 'parent' => 'sparkle', 'names' => 'generated', 'sort_order' => 2, 'attribution' => ['author' => 'Aylana', 'authorId' => 'aylana', 'sourceId' => 'bring-on-the-glitter']],
		],
	];
	$import = new GlitterSourceImport($db, $testConfig, $map);
	copy("$root/images/glitter/sparkelies/platinum.gif", "$root/$directory/images/deferred.gif");
	$map['deferredFiles'] = ['deferred.gif'];
	$import = new GlitterSourceImport($db, $testConfig, $map);
	$plan = $import->plan();
	checkLibrary(count($plan) === 4, 'Wrong distinct-image count');
	checkLibrary((int)$db->query('SELECT COUNT(*) FROM glitter')->fetch_row()[0] === 2, 'Dry run changed records');
	checkLibrary(is_file("$root/$directory/images/sparkle/duplicate-ruby.gif"), 'Dry run removed a file');
	$import->apply($plan);
	checkLibrary(md5_file("$root/$directory/images/deferred.gif") === md5_file("$root/images/glitter/sparkelies/platinum.gif"), 'Deferred file changed');
	$assets = $api->exportAssets();
	checkLibrary(count($assets) === 3, 'Import did not collapse duplicates');
	$ruby = array_values(array_filter($assets, function ($asset) { return $asset['name'] === 'Ruby'; }))[0];
	checkLibrary($ruby['id'] === $first && $ruby['name'] === 'Ruby' && $ruby['originalName'] === 'ruby', 'Original naming or retained record failed');
	checkLibrary(in_array('Jewel', $ruby['tags'], true), 'Merged tag lost');
	checkLibrary(in_array('Library Ruby', $ruby['searchTerms'], true) && in_array('Ruby Copy', $ruby['searchTerms'], true), 'Old display names lost');
	checkLibrary($ruby['appearances'] === [['set' => 'bring-on-the-glitter', 'originalName' => 'red-02']], 'Later appearance lost');
	checkLibrary(is_file("$root/$directory/images/stardrops/Sparkbutton-gray.gif"), 'Original filename casing lost');
	$generated = array_values(array_filter($assets, function ($asset) { return $asset['category'] === 'bring-on-the-glitter'; }))[0];
	checkLibrary($generated['name'] === $generated['generatedName'], 'New numbered tile lacks its generated display name');
	checkLibrary(count($api->ingestList('ready')) === 1, 'Unknown tile was not queued for review');
	checkLibrary(!is_file("$root/$directory/images/unknown.png"), 'Queued source was not moved');
	$categories = $api->exportCategories();
	$category = array_values(array_filter($categories, function ($entry) { return $entry['id'] === 'sparkelies'; }))[0];
	checkLibrary($category['parent'] === 'sparkle' && $category['attribution']['authorId'] === 'dan', 'Parent/creator export failed');
	$import->apply($import->plan());
	checkLibrary(count($api->exportAssets()) === 3 && count($api->ingestList('ready')) === 1, 'Rerun created duplicate records');
	echo "PASS isolated import: precedence, names, tags, aliases, lineage, queue, hierarchy, exports and rerun\n";
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
