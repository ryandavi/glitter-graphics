<?php
require_once('assetAPI.php');

// ============================================
// STICKER-SPECIFIC API
// ============================================
class StickerAPI extends AssetAPI
{
    public function __construct($db, $config)
    {
        parent::__construct($db, $config, 'sticker');
    }

    protected function formatAssetForExport($asset, $tags, $searchTerms = [])
    {
        $analysis = AssetAnalysisResult::decode($asset['analysis_json'] ?? null);
        // Same resolution as glitter: a human override wins over the
        // analyzer's observation. Tags stay the gallery's filter surface;
        // this palette is machine data for masks, matching, and future use.
        $palette = $this->effectivePalette($asset);
        return [
            'id' => (int)$asset['id'],
            'name' => $asset['name'],
            'filename' => $asset['filename'],
            'url' => $asset['url'],
            'thumbnailUrl' => $asset['thumbnail_url'] ?: $asset['url'],
            'category' => $asset['category_slug'],
            'attribution' => $asset['attribution'] ?? null,
            'stickerText' => $asset['sticker_text'] ?? null,
            'tags' => $tags,
            'searchTerms' => $searchTerms,
            'colorCodes' => array_values(array_column($palette, 'hex')),
            'colorWeights' => array_values(array_map('floatval', array_column($palette, 'weight'))),
            'paletteType' => $analysis['palette']['type'] ?? null,
            'isAnimated' => (int)$asset['is_animated'],
            'hasTransparency' => (int)$asset['has_transparency'],
            'width' => (int)($asset['width'] ?? 0),
            'height' => (int)($asset['height'] ?? 0),
            'frameCount' => (int)($asset['frame_count'] ?? 0),
            'frameRate' => (int)($asset['frame_rate'] ?? 10),
            'isVariableFramerate' => (int)$asset['is_variable_framerate'],
            'fileSize' => (int)($asset['file_size'] ?? 0),
            'sortOrder' => (int)($asset['sort_order'] ?? 0),
        ];
    }

    protected function getAssetSpecificFields()
    {
        return [
            'string' => ['name', 'filename', 'url', 'attribution', 'sticker_text', 'thumbnail_url', 'file_hash'],
            'int' => ['sticker_category_id', 'width', 'height', 'frame_count', 'frame_rate', 'file_size', 'sort_order'],
            'float' => [],
            'bool' => ['is_animated', 'has_transparency', 'is_active', 'is_variable_framerate'],
        ];
    }

    protected function getNullableStringFields()
    {
        return ['attribution', 'sticker_text'];
    }

    protected function getUpdateExtraAssignments($data)
    {
        if (array_key_exists('sticker_category_id', $data)) {
            return ['sort_order = 0'];
        }

        return [];
    }

    protected function getAddFieldMap()
    {
        return [
            'name' => ['type' => 's'],
            'filename' => ['type' => 's'],
            'url' => ['type' => 's'],
            'sticker_category_id' => ['type' => 'i', 'source' => 'category_id', 'default' => 1],
            'attribution' => ['type' => 's', 'default' => null],
            'is_active' => ['type' => 'i', 'default' => 1],
        ];
    }

    protected function persistAnalysis($id, $analysis, $includeColors = true)
    {
        parent::persistAnalysis($id, $analysis, $includeColors);
        $thumbnailUrl = $this->generateThumbnail($id, $this->getAssetUrlById($id)['url']);
        $stmt = $this->db->prepare(
            "UPDATE {$this->tables['table']} SET thumbnail_url = ? WHERE id = ?",
            'si',
            [$thumbnailUrl, (int)$id]
        );
        $stmt->close();
    }

    public function analyzeAsset($id)
    {
        $analysis = parent::analyzeAsset($id);
        $asset = $this->getAssetUrlById($id);
        $thumbnailUrl = $this->generateThumbnail($id, $asset['url']);
        $stmt = $this->db->prepare(
            "UPDATE {$this->tables['table']} SET thumbnail_url = ? WHERE id = ?",
            'si',
            [$thumbnailUrl, (int)$id]
        );
        $stmt->close();
        return $analysis;
    }

    public function rejectAsset($id)
    {
        $result = parent::rejectAsset($id);
        $thumbnail = dirname(__DIR__, 2) . '/images/stickers/.thumbs/' . (int)$id . '.png';
        if (file_exists($thumbnail)) {
            unlink($thumbnail);
        }
        return $result;
    }

    private function generateThumbnail($id, $url)
    {
        $sourcePath = $this->assetFilePath($url);
        $info = @getimagesize($sourcePath);
        if (!$info) {
            return null;
        }
        $loaders = [
            IMAGETYPE_GIF => 'imagecreatefromgif',
            IMAGETYPE_PNG => 'imagecreatefrompng',
            IMAGETYPE_JPEG => 'imagecreatefromjpeg',
        ];
        if (!isset($loaders[$info[2]]) || !($source = @$loaders[$info[2]]($sourcePath))) {
            return null;
        }
        $max = $this->config['thumbnail_max_size'];
        $scale = min(1, $max / max(imagesx($source), imagesy($source)));
        $width = max(1, (int)round(imagesx($source) * $scale));
        $height = max(1, (int)round(imagesy($source) * $scale));
        $thumb = imagecreatetruecolor($width, $height);
        imagealphablending($thumb, false);
        imagesavealpha($thumb, true);
        imagefill($thumb, 0, 0, imagecolorallocatealpha($thumb, 0, 0, 0, 127));
        imagecopyresampled($thumb, $source, 0, 0, 0, 0, $width, $height, imagesx($source), imagesy($source));
        $directory = dirname(__DIR__, 2) . '/images/stickers/.thumbs';
        if (!is_dir($directory)) {
            mkdir($directory, 0775, true);
        }
        $path = $directory . '/' . (int)$id . '.png';
        imagepng($thumb, $path);
        imagedestroy($source);
        imagedestroy($thumb);

        return 'images/stickers/.thumbs/' . (int)$id . '.png';
    }
}
