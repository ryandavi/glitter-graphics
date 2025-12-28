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