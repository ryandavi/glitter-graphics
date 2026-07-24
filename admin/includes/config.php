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
    'color_threshold' => 5,
    'cluster_merge_distance' => 12,
    'sample_frame_count' => 3,
    'sparkle_lightness' => 92,
    'sparkle_chroma' => 10,
    'pattern_min_clusters' => 4,
    'pattern_min_coverage' => 0.10,
    'pattern_hue_spread' => 60,
    'tag_match_distance' => 25,
    'sparkle_tag_min_coverage' => 0.18,
    'naming_min_coverage' => 0.025,
    'naming_min_saturation' => 18,
    'single_color_min_dominance' => 0.18,
    'compound_color_min_coverage' => 0.10,
    'compound_white_min_coverage' => 0.18,
    'rainbow_min_families' => 5,
    'rainbow_min_entropy' => 0.65,
    'rainbow_balanced_min_families' => 4,
    'rainbow_balanced_min_entropy' => 0.80,
    'rainbow_max_dominant_share' => 0.35,
    'rainbow_min_colored_coverage' => 0.28,
    'thumbnail_max_size' => 128,
    'upload_max_bytes' => 5 * 1024 * 1024,
    
    // Asset types
    'asset_types' => [
        'glitter' => [
            'table' => 'glitter',
            'categories_table' => 'glitter_categories',
            'tags_table' => 'glitter_tags',
            'tag_categories_table' => 'glitter_tag_categories',
            'tags_map_table' => 'glitter_tags_map',
            'json_file' => 'data/glitter.json',
            'categories_json_file' => 'data/glitter-categories.json'
        ],
        'sticker' => [
            'table' => 'stickers',
            'categories_table' => 'sticker_categories',
            'tags_table' => 'sticker_tags',
            'tag_categories_table' => 'sticker_tag_categories',
            'tags_map_table' => 'sticker_tags_map',
            'json_file' => 'data/stickers.json',
            'categories_json_file' => 'data/sticker-categories.json'
        ]
    ]
];
