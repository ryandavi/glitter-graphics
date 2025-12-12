<?php
// ============================================
// CONFIGURATION
// ============================================
$CONFIG = [
    'db_host' => '127.0.0.1',
    'db_user' => 'root',
    'db_pass' => '',
    'db_name' => 'glitter',
    'image_base_path' => '../',
    'max_colors' => 10,
    'color_threshold' => 5, // Minimum % of pixels to include color
];

// ============================================
// DATABASE CLASS
// ============================================
class Database
{
    private $conn;

    public function __construct($config)
    {
        $this->conn = new mysqli(
            $config['db_host'],
            $config['db_user'],
            $config['db_pass'],
            $config['db_name']
        );

        if ($this->conn->connect_error) {
            throw new Exception('Database connection failed: ' . $this->conn->connect_error);
        }
    }

    public function query($sql)
    {
        return $this->conn->query($sql);
    }

    public function escape($str)
    {
        return $this->conn->real_escape_string($str);
    }

    public function lastInsertId()
    {
        return $this->conn->insert_id;
    }
}

// ============================================
// GIF ANALYZER CLASS
// ============================================
class GifAnalyzer
{
    private $imagePath;
    private $config;

    public function __construct($imagePath, $config)
    {
        $this->imagePath = $config['image_base_path'] . $imagePath;
        $this->config = $config;
    }

    public function analyze()
    {
        if (!file_exists($this->imagePath)) {
            throw new Exception('File not found: ' . $this->imagePath);
        }

        $frameData = $this->extractFrameData();
        $colorData = $this->extractColorData();

        return array_merge($frameData, $colorData);
    }

    private function extractFrameData()
    {
        $fileContent = file_get_contents($this->imagePath);
        $frameDelays = [];
        $pos = 0;

        while ($pos < strlen($fileContent)) {
            // Look for Graphics Control Extension
            $pos = strpos($fileContent, "\x21\xF9\x04", $pos);
            if ($pos === false) break;

            // Frame delay is at offset +4 and +5 (little endian, in centiseconds)
            if ($pos + 7 < strlen($fileContent)) {
                $delay = ord($fileContent[$pos + 4]) + (ord($fileContent[$pos + 5]) * 256);
                $frameDelays[] = $delay;
            }

            $pos += 3;  // Important: skip past current marker
        }

        if (empty($frameDelays)) {
            return [
                'frame_count' => 1,
                'frame_rate' => 10,
                'is_variable_framerate' => 0
            ];
        }

        // Find most common delay
        $delayCounts = array_count_values($frameDelays);
        arsort($delayCounts);
        $mostCommonDelay = key($delayCounts);

        // Check if variable (more than one unique delay value)
        $isVariable = count($delayCounts) > 1;

        return [
            'frame_count' => count($frameDelays),
            'frame_rate' => $mostCommonDelay,
            'is_variable_framerate' => $isVariable ? 1 : 0
        ];
    }

    private function extractColorData()
    {
        // Use first frame for color analysis
        $image = imagecreatefromgif($this->imagePath);
        if (!$image) {
            throw new Exception('Could not create image from GIF');
        }

        $width = imagesx($image);
        $height = imagesy($image);
        $totalPixels = $width * $height;

        // Color histogram
        $colors = [];
        $brightnessSum = 0;
        $nonTransparentPixels = 0;

        for ($y = 0; $y < $height; $y++) {
            for ($x = 0; $x < $width; $x++) {
                $rgb = imagecolorat($image, $x, $y);
                $rgba = imagecolorsforindex($image, $rgb);

                // Skip transparent pixels
                if ($rgba['alpha'] == 127) continue;

                $nonTransparentPixels++;
                $r = $rgba['red'];
                $g = $rgba['green'];
                $b = $rgba['blue'];

                // Skip sparkle pixels (bright whites)
                if ($r > 240 && $g > 240 && $b > 240) {
                    // continue;
                }

                // Calculate brightness
                $brightness = ($r + $g + $b) / 3;
                $brightnessSum += $brightness;

                // Store color
                $hex = sprintf('#%02X%02X%02X', $r, $g, $b);
                if (!isset($colors[$hex])) {
                    $colors[$hex] = ['count' => 0, 'r' => $r, 'g' => $g, 'b' => $b];
                }
                $colors[$hex]['count']++;
            }
        }

        imagedestroy($image);

        // Sort colors by frequency
        uasort($colors, function ($a, $b) {
            return $b['count'] - $a['count'];
        });

        // Get major colors (above threshold)
        $threshold = ($this->config['color_threshold'] / 100) * $nonTransparentPixels;
        $majorColors = [];

        foreach ($colors as $hex => $data) {
            if ($data['count'] >= $threshold && count($majorColors) < $this->config['max_colors']) {
                $majorColors[] = $hex;
            }
        }

        // Calculate average brightness
        $avgBrightness = $nonTransparentPixels > 0 ?
            round($brightnessSum / $nonTransparentPixels) : 0;

        // Color value for sorting (0-1 scale)
        $colorValue = round($avgBrightness / 255, 2);

        // Calculate hue
        $hue = $this->calculateHue($majorColors, $colors);

        // Get HSV from the most common color for name generation
// Get HSV from the most common color for name generation
        if (!empty($majorColors)) {
            $mainColorHex = $majorColors[0];
            $r = hexdec(substr($mainColorHex, 1, 2));
            $g = hexdec(substr($mainColorHex, 3, 2));
            $b = hexdec(substr($mainColorHex, 5, 2));
            list($hueValue, $saturation, $value) = $this->rgbToHSV($r, $g, $b);
        } else {
            // Fallback if no colors met the threshold
            $hueValue = 0;
            $saturation = 0;
            $value = 0;
        }

        // Generate name with proper parameters
        // Check if actually multicolor (need colors that are significantly different)
        $isMulticolor = false;
        if (count($majorColors) >= 2) {
            // Get hues of top colors
            $hues = [];
            foreach (array_slice($majorColors, 0, 3) as $colorHex) {
                $r = hexdec(substr($colorHex, 1, 2));
                $g = hexdec(substr($colorHex, 3, 2));
                $b = hexdec(substr($colorHex, 5, 2));
                list($h, $s, $v) = $this->rgbToHSV($r, $g, $b);

                // Only count colors with decent saturation
                if ($s > 20) {
                    $hues[] = $h;
                }
            }

            // Check if hues are different enough (>30 degrees apart)
            if (count($hues) >= 2) {
                $maxDiff = 0;
                for ($i = 0; $i < count($hues) - 1; $i++) {
                    for ($j = $i + 1; $j < count($hues); $j++) {
                        $diff = abs($hues[$i] - $hues[$j]);
                        if ($diff > 180) $diff = 360 - $diff; // Wrap around
                        $maxDiff = max($maxDiff, $diff);
                    }
                }
                $isMulticolor = $maxDiff > 30;
            }
        }



        $generatedName = $this->generateColorName(
            $colorValue,      // 0-1 scale
            $hueValue,        // 0-360
            $saturation,      // 0-100
            $value,           // 0-100
            [],               // colorTags (empty for now)
            $isMulticolor
        );

        return [
            'color_codes' => implode(',', $majorColors),
            'color_value' => $colorValue,
            'hue' => $hue,
            'generated_name' => $generatedName
        ];
    }


    private function rgbToHSV($r, $g, $b)
    {
        $r /= 255;
        $g /= 255;
        $b /= 255;

        $max = max($r, $g, $b);
        $min = min($r, $g, $b);
        $delta = $max - $min;

        // Value
        $v = $max * 100;

        // Saturation
        $s = ($max != 0) ? ($delta / $max) * 100 : 0;

        // Hue
        if ($delta == 0) {
            $h = 0;
        } else {
            if ($max == $r) {
                $h = 60 * fmod((($g - $b) / $delta), 6);
            } elseif ($max == $g) {
                $h = 60 * ((($b - $r) / $delta) + 2);
            } else {
                $h = 60 * ((($r - $g) / $delta) + 4);
            }
        }

        if ($h < 0) $h += 360;

        return [$h, $s, $v];
    }




    private function calculateHue($majorColors, $colorsData)
    {
        if (empty($majorColors)) {
            return 1.1; // Neutral
        }

        // Use the most frequent color for hue calculation
        $primaryHex = $majorColors[0];
        $rgb = $colorsData[$primaryHex];

        $r = $rgb['r'] / 255.0;
        $g = $rgb['g'] / 255.0;
        $b = $rgb['b'] / 255.0;

        $max = max($r, $g, $b);
        $min = min($r, $g, $b);
        $diff = $max - $min;

        // Check if it's a neutral color (gray)
        if ($diff < 0.1) {
            return 1.1; // Neutral marker
        }

        // Calculate hue
        $hue = 0;
        if ($diff > 0) {
            if ($max === $r) {
                $hue = 60 * fmod((($g - $b) / $diff), 6);
            } elseif ($max === $g) {
                $hue = 60 * ((($b - $r) / $diff) + 2);
            } else {
                $hue = 60 * ((($r - $g) / $diff) + 4);
            }
        }

        if ($hue < 0) $hue += 360;

        // Rotate by 15 degrees so red starts at 0
        $hue = fmod($hue + 15, 360);

        // Convert to 0-1 range
        return round($hue / 360, 3);
    }

