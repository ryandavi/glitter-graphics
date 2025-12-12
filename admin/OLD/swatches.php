<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Export Swatches</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            padding: 20px;
            max-width: 800px;
            margin: 0 auto;
        }
        .success {
            background: #d4edda;
            border: 1px solid #c3e6cb;
            color: #155724;
            padding: 12px;
            margin: 10px 0;
        }
        .error {
            background: #f8d7da;
            border: 1px solid #f5c6cb;
            color: #721c24;
            padding: 12px;
            margin: 10px 0;
        }
        .info {
            background: #fff3cd;
            border: 1px solid #ffc107;
            padding: 12px;
            margin: 10px 0;
        }
    </style>
</head>
<body>

<?php
// ============================================
// CONFIGURATION
// ============================================
define('DB_HOST', '127.0.0.1');
define('DB_USER', 'root');
define('DB_PASS', '');
define('DB_NAME', 'glitter');
define('OUTPUT_FILE', __DIR__ . '/../data/swatches.json');

echo '<div class="info">';
echo 'Database: ' . DB_NAME . ' @ ' . DB_HOST . '<br>';
echo 'Output: ' . OUTPUT_FILE;
echo '</div>';

try {
    // Connect to database
    $pdo = new PDO(
        "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4",
        DB_USER,
        DB_PASS,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
        ]
    );

    // Fetch all swatches with their category and tags
    $sql = "
        SELECT 
            s.id,
            s.name,
            s.url,
            s.is_pixelated,
            c.name AS category,
            GROUP_CONCAT(t.slug ORDER BY t.slug ASC SEPARATOR ',') AS tags
        FROM swatches s
        INNER JOIN categories c ON s.category_id = c.id
        LEFT JOIN swatch_tags st ON s.id = st.swatch_id
        LEFT JOIN tags t ON st.tag_id = t.id
        WHERE s.is_active = 1
        GROUP BY s.id, s.name, s.url, s.is_pixelated, c.name
        ORDER BY s.hue ASC, s.color_value DESC
    ";

    $stmt = $pdo->query($sql);
    $swatches = $stmt->fetchAll();

    // Count by category
    $categoryStats = [];
    foreach ($swatches as $swatch) {
        $cat = $swatch['category'];
        if (!isset($categoryStats[$cat])) {
            $categoryStats[$cat] = 0;
        }
        $categoryStats[$cat]++;
    }

    // Format data to match JavaScript structure
    $glitterGifs = [];
    foreach ($swatches as $swatch) {
        $glitterGifs[] = [
			'id' => $swatch['id'],
            'url' => $swatch['url'],
            'name' => $swatch['name'],
            'category' => $swatch['category'],
            'isPixelated' => (bool) $swatch['is_pixelated'],
            'tags' => $swatch['tags'] ? explode(',', $swatch['tags']) : []
        ];
    }

    // Create data directory if it doesn't exist
    $dataDir = dirname(OUTPUT_FILE);
    if (!is_dir($dataDir)) {
        if (!mkdir($dataDir, 0755, true)) {
            throw new Exception("Failed to create data directory: $dataDir");
        }
    }

    // Write JSON file
    $jsonOutput = json_encode($glitterGifs, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    
    if (file_put_contents(OUTPUT_FILE, $jsonOutput) === false) {
        throw new Exception("Failed to write JSON file: " . OUTPUT_FILE);
    }

    // Success output
    $count = count($glitterGifs);
    $fileSize = number_format(filesize(OUTPUT_FILE));
    
    echo '<div class="success">';
    echo 'Export successful!<br>';
    echo 'Total: ' . $count . ' swatches<br>';
    echo 'Size: ' . $fileSize . ' bytes';
    echo '</div>';

    // Category breakdown
    echo '<p><strong>Categories:</strong><br>';
    foreach ($categoryStats as $category => $catCount) {
        echo $category . ': ' . $catCount . '<br>';
    }
    echo '</p>';

    // Top tags
    $allTags = [];
    foreach ($glitterGifs as $gif) {
        foreach ($gif['tags'] as $tag) {
            if (!isset($allTags[$tag])) {
                $allTags[$tag] = 0;
            }
            $allTags[$tag]++;
        }
    }
    arsort($allTags);
    $topTags = array_slice($allTags, 0, 10, true);

    echo '<p><strong>Top 10 Tags:</strong><br>';
    foreach ($topTags as $tag => $tagCount) {
        echo $tag . ': ' . $tagCount . '<br>';
    }
    echo '</p>';

} catch (PDOException $e) {
    echo '<div class="error">';
    echo 'Database Error:<br>';
    echo htmlspecialchars($e->getMessage());
    echo '</div>';
} catch (Exception $e) {
    echo '<div class="error">';
    echo 'Error:<br>';
    echo htmlspecialchars($e->getMessage());
    echo '</div>';
}
?>

</body>
</html>