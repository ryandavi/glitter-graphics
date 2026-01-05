<?php

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
    // Detect image type - PNG/JPG have no frame data
    $imageInfo = @getimagesize($this->imagePath);
    if ($imageInfo && $imageInfo[2] !== IMAGETYPE_GIF) {
        return [
            'frame_count' => 1,
            'frame_rate' => 0,
            'is_variable_framerate' => 0
        ];
    }

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
            'frame_rate' => 0,
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
    // Detect image type and load accordingly
    $imageInfo = @getimagesize($this->imagePath);
    if (!$imageInfo) {
        throw new Exception('Could not read image file');
    }

    $image = false;
    switch ($imageInfo[2]) {
        case IMAGETYPE_GIF:
            $image = @imagecreatefromgif($this->imagePath);
            break;
        case IMAGETYPE_JPEG:
            $image = @imagecreatefromjpeg($this->imagePath);
            break;
        case IMAGETYPE_PNG:
            $image = @imagecreatefrompng($this->imagePath);
            break;
        default:
            throw new Exception('Unsupported image type. Only GIF, PNG, and JPG are supported.');
    }

    if (!$image) {
        throw new Exception('Could not create image from file');
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
        // Note: The hue passed here has been rotated by +15 degrees in calculateHue()
        // Real Red (0) -> 15

        // REDS
        // We catch Red earlier now (at 340 instead of 345) to fix the "Pink Red" issue.
        // We also extend it to 25 so pure reds aren't called "Red-Orange".
        if ($hue >= 340 || $hue < 25) return "Red";

        // ORANGES
        // Pushed start to 25 to give Red more room
        if ($hue >= 25 && $hue < 40) return "Red-Orange";
        if ($hue >= 40 && $hue < 55) return "Orange";
        if ($hue >= 55 && $hue < 65) return "Yellow-Orange";

        // YELLOWS & GREENS
        if ($hue >= 65 && $hue < 80) return "Yellow";
        if ($hue >= 80 && $hue < 100) return "Yellow-Green";
        if ($hue >= 100 && $hue < 115) return "Lime";
        if ($hue >= 115 && $hue < 160) return "Green";
        if ($hue >= 160 && $hue < 175) return "Green-Cyan";

        // CYANS & BLUES
        if ($hue >= 175 && $hue < 195) return "Cyan";
        if ($hue >= 195 && $hue < 210) return "Cyan-Blue";
        if ($hue >= 210 && $hue < 225) return "Teal";
        if ($hue >= 225 && $hue < 260) return "Blue";

        // PURPLES & MAGENTAS
        if ($hue >= 260 && $hue < 275) return "Indigo";
        if ($hue >= 275 && $hue < 290) return "Purple";

        // Magenta range
        if ($hue >= 290 && $hue < 320) return "Magenta";

        // Transition zone (Hot Pink / Fuchsia)
        if ($hue >= 320 && $hue < 330) return "Magenta-Pink";

        // PINKS
        // Very narrow range now (330-340).
        // Anything 340+ is now caught by the Red check at the top.
        if ($hue >= 330 && $hue < 340) return "Pink";

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

?>