    private function generateColorName($colorValue, $hue, $sat, $val, $colorTags, $isMulticolor)
    {
        // Multicolor handling (unchanged)
        if ($isMulticolor) {
            $colorOnlyTags = array_diff($colorTags, [
                'light',
                'dark',
                'pastel',
                'neon',
                'jewel',
                'vivid',
                'muted',
                'warm',
                'cool',
                'neutral',
                'multicolor',
                'pattern',
                'grayscale',
                'gold',
                'silver',
                'bronze'
            ]);
            $colorCount = count($colorOnlyTags);

            if ($colorCount >= 5) return "Rainbow";
            if ($colorCount == 4) {
                $colors = array_map('ucfirst', array_values($colorOnlyTags));
                return $colors[0] . ", " . $colors[1] . ", " . $colors[2] . ", and " . $colors[3];
            }
            if ($colorCount == 3) {
                $colors = array_map('ucfirst', array_values($colorOnlyTags));
                return $colors[0] . ", " . $colors[1] . ", and " . $colors[2];
            }
            if ($colorCount == 2) {
                $colors = array_map('ucfirst', array_values($colorOnlyTags));
                return $colors[0] . " and " . $colors[1];
            }
        }

        // Grayscale (pure neutrals)
        if ($sat < 10) {
            if ($val > 95) return "White";
            if ($val > 85) return "Off-White";
            if ($val > 70) return "Light Gray";
            if ($val > 50) return "Gray";
            if ($val > 30) return "Dark Gray";
            if ($val > 15) return "Charcoal";
            return "Black";
        }

        // Low saturation neutrals with slight color cast
        // Low saturation neutrals with slight color cast
        if ($sat < 30) {
            $isWarm = ($hue >= 20 && $hue <= 60); // yellow-orange-brown range
            $isCool = ($hue >= 180 && $hue <= 240); // blue-cyan range

            // Browns (warm + low value)
            if ($isWarm && $val < 50) {
                if ($val > 35) return "Brown";
                return "Dark Brown";
            }

            // Beiges/Tans (warm + high value)
            if ($isWarm && $val > 70) {
                if ($sat < 15) return "Beige";
                return "Tan";
            }

            // Temperature-modified grays
            if ($val > 70) {
                if ($isWarm) return "Warm Gray";
                if ($isCool) return "Cool Gray";
                return "Light Gray";
            }
            if ($val > 40) {
                if ($isWarm) return "Warm Gray";
                if ($isCool) return "Steel Gray";
                return "Gray";
            }
            return "Dark Gray";
        }

        // Brown detection (medium saturation browns)
        // Browns are essentially dark oranges/red-oranges
        if ($hue >= 15 && $hue <= 60 && $sat >= 30 && $sat <= 70 && $val < 60) {
            if ($val < 30) return "Dark Brown";
            if ($val < 45) return "Brown";
            return "Light Brown";
        }

        // Get precise hue name (with compound hues for intermediate colors)
        $hueName = $this->getHueName($hue, $sat);

        // Build modifiers
        $modifiers = [];

        // Value modifier (brightness)
        if ($val > 90) {
            $modifiers[] = "Very Light";
        } elseif ($val > 75) {
            $modifiers[] = "Light";
        } elseif ($val < 25) {
            $modifiers[] = "Very Dark";
        } elseif ($val < 40) {
            $modifiers[] = "Dark";
        } elseif ($val >= 40 && $val <= 75) {
            $modifiers[] = "Mid";
        }

        // Saturation modifier
        if ($sat > 90 && $val > 80) {
            // Neon: very high sat + very high value
            $modifiers[] = "Neon";
        } elseif ($sat > 85) {
            $modifiers[] = "Vivid";
        } elseif ($sat > 70) {
            $modifiers[] = "Bright";
        } elseif ($sat >= 50 && $sat <= 70 && $val > 70) {
            // Pastel: medium sat + high value
            $modifiers[] = "Pastel";
        } elseif ($sat >= 40 && $sat < 60) {
            $modifiers[] = "Muted";
        } elseif ($sat >= 30 && $sat < 40) {
            $modifiers[] = "Desaturated";
        }

        // Deep modifier (high sat + low value = jewel tones)
        if ($sat > 70 && $val >= 30 && $val <= 50) {
            // Replace dark with deep for jewel tones
            $modifiers = array_filter($modifiers, function ($m) {
                return $m !== "Dark";
            });
            $modifiers[] = "Deep";
        }

        // Remove redundant combinations
        $modifiers = $this->cleanupModifiers($modifiers);

        return trim(implode(" ", $modifiers) . " " . $hueName);
    }

    private function getHueName($hue, $sat)
    {
        // Precise hue mapping with compound names for intermediate colors
        // Ranges tuned for better color recognition

        if ($hue >= 350 || $hue < 10) return "Red";
        if ($hue >= 10 && $hue < 20) return "Red-Orange";
        if ($hue >= 20 && $hue < 35) return "Orange";
        if ($hue >= 35 && $hue < 50) return "Yellow-Orange";
        if ($hue >= 50 && $hue < 70) return "Yellow";
        if ($hue >= 70 && $hue < 85) return "Yellow-Green";
        if ($hue >= 85 && $hue < 100) return "Lime";
        if ($hue >= 100 && $hue < 155) return "Green";
        if ($hue >= 155 && $hue < 170) return "Green-Cyan";
        if ($hue >= 170 && $hue < 185) return "Cyan";
        if ($hue >= 185 && $hue < 200) return "Cyan-Blue";
        if ($hue >= 200 && $hue < 215) return "Teal";
        if ($hue >= 215 && $hue < 245) return "Blue";
        if ($hue >= 245 && $hue < 265) return "Indigo";
        if ($hue >= 265 && $hue < 280) return "Blue-Purple";
        if ($hue >= 280 && $hue < 295) return "Purple";
        if ($hue >= 295 && $hue < 310) return "Purple-Magenta";
        if ($hue >= 310 && $hue < 325) return "Magenta";
        if ($hue >= 325 && $hue < 335) return "Magenta-Pink";
        if ($hue >= 335 && $hue < 350) return "Pink";

        return "Unknown";
    }

    private function cleanupModifiers($modifiers)
    {
        $hasVeryLight = in_array("Very Light", $modifiers);
        $hasVeryDark = in_array("Very Dark", $modifiers);
        $hasNeon = in_array("Neon", $modifiers);
        $hasPastel = in_array("Pastel", $modifiers);
        $hasDeep = in_array("Deep", $modifiers);
        $hasBright = in_array("Bright", $modifiers);

        // Pastel/Neon already imply lightness - remove light modifiers
        if ($hasPastel || $hasNeon) {
            $modifiers = array_filter($modifiers, function ($m) {
                return !in_array($m, ["Very Light", "Light", "Dark", "Very Dark", "Mid"]);
            });
        }

        // Deep already implies darkness
        if ($hasDeep) {
            $modifiers = array_filter($modifiers, function ($m) {
                return !in_array($m, ["Light", "Very Light", "Dark", "Very Dark", "Mid"]);
            });
        }

        // Very Light/Dark should remove regular Light/Dark
        if ($hasVeryLight || $hasVeryDark) {
            $modifiers = array_filter($modifiers, function ($m) {
                return !in_array($m, ["Light", "Dark"]);
            });
        }

        // Bright conflicts with Very Light (redundant)
        if ($hasVeryLight && $hasBright) {
            $modifiers = array_filter($modifiers, function ($m) {
                return $m !== "Bright";
            });
        }

        return array_values($modifiers);
    }
    private function getColorNames($hexArray)
    {
        return array_map([$this, 'getColorName'], $hexArray);
    }

    private function getColorName($hex)
    {
        $rgb = sscanf($hex, '#%02x%02x%02x');
        list($r, $g, $b) = $rgb;

        // Determine base color
        if ($r > $g && $r > $b) return 'Red';
        if ($g > $r && $g > $b) return 'Green';
        if ($b > $r && $b > $g) return 'Blue';
        if ($r > $b && $g > $b) {
            return $r > $g ? 'Orange' : 'Yellow';
        }
        if ($r === $g && $r > $b) return 'Yellow';
        if ($g === $b && $g > $r) return 'Cyan';
        if ($r === $b && $r > $g) return 'Magenta';

        return 'Gray';
    }
}

// ============================================
// API HANDLER CLASS
// ============================================
class SwatchAPI
{
    private $db;
    private $config;

    public function __construct($db, $config)
    {
        $this->db = $db;
        $this->config = $config;
    }

