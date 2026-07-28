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
    // Rainbow/multicolor assets spread coverage thinly; they keep a lower
    // floor so the exported palette reflects the real spread.
    'palette_spread_threshold' => 2,
    // Coherent fills are materials even when small; scatter, not size,
    // separates them from dither speckle and antialiased blends.
    'solid_cluster_max_scatter' => 0.35,
    'solid_cluster_min_coverage' => 0.02,
    // CIEDE2000, not CIE76: ~16 is roughly "clearly the same color" for
    // palette purposes. Raise it to fold shades together more aggressively,
    // lower it to keep finer distinctions. Measured at 12 the palettes of
    // dithered artwork kept three near-identical tans that read as one color.
    'cluster_merge_distance' => 16,
    // dE2000 compresses chroma differences but not lightness ones, so two
    // grays a fixed distance apart still read as one material where two hues
    // at that distance read as two colors. Neutral pairs merge on a longer
    // leash — this is what stops a chrome ramp exporting as five grays.
    'cluster_merge_distance_neutral' => 22,
    // Lab chroma below this counts as neutral for merging and overlay tests.
    'neutral_chroma_max' => 10,
    'sample_frame_count' => 3,
    'sparkle_lightness' => 92,
    'sparkle_chroma' => 10,
    'pattern_min_clusters' => 4,
    'pattern_min_coverage' => 0.10,
    'pattern_hue_spread' => 60,
    // Also CIEDE2000 now. The old value of 25 was tuned against CIE76's
    // inflated scale and would match almost any hue under this metric.
    'tag_match_distance' => 14,
    'sparkle_tag_min_coverage' => 0.18,
    'naming_min_coverage' => 0.025,
    // A trace of color does not make an asset colored. Below this share of the
    // image the color names fall away and the asset is described as the neutral
    // it mostly is — a silver rhinestone with a gold glint was reading as "Tan".
    'naming_min_colored_coverage' => 0.15,
    'naming_min_saturation' => 18,
    // HSV saturation divides by value, so near-black cluster averages report a
    // strong saturation and an arbitrary hue: a black outline was founding a
    // hue family with half the image behind it. Below this value a cluster is
    // neutral whatever its saturation says.
    'naming_min_value' => 12,
    'single_color_min_dominance' => 0.18,
    'compound_color_min_coverage' => 0.10,
    'compound_white_min_coverage' => 0.18,
    // A hue family only counts as a family when it holds a material share of
    // the colored area. Dithered and antialiased artwork scatters trace
    // clusters over many hues, and counting those read every illustration as
    // a rainbow. The absolute floor covers images that are mostly neutral.
    'family_min_coverage' => 0.02,
    'family_min_share' => 0.08,
    'rainbow_min_families' => 5,
    'rainbow_min_entropy' => 0.65,
    'rainbow_balanced_min_families' => 4,
    'rainbow_balanced_min_entropy' => 0.80,
    'rainbow_max_dominant_share' => 0.35,
    'rainbow_min_colored_coverage' => 0.28,
    // Dither and antialias blends sit on the Lab segment between the two
    // colors being mixed and never out-saturate both of them, which is what
    // separates them from a genuine third color.
    'dither_anchor_min_coverage' => 0.07,
    'dither_blend_max_coverage' => 0.05,
    'dither_blend_distance' => 11,
    // Share of a cluster's pixels with at most one like neighbour. Near 1.0 the
    // color exists only as speckle between other colors, so it folds into its
    // anchor however much of the image it covers — size alone used to decide,
    // which let a large fully-scattered mixture survive as its own color.
    'dither_blend_min_scatter' => 0.85,
    // An animated glitter overlay lays a scattered gray ramp over the artwork,
    // and every step of that ramp lands as its own cluster — four entries of
    // sparkle crowding out the colors a viewer would actually name. Those steps
    // collapse into one entry, but only when there is real color underneath:
    // on an achromatic asset the ramp is the subject (chrome, silver), not an
    // overlay, and it stays as it is.
    'glitter_overlay_min_scatter' => 0.5,
    'glitter_overlay_min_chromatic_coverage' => 0.25,
    // How many entries the sidebar's Recent group holds. It exists so a just-
    // added or just-edited asset is findable without hunting its category.
    'admin_recent_limit' => 12,
    'thumbnail_max_size' => 128,
    'upload_max_bytes' => 5 * 1024 * 1024,
    'managed_asset_roots' => [
        'glitter' => 'images/glitter',
        'sticker' => 'images/stickers',
    ],
    'incoming_root' => 'data/admin-incoming',
    'allowed_asset_types' => [
        'gif' => ['mime' => ['image/gif']],
        'png' => ['mime' => ['image/png']],
        'jpg' => ['mime' => ['image/jpeg']],
        'jpeg' => ['mime' => ['image/jpeg']],
    ],
    'analysis_version' => 6,
    'palette_sample_limit' => 8,
    'palette_limited_limit' => 5,
    'palette_photographic_entropy' => 0.78,
    'palette_multicolor_families' => 4,
    'palette_neutral_chroma' => 0.16,
    'color_tag_min_family_weight' => 0.10,
    'neutral_tag_words' => ['white' => 82, 'gray' => 22, 'black' => 0],
    // The vocabulary ColorClassifier emits, and the only values the admin's
    // Palette Type override offers. Older analysis payloads may hold other
    // names; those still display as the Auto value.
    'palette_types' => ['single', 'two-tone', 'gradient', 'multicolor', 'rainbow', 'neutral'],
    // Stickers are illustrations: dithered fills and antialiased edges invent
    // hues a small glitter tile never has, so a hue family has to hold more of
    // the image before it counts. Glitter tiles genuinely use few colors, so
    // they keep the lower floor.
    'analysis_type_overrides' => [
        'sticker' => [
            'family_min_share' => 0.10,
            // Small coherent accents remain visually meaningful in illustrations;
            // scatter still rejects antialias and dither at this lower floor.
            'solid_cluster_min_coverage' => 0.002,
        ],
    ],
    // Filename-derived display names: minor words stay lowercase unless they
    // lead the name, and glued tokens no rule can split are spelled out here.
    'name_minor_words' => ['a', 'an', 'and', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'with'],
    'name_token_overrides' => [
        'fadeto' => 'fade to',
        'tiedye' => 'tie dye',
    ],
    'health_severity' => [
        'pending' => 'warning',
        'missing' => 'critical',
        'duplicate' => 'critical',
        'orphan' => 'warning',
        'analysis_missing' => 'warning',
        'analysis_stale' => 'warning',
        'thumbnail_missing' => 'info',
        'category_path_mismatch' => 'warning',
        'unsafe_file_type' => 'critical',
        'unreadable_file' => 'critical',
    ],
    
    // Asset types
    'asset_types' => [
        'glitter' => [
            'table' => 'glitter',
            'categories_table' => 'glitter_categories',
            'tags_table' => 'glitter_tags',
            'tag_categories_table' => 'glitter_tag_categories',
            'tags_map_table' => 'glitter_tags_map',
            'tag_aliases_table' => 'glitter_tag_aliases',
            'json_file' => 'data/glitter.json',
            'categories_json_file' => 'data/glitter-categories.json'
        ],
        'sticker' => [
            'table' => 'stickers',
            'categories_table' => 'sticker_categories',
            'tags_table' => 'sticker_tags',
            'tag_categories_table' => 'sticker_tag_categories',
            'tags_map_table' => 'sticker_tags_map',
            'tag_aliases_table' => 'sticker_tag_aliases',
            'json_file' => 'data/stickers.json',
            'categories_json_file' => 'data/sticker-categories.json'
        ]
    ]
];