    public function handleRequest()
    {
        $action = $_GET['action'] ?? '';

        header('Content-Type: application/json');

        try {
            switch ($action) {
                case 'list':
                    echo json_encode($this->listSwatches());
                    break;

                case 'get':
                    $id = (int)$_GET['id'];
                    echo json_encode($this->getSwatch($id));
                    break;

                case 'update':
                    $data = json_decode(file_get_contents('php://input'), true);
                    echo json_encode($this->updateSwatch($data));
                    break;

                case 'delete':
                    $id = (int)$_POST['id'];
                    echo json_encode($this->deleteSwatch($id));
                    break;

                case 'analyze':
                    $id = (int)$_GET['id'];
                    echo json_encode($this->analyzeSwatch($id));
                    break;

                case 'reorder':
                    $data = json_decode(file_get_contents('php://input'), true);
                    echo json_encode($this->reorderSwatches($data));
                    break;

                case 'add':
                    $data = json_decode(file_get_contents('php://input'), true);
                    echo json_encode($this->addSwatch($data));
                    break;

                case 'export':
                    echo json_encode($this->exportSwatches());
                    break;

                case 'save_export':
                    echo json_encode($this->saveExport());
                    break;

                case 'tags':
                    echo json_encode($this->getTags());
                    break;

                case 'tag_categories':
                    echo json_encode($this->getTagCategories());
                    break;

                case 'categories':
                    echo json_encode($this->getCategories());
                    break;

                case 'add_category':
                    $data = json_decode(file_get_contents('php://input'), true);
                    echo json_encode($this->addCategory($data));
                    break;

                case 'delete_category':
                    $id = (int)$_POST['id'];
                    echo json_encode($this->deleteCategory($id));
                    break;

                case 'add_tag':
                    $data = json_decode(file_get_contents('php://input'), true);
                    echo json_encode($this->addTag($data));
                    break;

                case 'delete_tag':
                    $id = (int)$_POST['id'];
                    echo json_encode($this->deleteTag($id));
                    break;

                default:
                    throw new Exception('Invalid action');
            }
        } catch (Exception $e) {
            http_response_code(400);
            echo json_encode(['error' => $e->getMessage()]);
        }
    }

    private function listSwatches()
    {
        $result = $this->db->query("
            SELECT s.*, c.name as category_name 
            FROM swatches s 
            JOIN categories c ON s.category_id = c.id 
            ORDER BY c.sort_order, s.sort_order, s.name
        ");

        $swatches = [];
        while ($row = $result->fetch_assoc()) {
            $swatches[] = $row;
        }

        return $swatches;
    }

    private function getSwatch($id)
    {
        // Get swatch data
        $result = $this->db->query("SELECT * FROM swatches WHERE id = $id");
        $swatch = $result->fetch_assoc();

        if (!$swatch) {
            throw new Exception('Swatch not found');
        }

        // Get tags
        $tagsResult = $this->db->query("
            SELECT t.id, t.name, t.hex_color, tc.name as category_name
            FROM swatch_tags st
            JOIN tags t ON st.tag_id = t.id
            JOIN tag_categories tc ON t.tag_category_id = tc.id
            WHERE st.swatch_id = $id
            ORDER BY tc.sort_order, t.name
        ");

        $tags = [];
        while ($tag = $tagsResult->fetch_assoc()) {
            $tags[] = $tag;
        }

        $swatch['tags'] = $tags;

        return $swatch;
    }

    private function updateSwatch($data)
    {
        $id = (int)$data['id'];
        $fields = [];

        $stringFields = ['name', 'url', 'generated_name', 'color_codes'];
        $intFields = [
            'category_id',
            'is_pixelated',
            'is_active',
            'frame_count',
            'frame_rate',
            'is_variable_framerate',
            'color_value',
            'sort_order'
        ];
        $floatFields = ['hue'];

        foreach ($stringFields as $field) {
            if (isset($data[$field])) {
                $value = $this->db->escape($data[$field]);
                $fields[] = "$field = '$value'";
            }
        }

        foreach ($intFields as $field) {
            if (isset($data[$field])) {
                $value = $data[$field] !== '' ? (int)$data[$field] : 'NULL';
                $fields[] = "$field = $value";
            }
        }

        foreach ($floatFields as $field) {
            if (isset($data[$field])) {
                $value = $data[$field] !== '' ? (float)$data[$field] : 'NULL';
                $fields[] = "$field = $value";
            }
        }

        if (empty($fields)) {
            throw new Exception('No fields to update');
        }

        $sql = "UPDATE swatches SET " . implode(', ', $fields) . " WHERE id = $id";
        $this->db->query($sql);

        // Update tags if provided
        if (isset($data['tags'])) {
            $this->db->query("DELETE FROM swatch_tags WHERE swatch_id = $id");
            foreach ($data['tags'] as $tagId) {
                $tagId = (int)$tagId;
                $this->db->query("INSERT INTO swatch_tags (swatch_id, tag_id) VALUES ($id, $tagId)");
            }
        }

        return ['success' => true];
    }

    private function deleteSwatch($id)
    {
        $this->db->query("DELETE FROM swatch_tags WHERE swatch_id = $id");
        $this->db->query("DELETE FROM swatches WHERE id = $id");
        return ['success' => true];
    }

    private function analyzeSwatch($id)
    {
        $result = $this->db->query("SELECT url FROM swatches WHERE id = $id");
        $swatch = $result->fetch_assoc();

        if (!$swatch) {
            throw new Exception('Swatch not found');
        }

        $analyzer = new GifAnalyzer($swatch['url'], $this->config);
        $analysis = $analyzer->analyze();

        return $analysis;
    }

    private function reorderSwatches($data)
    {
        foreach ($data['order'] as $index => $id) {
            $id = (int)$id;
            $order = (int)$index;
            $this->db->query("UPDATE swatches SET sort_order = $order WHERE id = $id");
        }
        return ['success' => true];
    }

    private function addSwatch($data)
    {
        $name = $this->db->escape($data['name']);
        $url = $this->db->escape($data['url']);
        $categoryId = (int)($data['category_id'] ?? 1);

        $sql = "INSERT INTO swatches (name, url, category_id, is_pixelated, is_active) 
                VALUES ('$name', '$url', $categoryId, 1, 1)";

        $this->db->query($sql);
        $id = $this->db->lastInsertId();

        return ['success' => true, 'id' => $id];
    }

    private function exportSwatches()
    {
        $swatches = $this->listSwatches();

        $formatted = [];
        foreach ($swatches as $swatch) {
            // Get tags for this swatch
            $id = $swatch['id'];
            $tagsResult = $this->db->query("
                SELECT t.name 
                FROM swatch_tags st
                JOIN tags t ON st.tag_id = t.id
                WHERE st.swatch_id = $id
            ");

            $tags = [];
            while ($tag = $tagsResult->fetch_assoc()) {
                $tags[] = $tag['name'];
            }

            // Convert color_codes string to array
            $colorCodes = [];
            if (!empty($swatch['color_codes'])) {
                $colorCodes = array_map('trim', explode(',', $swatch['color_codes']));
            }

            // Format for app consumption
            $formatted[] = [
                'id' => (int)$swatch['id'],
                'url' => $swatch['url'],
                'name' => $swatch['name'],
                'generatedName' => $swatch['generated_name'],
                'brightness' => $swatch['color_value'],
                'sortOrder' => (int)($swatch['sort_order'] ?? 0),
                'hue' => $swatch['hue'] ? (float)$swatch['hue'] : null,
                'colorCodes' => $colorCodes,
                'frameCount' => (int)($swatch['frame_count'] ?? 0),
                'frameRate' => (int)($swatch['frame_rate'] ?? 10),
                'isVariableFramerate' => (bool)$swatch['is_variable_framerate'],
                'category' => $swatch['category_name'],
                'isPixelated' => (bool)$swatch['is_pixelated'],
                'tags' => $tags
            ];
        }

        return $formatted;
    }

    private function saveExport()
    {
        $swatches = $this->exportSwatches();
        $jsonPath = $this->config['image_base_path'] . 'data/swatches.json';

        // Format JSON nicely
        $json = json_encode($swatches, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);

        // Try to write to file
        $result = file_put_contents($jsonPath, $json);

        if ($result === false) {
            throw new Exception('Failed to write to ' . $jsonPath);
        }

        return ['success' => true, 'path' => $jsonPath, 'bytes' => $result];
    }

    private function getTags()
    {
        $result = $this->db->query("
            SELECT t.*, tc.name as category_name 
            FROM tags t 
            JOIN tag_categories tc ON t.tag_category_id = tc.id 
            ORDER BY tc.sort_order, t.name
        ");

        $tags = [];
        while ($row = $result->fetch_assoc()) {
            $tags[] = $row;
        }

        return $tags;
    }

    private function getTagCategories()
    {
        $result = $this->db->query("SELECT * FROM tag_categories ORDER BY sort_order");

        $categories = [];
        while ($row = $result->fetch_assoc()) {
            $categories[] = $row;
        }

        return $categories;
    }

    private function getCategories()
    {
        $result = $this->db->query("SELECT * FROM categories ORDER BY sort_order");

        $categories = [];
        while ($row = $result->fetch_assoc()) {
            $categories[] = $row;
        }

        return $categories;
    }

    private function addCategory($data)
    {
        $name = $this->db->escape($data['name']);
        $slug = $this->db->escape($data['slug']);
        $description = isset($data['description']) ? $this->db->escape($data['description']) : '';
        $sortOrder = (int)($data['sort_order'] ?? 999);

        $sql = "INSERT INTO categories (name, slug, description, sort_order) 
                VALUES ('$name', '$slug', '$description', $sortOrder)";

        $this->db->query($sql);
        return ['success' => true, 'id' => $this->db->lastInsertId()];
    }

    private function deleteCategory($id)
    {
        // Check if any swatches use this category
        $result = $this->db->query("SELECT COUNT(*) as count FROM swatches WHERE category_id = $id");
        $row = $result->fetch_assoc();

        if ($row['count'] > 0) {
            return ['success' => false, 'error' => 'Cannot delete category - ' . $row['count'] . ' swatch(es) use it'];
        }

        $this->db->query("DELETE FROM categories WHERE id = $id");
        return ['success' => true];
    }

    private function addTag($data)
    {
        $name = $this->db->escape($data['name']);
        $slug = strtolower(str_replace(' ', '-', $data['name']));
        $slug = $this->db->escape($slug);
        $tagCategoryId = (int)$data['tag_category_id'];
        $hexColor = isset($data['hex_color']) && $data['hex_color'] ?
            $this->db->escape($data['hex_color']) : 'NULL';

        $sql = "INSERT INTO tags (tag_category_id, name, slug, hex_color) 
                VALUES ($tagCategoryId, '$name', '$slug', " .
            ($hexColor === 'NULL' ? 'NULL' : "'$hexColor'") . ")";

        $this->db->query($sql);
        return ['success' => true, 'id' => $this->db->lastInsertId()];
    }

    private function deleteTag($id)
    {
        // Check if any swatches use this tag
        $result = $this->db->query("SELECT COUNT(*) as count FROM swatch_tags WHERE tag_id = $id");
        $row = $result->fetch_assoc();

        if ($row['count'] > 0) {
            // Remove tag from all swatches
            $this->db->query("DELETE FROM swatch_tags WHERE tag_id = $id");
        }

        $this->db->query("DELETE FROM tags WHERE id = $id");
        return ['success' => true, 'removed_from' => $row['count']];
    }
}

// ============================================
// HANDLE API REQUESTS
// ============================================
if (isset($_GET['api'])) {
    $db = new Database($CONFIG);
    $api = new SwatchAPI($db, $CONFIG);
    $api->handleRequest();
    exit;
}

// ============================================
// HTML INTERFACE
// ============================================
?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Swatch Editor</title>
    <style>
        :root {
            --color-bg-primary: #1a1a1a;
            --color-bg-secondary: #2a2a2a;
            --color-bg-tertiary: #3a3a3a;
            --color-border: #444;
            --color-text-primary: #fff;
            --color-text-secondary: #ccc;
            --color-accent: #007bff;
            --color-accent-hover: #0056b3;
            --color-success: #28a745;
            --color-danger: #dc3545;
        }

        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--color-bg-primary);
            color: var(--color-text-primary);
            font-size: 14px;
        }

        .container {
            display: grid;
            grid-template-columns: 300px 1fr;
            height: 100vh;
        }

        .sidebar {
            background: var(--color-bg-secondary);
            border-right: 1px solid var(--color-border);
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .sidebar-header {
            padding: 20px;
            border-bottom: 1px solid var(--color-border);
        }

        .sidebar-header h2 {
            margin: 0 0 12px 0;
            font-size: 18px;
        }

        .add-swatch-btn {
            width: 100%;
            padding: 8px;
            background: var(--color-accent);
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }

        .add-swatch-btn:hover {
            background: var(--color-accent-hover);
        }

        .swatch-list {
            flex: 1;
            overflow-y: auto;
            padding: 10px;
        }

        .category-group {
            margin-bottom: 12px;
        }

        .category-label {
            font-size: 11px;
            color: var(--color-text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 8px;
            padding: 0 8px;
        }

        .swatch-item {
            padding: 8px;
            margin-bottom: 4px;
            border-radius: 4px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: background 0.2s;
        }

        .swatch-item:hover {
            background: var(--color-bg-tertiary);
        }

        .swatch-item.active {
            background: var(--color-accent);
        }

        .swatch-item.dragging {
            opacity: 0.5;
        }

        .swatch-thumb {
            width: 30px;
            height: 30px;
            background-size: cover;
            border-radius: 4px;
            border: 1px solid var(--color-border);
            image-rendering: pixelated;
            flex-shrink: 0;
        }

        .swatch-name {
            flex: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            font-weight: 500;
        }

        .drag-handle {
            color: var(--color-text-secondary);
            cursor: grab;
            font-size: 16px;
        }

        .drag-handle:active {
            cursor: grabbing;
        }

        .main-content {
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .content-scroll {
            flex: 1;
            overflow-y: auto;
            padding: 20px 20px 100px 20px;
        }

        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: var(--color-text-secondary);
        }

        .form-section {
            margin-bottom: 24px;
        }

        .form-section-title {
            font-size: 14px;
            color: var(--color-text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin: 0 0 12px 0;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--color-border);
        }

        .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
            margin-bottom: 16px;
        }

        .form-group {
            margin-bottom: 16px;
        }

        .form-group label {
            display: block;
            margin-bottom: 4px;
            color: var(--color-text-secondary);
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        input[type="text"],
        input[type="number"],
        select {
            width: 100%;
            padding: 8px;
            background: var(--color-bg-primary);
            border: 1px solid var(--color-border);
            border-radius: 4px;
            color: var(--color-text-primary);
            font-size: 14px;
        }

        input[type="checkbox"] {
            width: 18px;
            height: 18px;
            cursor: pointer;
            accent-color: var(--color-accent);
        }

        .checkbox-group {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .checkbox-group label {
            margin: 0;
            text-transform: none;
        }

        .preview-image {
            max-width: 200px;
            margin-top: 8px;
            border: 1px solid var(--color-border);
            border-radius: 4px;
            image-rendering: pixelated;
        }

        .color-inputs {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-bottom: 8px;
        }

        .color-input-wrapper {
            display: flex;
            gap: 4px;
            align-items: center;
        }

        .color-input-wrapper input[type="color"] {
            width: 40px;
            height: 40px;
            padding: 2px;
            border: 1px solid var(--color-border);
            border-radius: 4px;
            background: var(--color-bg-primary);
            cursor: pointer;
        }

        .color-input-wrapper input[type="text"] {
            width: 90px;
        }

        .color-remove-btn {
            background: var(--color-danger);
            color: white;
            border: none;
            width: 28px;
            height: 28px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 18px;
            line-height: 1;
        }

        .add-color-btn {
            padding: 8px 16px;
            background: var(--color-bg-tertiary);
            border: 1px solid var(--color-border);
            border-radius: 4px;
            color: var(--color-text-primary);
            cursor: pointer;
            font-size: 13px;
        }

        .add-color-btn:hover {
            background: var(--color-border);
        }

        .analyze-btn {
            padding: 10px 20px;
            background: var(--color-success);
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            margin-bottom: 20px;
        }

        .analyze-btn:hover {
            opacity: 0.9;
        }

        .tag-list {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-bottom: 12px;
        }

        .tag {
            padding: 4px 12px;
            background: var(--color-bg-tertiary);
            border: 1px solid var(--color-border);
            border-radius: 12px;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .tag-color {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            border: 1px solid var(--color-border);
        }

        .tag-remove {
            background: none;
            border: none;
            color: var(--color-danger);
            cursor: pointer;
            padding: 0;
            font-size: 16px;
            line-height: 1;
        }

        .tag-select-container {
            display: flex;
            gap: 8px;
        }

        .tag-select-container select {
            flex: 1;
        }

        .tag-add-btn {
            padding: 8px 16px;
            background: var(--color-accent);
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }

        .fixed-footer {
            position: fixed;
            bottom: 0;
            left: 300px;
            right: 0;
            background: var(--color-bg-secondary);
            border-top: 1px solid var(--color-border);
            padding: 16px 20px;
            display: flex;
            gap: 12px;
            align-items: center;
        }

        .btn {
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
        }

        .btn-primary {
            background: var(--color-accent);
            color: white;
        }

        .btn-primary:hover {
            background: var(--color-accent-hover);
        }

        .btn-danger {
            background: var(--color-danger);
            color: white;
        }

        .btn-danger:hover {
            opacity: 0.9;
        }

        .btn-secondary {
            background: var(--color-bg-tertiary);
            color: var(--color-text-primary);
        }

        .btn-secondary:hover {
            background: var(--color-border);
        }

        .status-message {
            flex: 1;
            color: var(--color-text-secondary);
            font-size: 13px;
        }

        .loading {
            opacity: 0.6;
            pointer-events: none;
        }

        /* Category/Tag Management Lists */
        .management-item {
            padding: 12px;
            background: var(--color-bg-tertiary);
            border: 1px solid var(--color-border);
            border-radius: 4px;
            margin-bottom: 8px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .management-item-info {
            flex: 1;
        }

        .management-item-name {
            font-weight: 500;
            margin-bottom: 4px;
        }

        .management-item-meta {
            font-size: 12px;
            color: var(--color-text-secondary);
        }

        .management-item-delete {
            padding: 6px 12px;
            background: var(--color-danger);
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        }

        .management-item-delete:hover {
            opacity: 0.8;
        }

        .analyze-result-item {
            padding: 12px;
            background: var(--color-bg-tertiary);
            border: 1px solid var(--color-border);
            border-radius: 4px;
            margin-bottom: 8px;
            display: flex;
            align-items: flex-start;
            gap: 12px;
        }

        .analyze-result-item input[type="checkbox"] {
            margin-top: 3px;
        }

        .analyze-result-content {
            flex: 1;
        }

        .analyze-result-label {
            font-weight: 500;
            margin-bottom: 4px;
        }

        .analyze-result-value {
            color: var(--color-text-secondary);
            font-size: 13px;
        }

        .analyze-colors-preview {
            display: flex;
            flex-direction: row;
            gap: 4px;
            margin-top: 4px;
            align-items: flex-start;
            flex-wrap: wrap;
        }

        .analyze-colors-preview-swatch {
            display: inline-flex;
            gap: 4px;
            margin-top: 4px;
            border: 1px solid #5b5b5b;
            padding: 5px;
            align-items: center;
            border-radius: 5px;
        }

        .analyze-color-box {
            width: 24px;
            height: 24px;
            border-radius: 4px;
            border: 1px solid var(--color-border);
        }

        /* Modal */
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.8);
            z-index: 1000;
            align-items: center;
            justify-content: center;
        }

        .modal.active {
            display: flex;
        }

        .modal-content {
            background: var(--color-bg-secondary);
            border-radius: 8px;
            padding: 24px;
            max-width: 400px;
            width: 90%;

            max-width: 500px;
            max-height: 80dvh;
            overflow-y: scroll;


        }

        .modal-title {
            font-size: 18px;
            margin: 0 0 16px 0;
        }
    </style>
</head>

<body>
    <div class="container">
        <!-- Sidebar -->
        <div class="sidebar">
            <div class="sidebar-header">
                <h2>Swatches</h2>
                <button class="add-swatch-btn" onclick="app.showAddModal()">+ Add New Swatch</button>
                <div style="display: flex; gap: 8px; margin-top: 8px;">
                    <button class="btn btn-secondary" style="flex: 1; padding: 6px; font-size: 12px;" onclick="app.showManageCategoriesModal()">Manage Categories</button>
                    <button class="btn btn-secondary" style="flex: 1; padding: 6px; font-size: 12px;" onclick="app.showManageTagsModal()">Manage Tags</button>
                </div>
            </div>
            <div class="swatch-list" id="swatchList">
                <!-- Populated by JavaScript -->
            </div>
        </div>

        <!-- Main Content -->
        <div class="main-content">
            <div class="content-scroll" id="contentScroll">
                <div class="empty-state" id="emptyState">
                    <h2>Select a swatch to edit</h2>
                    <p>Choose a swatch from the list or add a new one.</p>
                </div>

                <div id="editorContent" style="display: none;">
                    <!-- Editor populated by JavaScript -->
                </div>
            </div>

            <!-- Fixed Footer -->
            <div class="fixed-footer">
                <span class="status-message" id="statusMessage">Ready</span>
                <button class="btn btn-secondary" onclick="app.exportJSON()">Save to swatches.json</button>
                <button class="btn btn-primary" onclick="app.saveSwatch()">Save Changes</button>
                <button class="btn btn-danger" onclick="app.deleteSwatch()">Delete</button>
            </div>
        </div>
    </div>

    <!-- Add Swatch Modal -->
    <div class="modal" id="addModal">
        <div class="modal-content">
            <h3 class="modal-title">Add New Swatch</h3>
            <div class="form-group">
                <label>Name</label>
                <input type="text" id="newSwatchName" placeholder="My Glitter">
            </div>
            <div class="form-group">
                <label>URL Path</label>
                <input type="text" id="newSwatchUrl" placeholder="images/glitter/sparkle/my-glitter.gif">
            </div>
            <div class="form-group">
                <label>Category</label>
                <select id="newSwatchCategory"></select>
            </div>
            <div style="display: flex; gap: 8px; margin-top: 20px;">
                <button class="btn btn-primary" onclick="app.addSwatch()">Add</button>
                <button class="btn btn-secondary" onclick="app.hideAddModal()">Cancel</button>
            </div>
        </div>
    </div>

    <!-- Analyze Results Modal -->
    <div class="modal" id="analyzeModal">
        <div class="modal-content" style="max-width: 500px;">
            <h3 class="modal-title">Auto-Analysis Results</h3>
            <p style="color: var(--color-text-secondary); font-size: 13px; margin-bottom: 16px;">
                Select which fields to apply:
            </p>
            <div id="analyzeResults"></div>
            <div style="display: flex; gap: 8px; margin-top: 20px;">
                <button class="btn btn-primary" onclick="app.applyAnalysis()">Apply Selected</button>
                <button class="btn btn-secondary" onclick="app.hideAnalyzeModal()">Cancel</button>
            </div>
        </div>
    </div>

    <!-- Manage Categories Modal -->
    <div class="modal" id="manageCategoriesModal">
        <div class="modal-content" style="max-width: 600px;">
            <h3 class="modal-title">Manage Categories</h3>

            <div style="margin-bottom: 20px;">
                <h4 style="font-size: 14px; margin-bottom: 12px;">Add New Category</h4>
                <div class="form-group">
                    <label>Name</label>
                    <input type="text" id="newCategoryName" placeholder="Category Name">
                </div>
                <div class="form-group">
                    <label>Slug</label>
                    <input type="text" id="newCategorySlug" placeholder="category-slug">
                </div>
                <div class="form-group">
                    <label>Description</label>
                    <input type="text" id="newCategoryDescription" placeholder="Optional description">
                </div>
                <button class="btn btn-primary" onclick="app.addCategory()">Add Category</button>
            </div>

            <div>
                <h4 style="font-size: 14px; margin-bottom: 12px;">Existing Categories</h4>
                <div id="categoryList" style="max-height: 300px; overflow-y: auto;"></div>
            </div>

            <div style="margin-top: 20px;">
                <button class="btn btn-secondary" onclick="app.hideManageCategoriesModal()">Close</button>
            </div>
        </div>
    </div>

    <!-- Manage Tags Modal -->
    <div class="modal" id="manageTagsModal">
        <div class="modal-content" style="max-width: 700px; max-height: 90vh; overflow-y: auto;">
            <h3 class="modal-title">Manage Tags</h3>

            <div style="margin-bottom: 20px;">
                <h4 style="font-size: 14px; margin-bottom: 12px;">Add New Tag</h4>
                <div class="form-row">
                    <div class="form-group">
                        <label>Name</label>
                        <input type="text" id="newTagName" placeholder="Tag Name">
                    </div>
                    <div class="form-group">
                        <label>Category</label>
                        <select id="newTagCategory"></select>
                    </div>
                </div>
                <div class="form-group">
                    <label>Hex Color (optional, for color tags)</label>
                    <input type="text" id="newTagHexColor" placeholder="#FF0000">
                </div>
                <button class="btn btn-primary" onclick="app.addNewTag()">Add Tag</button>
            </div>

            <div>
                <h4 style="font-size: 14px; margin-bottom: 12px;">Existing Tags</h4>
                <div id="tagList"></div>
            </div>

            <div style="margin-top: 20px;">
                <button class="btn btn-secondary" onclick="app.hideManageTagsModal()">Close</button>
            </div>
        </div>
    </div>

    <script>
        const CONFIG = <?php echo json_encode($CONFIG); ?>;

        class SwatchEditor {
            constructor() {
                this.swatches = [];
                this.categories = [];
                this.tags = [];
                this.currentSwatch = null;
                this.init();
            }

            async init() {
                await this.loadCategories();
                await this.loadTags();
                await this.loadSwatches();
                this.setupDragAndDrop();
            }

            async loadSwatches() {
                const response = await fetch('?api=1&action=list');
                this.swatches = await response.json();
                this.renderSwatchList();
            }

            async loadCategories() {
                const response = await fetch('?api=1&action=categories');
                this.categories = await response.json();
            }

            async loadTags() {
                const response = await fetch('?api=1&action=tags');
                this.tags = await response.json();
            }

            renderSwatchList() {
                const container = document.getElementById('swatchList');
                let html = '';
                let currentCategory = '';

                this.swatches.forEach((swatch, index) => {
                    if (swatch.category_name !== currentCategory) {
                        if (currentCategory) html += '</div>';
                        currentCategory = swatch.category_name;
                        html += `<div class="category-group">
                            <div class="category-label">${currentCategory}</div>`;
                    }

                    const active = this.currentSwatch && this.currentSwatch.id === swatch.id ? 'active' : '';
                    html += `
                        <div class="swatch-item ${active}" 
                             data-id="${swatch.id}" 
                             draggable="true"
                             onclick="app.selectSwatch(${swatch.id})">
                            <span class="drag-handle">⋮⋮</span>
                            <div class="swatch-thumb" style="background-image: url('${CONFIG.image_base_path}${swatch.url}');"></div>
                            <span class="swatch-name">${swatch.name}</span>
                        </div>
                    `;
                });

                if (currentCategory) html += '</div>';
                container.innerHTML = html;

                // Restore scroll position
                if (this.scrollPosition !== undefined) {
                    container.scrollTop = this.scrollPosition;
                }
            }

            async selectSwatch(id) {
                // Save scroll position
                this.scrollPosition = document.getElementById('swatchList').scrollTop;

                const response = await fetch(`?api=1&action=get&id=${id}`);
                this.currentSwatch = await response.json();
                this.renderEditor();
                this.renderSwatchList(); // Update active state

                // Restore scroll position in content
                document.getElementById('contentScroll').scrollTop = 0;
            }

            renderEditor() {
                document.getElementById('emptyState').style.display = 'none';
                const editor = document.getElementById('editorContent');
                editor.style.display = 'block';

                const s = this.currentSwatch;
                const colors = s.color_codes ? s.color_codes.split(',') : [];

                editor.innerHTML = `
                    <h1>${s.name}</h1>
                    
                    <button class="analyze-btn" onclick="app.analyzeCurrentSwatch()">
                        🔍 Auto-Analyze Glitter
                    </button>
                    
                    <div class="form-section">
                        <h3 class="form-section-title">Basic Info</h3>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label>Name</label>
                                <input type="text" id="name" value="${s.name || ''}">
                            </div>
                            <div class="form-group">
                                <label>Generated Name</label>
                                <input type="text" id="generated_name" value="${s.generated_name || ''}">
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label>URL</label>
                            <input type="text" id="url" value="${s.url || ''}">
                            <img src="${CONFIG.image_base_path}${s.url}" class="preview-image" alt="Preview">
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label>Category</label>
                                <select id="category_id">
                                    ${this.categories.map(cat => 
                                        `<option value="${cat.id}" ${cat.id == s.category_id ? 'selected' : ''}>${cat.name}</option>`
                                    ).join('')}
                                </select>
                            </div>
                            <div class="form-group">
                                <label>&nbsp;</label>
                                <div class="checkbox-group">
                                    <input type="checkbox" id="is_pixelated" ${s.is_pixelated ? 'checked' : ''}>
                                    <label for="is_pixelated">Pixelated</label>
                                    
                                    <input type="checkbox" id="is_active" ${s.is_active ? 'checked' : ''}>
                                    <label for="is_active">Active</label>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="form-section">
                        <h3 class="form-section-title">Frame Data</h3>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Frame Count</label>
                                <input type="number" id="frame_count" value="${s.frame_count || ''}">
                            </div>
                            <div class="form-group">
                                <label>Frame Rate (centiseconds)</label>
                                <input type="number" id="frame_rate" value="${s.frame_rate || ''}">
                            </div>
                        </div>
                        <div class="form-group">
                            <div class="checkbox-group">
                                <input type="checkbox" id="is_variable_framerate" ${s.is_variable_framerate ? 'checked' : ''}>
                                <label for="is_variable_framerate">Variable Frame Rate</label>
                            </div>
                        </div>
                    </div>
                    
                    <div class="form-section">
                        <h3 class="form-section-title">Color Data</h3>
                        
                        <div class="form-group">
                            <label>Color Codes</label>
                            <div class="color-inputs" id="colorInputs">
                                ${colors.map((color, i) => this.renderColorInput(color.trim(), i)).join('')}
                            </div>
                            <button class="add-color-btn" onclick="app.addColorInput()">+ Add Color</button>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label>Color Value (brightness)</label>
                                <input type="number" id="color_value" value="${s.color_value !== null ? s.color_value : ''}" min="0" max="1">
                            </div>
                            <div class="form-group">
                                <label>Hue (0-1, neutrals=1.1)</label>
                                <input type="text" id="hue" value="${s.hue || ''}">
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label>Sort Order</label>
                            <input type="number" id="sort_order" value="${s.sort_order || ''}">
                        </div>
                    </div>
                    
                    <div class="form-section">
                        <h3 class="form-section-title">Tags</h3>
                        <div class="tag-list">
                            ${s.tags.map(tag => `
                                <div class="tag">
                                    ${tag.hex_color ? `<span class="tag-color" style="background: ${tag.hex_color};"></span>` : ''}
                                    ${tag.name}
                                    <button class="tag-remove" onclick="app.removeTag(${tag.id})">×</button>
                                </div>
                            `).join('')}
                        </div>
                        <div class="tag-select-container">
                            <select id="tagSelect">
                                <option value="">Select tag...</option>
                                ${this.groupTagsByCategory().map(group => `
                                    <optgroup label="${group.category}">
                                        ${group.tags.map(tag => `
                                            <option value="${tag.id}" ${s.tags.some(t => t.id == tag.id) ? 'disabled' : ''}>
                                                ${tag.name}
                                            </option>
                                        `).join('')}
                                    </optgroup>
                                `).join('')}
                            </select>
                            <button class="tag-add-btn" onclick="app.addTag()">Add</button>
                        </div>
                    </div>
                `;
            }

            renderColorInput(color, index) {
                return `
                    <div class="color-input-wrapper">
                        <input type="color" value="${color}" onchange="app.updateColorText(${index}, this.value)">
                        <input type="text" value="${color}" onchange="app.updateColorPicker(${index}, this.value)" placeholder="#FF0000">
                        <button class="color-remove-btn" onclick="app.removeColor(${index})">×</button>
                    </div>
                `;
            }

            groupTagsByCategory() {
                const grouped = {};
                this.tags.forEach(tag => {
                    if (!grouped[tag.category_name]) {
                        grouped[tag.category_name] = [];
                    }
                    grouped[tag.category_name].push(tag);
                });

                return Object.entries(grouped).map(([category, tags]) => ({
                    category,
                    tags
                }));
            }

            addColorInput() {
                const container = document.getElementById('colorInputs');
                const index = container.children.length;
                const div = document.createElement('div');
                div.innerHTML = this.renderColorInput('#FF0000', index);
                container.appendChild(div.firstElementChild);
            }

            removeColor(index) {
                const container = document.getElementById('colorInputs');

                const colorGroups = container.querySelectorAll('.color-input-wrapper');

                const colors = Array.from(colorGroups).map(group =>
                    group.querySelector('input[type="text"]').value
                );

                colors.splice(index, 1);

                container.innerHTML = colors
                    .map((color, i) => this.renderColorInput(color, i))
                    .join('');
            }


            updateColorPicker(index, value) {
                if (/^#[0-9A-F]{6}$/i.test(value)) {
                    const container = document.getElementById('colorInputs');
                    const colorInput = container.children[index].querySelector('input[type="color"]');
                    colorInput.value = value.toUpperCase();
                }
            }

            async addTag() {
                const tagId = document.getElementById('tagSelect').value;
                if (!tagId) return;

                this.currentSwatch.tags.push(this.tags.find(t => t.id == tagId));
                this.renderEditor();
            }

            removeTag(tagId) {
                this.currentSwatch.tags = this.currentSwatch.tags.filter(t => t.id != tagId); // Change !== to !=
                this.renderEditor();
            }

            async saveSwatch() {
                if (!this.currentSwatch) return;

                const data = {
                    id: this.currentSwatch.id,
                    name: document.getElementById('name').value,
                    url: document.getElementById('url').value,
                    generated_name: document.getElementById('generated_name').value,
                    category_id: document.getElementById('category_id').value,
                    is_pixelated: document.getElementById('is_pixelated').checked ? 1 : 0,
                    is_active: document.getElementById('is_active').checked ? 1 : 0,
                    frame_count: document.getElementById('frame_count').value,
                    frame_rate: document.getElementById('frame_rate').value,
                    is_variable_framerate: document.getElementById('is_variable_framerate').checked ? 1 : 0,
                    color_value: document.getElementById('color_value').value,
                    hue: document.getElementById('hue').value,
                    sort_order: document.getElementById('sort_order').value,
                    color_codes: this.getColorCodes(),
                    tags: this.currentSwatch.tags.map(t => t.id)
                };

                this.showStatus('Saving...');

                const response = await fetch('?api=1&action=update', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data)
                });

                const result = await response.json();

                if (result.success) {
                    this.showStatus('Saved!', 'success');
                    await this.loadSwatches();
                    await this.selectSwatch(this.currentSwatch.id);
                } else {
                    this.showStatus('Error: ' + result.error, 'error');
                }
            }

            getColorCodes() {
                const container = document.getElementById('colorInputs');
                const colors = [];
                for (let child of container.children) {
                    const input = child.querySelector('input[type="text"]');
                    if (input && input.value) {
                        colors.push(input.value.trim());
                    }
                }
                return colors.join(',');
            }

            async deleteSwatch() {
                if (!this.currentSwatch) return;

                if (!confirm('Delete this swatch? This cannot be undone.')) return;

                const formData = new FormData();
                formData.append('id', this.currentSwatch.id);

                await fetch('?api=1&action=delete', {
                    method: 'POST',
                    body: formData
                });

                this.currentSwatch = null;
                document.getElementById('editorContent').style.display = 'none';
                document.getElementById('emptyState').style.display = 'block';

                await this.loadSwatches();
                this.showStatus('Deleted', 'success');
            }

            async analyzeCurrentSwatch() {
                if (!this.currentSwatch) return;

                this.showStatus('Analyzing...');

                const response = await fetch(`?api=1&action=analyze&id=${this.currentSwatch.id}`);
                const analysis = await response.json();

                if (analysis.error) {
                    this.showStatus('Error: ' + analysis.error, 'error');
                    return;
                }

                this.analysisResults = analysis;
                this.showAnalyzeModal();
                this.showStatus('Analysis complete!', 'success');
            }

            showAnalyzeModal() {
                const analysis = this.analysisResults;
                const colors = analysis.color_codes ? analysis.color_codes.split(',') : [];

                // Generate suggested tags from color name
                const suggestedTags = this.generateTagsFromColorName(analysis.generated_name || '');

                // Filter out tags already applied to current swatch
                const currentTagIds = this.currentSwatch.tags.map(t => t.id);
                const availableTags = this.tags.filter(tag => {
                    return suggestedTags.includes(tag.name.toLowerCase()) &&
                        !currentTagIds.includes(tag.id);
                });

                const resultsHtml = `
        <div class="analyze-result-item">
            <input type="checkbox" id="apply_frame_count" checked>
            <div class="analyze-result-content">
                <div class="analyze-result-label">Frame Count</div>
                <div class="analyze-result-value">${analysis.frame_count || 'N/A'}</div>
            </div>
        </div>
        
        <div class="analyze-result-item">
            <input type="checkbox" id="apply_frame_rate" checked>
            <div class="analyze-result-content">
                <div class="analyze-result-label">Frame Rate</div>
                <div class="analyze-result-value">${analysis.frame_rate !== null && analysis.frame_rate !== undefined ? analysis.frame_rate : 'N/A'} centiseconds</div>
            </div>
        </div>
        
        <div class="analyze-result-item">
            <input type="checkbox" id="apply_is_variable_framerate" checked>
            <div class="analyze-result-content">
                <div class="analyze-result-label">Variable Frame Rate</div>
                <div class="analyze-result-value">${analysis.is_variable_framerate ? 'Yes' : 'No'}</div>
            </div>
        </div>
        
        <div class="analyze-result-item">
            <input type="checkbox" id="apply_color_codes" checked>
            <div class="analyze-result-content">
                <div class="analyze-result-label">Color Codes</div>
                <div class="analyze-result-value">
                    ${colors.length} color(s) detected
                    <div class="analyze-colors-preview" id="analyzeColorsPreview">
                        ${colors.map((c, i) => `
                            <div class="analyze-colors-preview-swatch">
                                <div class="analyze-color-box" style="background: ${c};"></div>
                                <span style="font-size: 11px; color: var(--color-text-secondary);">${c}</span>
                                <button onclick="app.removeAnalysisColor(${i})" style="padding: 2px 6px; font-size: 11px; background: var(--color-danger); color: white; border: none; border-radius: 3px; cursor: pointer;">×</button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        </div>
        
        <div class="analyze-result-item">
            <input type="checkbox" id="apply_color_value" checked>
            <div class="analyze-result-content">
                <div class="analyze-result-label">Color Value (Brightness)</div>
                <div class="analyze-result-value">${analysis.color_value !== null ? analysis.color_value : 'N/A'}</div>
            </div>
        </div>
        
        <div class="analyze-result-item">
            <input type="checkbox" id="apply_hue" checked>
            <div class="analyze-result-content">
                <div class="analyze-result-label">Hue</div>
                <div class="analyze-result-value">${analysis.hue || 'N/A'}</div>
            </div>
        </div>
        
        <div class="analyze-result-item">
            <input type="checkbox" id="apply_generated_name" checked>
            <div class="analyze-result-content">
                <div class="analyze-result-label">Generated Name</div>
                <div class="analyze-result-value">${analysis.generated_name || 'N/A'}</div>
            </div>
        </div>
        
        ${availableTags.length > 0 ? `
            <div class="analyze-result-item">
                <input type="checkbox" id="apply_suggested_tags" checked>
                <div class="analyze-result-content">
                    <div class="analyze-result-label">Suggested Tags</div>
                    <div class="analyze-result-value" id="suggestedTagsList">
                        ${availableTags.map(tag => `
                            <div style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; background: var(--color-bg-tertiary); border-radius: 4px; margin: 2px; font-size: 12px;">
                                <input type="checkbox" id="tag_suggest_${tag.id}" checked style="margin: 0;">
                                <label for="tag_suggest_${tag.id}" style="cursor: pointer;">${tag.name}</label>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        ` : ''}
    `;

                document.getElementById('analyzeResults').innerHTML = resultsHtml;
                document.getElementById('analyzeModal').classList.add('active');
            }

            generateTagsFromColorName(colorName) {
                const words = colorName.toLowerCase().split(/[\s-]+/);
                const tagWords = [
                    // Base colors
                    'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'brown',
                    'cyan', 'magenta', 'teal', 'lime', 'indigo', 'violet',
                    // Neutrals
                    'white', 'gray', 'grey', 'black', 'beige', 'tan', 'charcoal',
                    // Brightness/value
                    'light', 'dark', 'mid', 'very',
                    // Saturation/tone
                    'bright', 'neon', 'pastel', 'vivid', 'muted', 'desaturated', 'deep',
                    // Temperature
                    'warm', 'cool',
                    // Special
                    'multicolor', 'rainbow'
                ];

                return words.filter(word => tagWords.includes(word));
            }

            removeAnalysisColor(index) {
                const colors = this.analysisResults.color_codes.split(',');
                colors.splice(index, 1);
                this.analysisResults.color_codes = colors.join(',');

                // Re-render the modal
                this.showAnalyzeModal();
            }

            hideAnalyzeModal() {
                document.getElementById('analyzeModal').classList.remove('active');
            }

applyAnalysis() {
    const analysis = this.analysisResults;

    if (document.getElementById('apply_frame_count').checked) {
        document.getElementById('frame_count').value = analysis.frame_count || '';
    }

    if (document.getElementById('apply_frame_rate').checked) {
        document.getElementById('frame_rate').value = analysis.frame_rate || '';
    }

    if (document.getElementById('apply_is_variable_framerate').checked) {
        document.getElementById('is_variable_framerate').checked = analysis.is_variable_framerate;
    }

    if (document.getElementById('apply_color_codes').checked) {
        const colors = analysis.color_codes ? analysis.color_codes.split(',') : [];
        const container = document.getElementById('colorInputs');
        container.innerHTML = colors.map((color, i) => this.renderColorInput(color.trim(), i)).join('');
    }

    if (document.getElementById('apply_color_value').checked) {
        document.getElementById('color_value').value = analysis.color_value !== null ? analysis.color_value : '';
    }

    if (document.getElementById('apply_hue').checked) {
        document.getElementById('hue').value = analysis.hue || '';
    }

    // --- FIX APPLIED HERE ---
    if (document.getElementById('apply_generated_name').checked) {
        document.getElementById('generated_name').value = analysis.generated_name || '';
        // We removed the line causing the error ("s.generated_name = ...")
        // We don't need to update the memory object for the name, 
        // because saveSwatch() reads the name directly from the DOM input.
    }

    // Apply suggested tags
    const applyTagsCheckbox = document.getElementById('apply_suggested_tags');
    if (applyTagsCheckbox && applyTagsCheckbox.checked) {
        // Find all checked suggested tags
        const tagCheckboxes = document.querySelectorAll('[id^="tag_suggest_"]:checked');
        tagCheckboxes.forEach(checkbox => {
            const tagId = parseInt(checkbox.id.replace('tag_suggest_', ''));
            // Use loose equality (==) in case types differ (string vs int)
            const tag = this.tags.find(t => t.id == tagId);

            // Add if not already in swatch tags
            if (tag && !this.currentSwatch.tags.find(t => t.id == tagId)) {
                this.currentSwatch.tags.push(tag);
            }
        });
    }

    this.hideAnalyzeModal();

    // Re-render editor to show all updates including new tags
    this.renderEditor();

    this.showStatus('Analysis applied!', 'success');
}

            async exportJSON() {
                this.showStatus('Exporting...');

                const response = await fetch('?api=1&action=save_export', {
                    method: 'POST'
                });

                const result = await response.json();

                if (result.success) {
                    this.showStatus(`Saved to ${result.path} (${result.bytes} bytes)`, 'success');
                } else {
                    alert('Error: ' + result.error);
                    this.showStatus('Export failed', 'error');
                }
            }

            showAddModal() {
                const modal = document.getElementById('addModal');
                const select = document.getElementById('newSwatchCategory');
                select.innerHTML = this.categories.map(cat =>
                    `<option value="${cat.id}">${cat.name}</option>`
                ).join('');
                modal.classList.add('active');
            }

            hideAddModal() {
                document.getElementById('addModal').classList.remove('active');
                document.getElementById('newSwatchName').value = '';
                document.getElementById('newSwatchUrl').value = '';
            }

            async addSwatch() {
                const data = {
                    name: document.getElementById('newSwatchName').value,
                    url: document.getElementById('newSwatchUrl').value,
                    category_id: document.getElementById('newSwatchCategory').value
                };

                if (!data.name || !data.url) {
                    alert('Please fill in all fields');
                    return;
                }

                const response = await fetch('?api=1&action=add', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data)
                });

                const result = await response.json();

                if (result.success) {
                    this.hideAddModal();
                    await this.loadSwatches();
                    await this.selectSwatch(result.id);
                    this.showStatus('Swatch added!', 'success');
                }
            }

            setupDragAndDrop() {
                let draggedItem = null;
                let scrollInterval = null;
                const sidebar = document.getElementById('swatchList');

                document.addEventListener('dragstart', (e) => {
                    if (e.target.classList.contains('swatch-item')) {
                        draggedItem = e.target;
                        e.target.classList.add('dragging');
                    }
                });

                document.addEventListener('dragend', (e) => {
                    if (e.target.classList.contains('swatch-item')) {
                        e.target.classList.remove('dragging');

                        // Clear scroll interval
                        if (scrollInterval) {
                            clearInterval(scrollInterval);
                            scrollInterval = null;
                        }

                        this.saveOrder();
                    }
                });

                document.addEventListener('dragover', (e) => {
                    e.preventDefault();

                    // Auto-scroll sidebar when dragging near edges
                    if (draggedItem) {
                        const sidebarRect = sidebar.getBoundingClientRect();
                        const mouseY = e.clientY;
                        const scrollThreshold = 50;
                        const scrollSpeed = 10;

                        // Clear existing interval
                        if (scrollInterval) {
                            clearInterval(scrollInterval);
                            scrollInterval = null;
                        }

                        // Scroll up
                        if (mouseY < sidebarRect.top + scrollThreshold) {
                            scrollInterval = setInterval(() => {
                                sidebar.scrollTop -= scrollSpeed;
                            }, 20);
                        }
                        // Scroll down
                        else if (mouseY > sidebarRect.bottom - scrollThreshold) {
                            scrollInterval = setInterval(() => {
                                sidebar.scrollTop += scrollSpeed;
                            }, 20);
                        }
                    }

                    const target = e.target.closest('.swatch-item');
                    if (target && draggedItem && target !== draggedItem) {
                        const container = target.parentElement;
                        const items = [...container.querySelectorAll('.swatch-item')];
                        const dragIndex = items.indexOf(draggedItem);
                        const targetIndex = items.indexOf(target);

                        if (dragIndex < targetIndex) {
                            target.after(draggedItem);
                        } else {
                            target.before(draggedItem);
                        }
                    }
                });
            }

            async saveOrder() {
                const items = document.querySelectorAll('.swatch-item');
                const order = Array.from(items).map(item => item.dataset.id);

                await fetch('?api=1&action=reorder', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        order
                    })
                });

                // Don't reload - order is already updated in DOM
                this.showStatus('Order saved', 'success');
            }

            showManageCategoriesModal() {
                this.renderCategoryList();
                document.getElementById('manageCategoriesModal').classList.add('active');
            }

            hideManageCategoriesModal() {
                document.getElementById('manageCategoriesModal').classList.remove('active');
            }

            async renderCategoryList() {
                await this.loadCategories();

                const html = this.categories.map(cat => `
                    <div class="management-item">
                        <div class="management-item-info">
                            <div class="management-item-name">${cat.name}</div>
                            <div class="management-item-meta">Slug: ${cat.slug} | Sort: ${cat.sort_order}</div>
                        </div>
                        <button class="management-item-delete" onclick="app.deleteCategory(${cat.id}, '${cat.name}')">Delete</button>
                    </div>
                `).join('');

                document.getElementById('categoryList').innerHTML = html;
            }

            async addCategory() {
                const name = document.getElementById('newCategoryName').value;
                const slug = document.getElementById('newCategorySlug').value;
                const description = document.getElementById('newCategoryDescription').value;

                if (!name || !slug) {
                    alert('Name and slug are required');
                    return;
                }

                const data = {
                    name,
                    slug,
                    description
                };

                const response = await fetch('?api=1&action=add_category', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data)
                });

                const result = await response.json();

                if (result.success) {
                    document.getElementById('newCategoryName').value = '';
                    document.getElementById('newCategorySlug').value = '';
                    document.getElementById('newCategoryDescription').value = '';
                    await this.renderCategoryList();
                    this.showStatus('Category added!', 'success');
                } else {
                    alert('Error: ' + result.error);
                }
            }

            async deleteCategory(id, name) {
                if (!confirm(`Delete category "${name}"? This will fail if any swatches use it.`)) return;

                const formData = new FormData();
                formData.append('id', id);

                const response = await fetch('?api=1&action=delete_category', {
                    method: 'POST',
                    body: formData
                });

                const result = await response.json();

                if (result.success) {
                    await this.renderCategoryList();
                    this.showStatus('Category deleted!', 'success');
                } else {
                    alert(result.error);
                }
            }

            showManageTagsModal() {
                this.renderTagList();

                // Populate tag category dropdown
                const select = document.getElementById('newTagCategory');

                fetch('?api=1&action=tag_categories')
                    .then(r => r.json())
                    .then(categories => {
                        select.innerHTML = categories
                            .map(cat => `<option value="${cat.id}">${cat.name}</option>`)
                            .join('');
                    });

                document.getElementById('manageTagsModal').classList.add('active');
            }

            hideManageTagsModal() {
                document.getElementById('manageTagsModal').classList.remove('active');
            }

            async renderTagList() {
                await this.loadTags();

                const grouped = this.groupTagsByCategory();

                const html = grouped.map(group => `
                    <div style="margin-bottom: 16px;">
                        <h5 style="font-size: 12px; color: var(--color-text-secondary); text-transform: uppercase; margin-bottom: 8px;">
                            ${group.category}
                        </h5>
                        ${group.tags.map(tag => `
                            <div class="management-item">
                                <div class="management-item-info">
                                    <div class="management-item-name">
                                        ${tag.hex_color ? `<span class="tag-color" style="background: ${tag.hex_color}; display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 6px; border: 1px solid var(--color-border);"></span>` : ''}
                                        ${tag.name}
                                    </div>
                                    <div class="management-item-meta">Slug: ${tag.slug}</div>
                                </div>
                                <button class="management-item-delete" onclick="app.deleteTag(${tag.id}, '${tag.name}')">Delete</button>
                            </div>
                        `).join('')}
                    </div>
                `).join('');

                document.getElementById('tagList').innerHTML = html;
            }

            async addNewTag() {
                const name = document.getElementById('newTagName').value;
                const tagCategoryId = document.getElementById('newTagCategory').value;
                const hexColor = document.getElementById('newTagHexColor').value;

                if (!name || !tagCategoryId) {
                    alert('Name and category are required');
                    return;
                }

                const data = {
                    name,
                    tag_category_id: tagCategoryId,
                    hex_color: hexColor
                };

                const response = await fetch('?api=1&action=add_tag', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data)
                });

                const result = await response.json();

                if (result.success) {
                    document.getElementById('newTagName').value = '';
                    document.getElementById('newTagHexColor').value = '';
                    await this.renderTagList();
                    await this.loadTags(); // Refresh for the main editor
                    this.showStatus('Tag added!', 'success');
                } else {
                    alert('Error: ' + result.error);
                }
            }

            async deleteTag(id, name) {
                if (!confirm(`Delete tag "${name}"? This will remove it from all swatches that use it.`)) return;

                const formData = new FormData();
                formData.append('id', id);

                const response = await fetch('?api=1&action=delete_tag', {
                    method: 'POST',
                    body: formData
                });

                const result = await response.json();

                if (result.success) {
                    await this.renderTagList();
                    await this.loadTags(); // Refresh for the main editor

                    const msg = result.removed_from > 0 ?
                        `Tag deleted! Removed from ${result.removed_from} swatch(es).` :
                        'Tag deleted!';
                    this.showStatus(msg, 'success');
                } else {
                    alert('Error: ' + result.error);
                }
            }

            showStatus(message, type = 'info') {
                const status = document.getElementById('statusMessage');
                status.textContent = message;

                setTimeout(() => {
                    status.textContent = 'Ready';
                }, 3000);
            }
        }

        const app = new SwatchEditor();
    </script>
</body>

</html>