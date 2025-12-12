<?php
// Database connection
$db = new mysqli('127.0.0.1', 'root', '', 'glitter');
if ($db->connect_error) {
    die('Database connection failed: ' . $db->connect_error);
}

// Handle form submissions
$message = '';

// Update swatch
if (isset($_POST['update_swatch'])) {
    $id = (int)$_POST['swatch_id'];
    $name = $db->real_escape_string($_POST['name']);
    $url = $db->real_escape_string($_POST['url']);
    $category_id = (int)$_POST['category_id'];
    $is_pixelated = isset($_POST['is_pixelated']) ? 1 : 0;
    $is_active = isset($_POST['is_active']) ? 1 : 0;
    $generated_name = $db->real_escape_string($_POST['generated_name']);
    $frame_count = $_POST['frame_count'] ? (int)$_POST['frame_count'] : 'NULL';
    $frame_rate = $_POST['frame_rate'] ? (int)$_POST['frame_rate'] : 'NULL';
    $is_variable_framerate = isset($_POST['is_variable_framerate']) ? 1 : 0;
    $hue = $_POST['hue'] ? $db->real_escape_string($_POST['hue']) : 'NULL';
    $sort_order = $_POST['sort_order'] ? (int)$_POST['sort_order'] : 'NULL';
    $color_codes = $db->real_escape_string($_POST['color_codes']);
    $color_value = $_POST['color_value'] ? (int)$_POST['color_value'] : 'NULL';
    
    $sql = "UPDATE swatches SET 
            name = '$name',
            url = '$url',
            category_id = $category_id,
            is_pixelated = $is_pixelated,
            is_active = $is_active,
            generated_name = '$generated_name',
            frame_count = $frame_count,
            frame_rate = $frame_rate,
            is_variable_framerate = $is_variable_framerate,
            hue = $hue,
            sort_order = $sort_order,
            color_codes = '$color_codes',
            color_value = $color_value
            WHERE id = $id";
    
    if ($db->query($sql)) {
        $message = "Swatch updated successfully!";
    } else {
        $message = "Error updating swatch: " . $db->error;
    }
}

// Delete swatch
if (isset($_POST['delete_swatch'])) {
    $id = (int)$_POST['swatch_id'];
    
    // Delete related tags first
    $db->query("DELETE FROM swatch_tags WHERE swatch_id = $id");
    
    // Delete the swatch
    if ($db->query("DELETE FROM swatches WHERE id = $id")) {
        $message = "Swatch deleted successfully!";
        header("Location: " . $_SERVER['PHP_SELF']);
        exit;
    } else {
        $message = "Error deleting swatch: " . $db->error;
    }
}

// Add tag to swatch
if (isset($_POST['add_tag'])) {
    $swatch_id = (int)$_POST['swatch_id'];
    $tag_id = (int)$_POST['tag_id'];
    
    $sql = "INSERT IGNORE INTO swatch_tags (swatch_id, tag_id) VALUES ($swatch_id, $tag_id)";
    if ($db->query($sql)) {
        $message = "Tag added!";
    }
}

// Remove tag from swatch
if (isset($_POST['remove_tag'])) {
    $swatch_tag_id = (int)$_POST['swatch_tag_id'];
    
    $sql = "DELETE FROM swatch_tags WHERE id = $swatch_tag_id";
    if ($db->query($sql)) {
        $message = "Tag removed!";
    }
}

// Create new tag
if (isset($_POST['create_tag'])) {
    $tag_name = $db->real_escape_string($_POST['tag_name']);
    $tag_slug = strtolower(str_replace(' ', '-', $tag_name));
    $tag_category_id = (int)$_POST['tag_category_id'];
    $hex_color = $db->real_escape_string($_POST['hex_color']);
    
    $sql = "INSERT INTO tags (tag_category_id, name, slug, hex_color) 
            VALUES ($tag_category_id, '$tag_name', '$tag_slug', " . 
            ($hex_color ? "'$hex_color'" : "NULL") . ")";
    
    if ($db->query($sql)) {
        $message = "New tag created!";
    } else {
        $message = "Error creating tag: " . $db->error;
    }
}

// Get all categories
$categories = $db->query("SELECT * FROM categories ORDER BY sort_order");

// Get all tags grouped by category
$tag_categories = $db->query("SELECT * FROM tag_categories ORDER BY sort_order");
$tags_by_category = [];
$all_tags = $db->query("SELECT t.*, tc.name as category_name 
                        FROM tags t 
                        JOIN tag_categories tc ON t.tag_category_id = tc.id 
                        ORDER BY tc.sort_order, t.name");
while ($tag = $all_tags->fetch_assoc()) {
    $tags_by_category[$tag['category_name']][] = $tag;
}

// Get selected swatch for editing
$selected_swatch = null;
$swatch_tags = [];
if (isset($_GET['edit'])) {
    $edit_id = (int)$_GET['edit'];
    $result = $db->query("SELECT * FROM swatches WHERE id = $edit_id");
    $selected_swatch = $result->fetch_assoc();
    
    // Get current tags for this swatch
    $tags_result = $db->query("SELECT st.id as swatch_tag_id, st.tag_id, t.name, t.hex_color, tc.name as category_name
                               FROM swatch_tags st
                               JOIN tags t ON st.tag_id = t.id
                               JOIN tag_categories tc ON t.tag_category_id = tc.id
                               WHERE st.swatch_id = $edit_id
                               ORDER BY tc.sort_order, t.name");
    while ($tag = $tags_result->fetch_assoc()) {
        $swatch_tags[] = $tag;
    }
}

// Get all swatches
$swatches = $db->query("SELECT s.*, c.name as category_name 
                        FROM swatches s 
                        JOIN categories c ON s.category_id = c.id 
                        ORDER BY c.sort_order, s.name");
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edit Swatches</title>
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
            --spacing-xs: 4px;
            --spacing-sm: 8px;
            --spacing-md: 16px;
            --spacing-lg: 24px;
        }
        
        * { box-sizing: border-box; }
        
        body {
            margin: 0;
            padding: 20px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: var(--color-bg-primary);
            color: var(--color-text-primary);
            font-size: 14px;
        }
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
            display: grid;
            grid-template-columns: 300px 1fr;
            gap: 20px;
        }
        
        h1, h2 {
            margin: 0 0 20px 0;
            color: var(--color-text-primary);
        }
        
        h3 {
            margin: 24px 0 12px 0;
            font-size: 14px;
            color: var(--color-text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .sidebar {
            position: sticky;
            top: 20px;
            max-height: calc(100vh - 40px);
            overflow-y: auto;
        }
        
        .swatch-list {
            background: var(--color-bg-secondary);
            border-radius: 4px;
            padding: 10px;
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
            text-decoration: none;
            color: var(--color-text-primary);
        }
        
        .swatch-item:hover {
            background: var(--color-bg-tertiary);
        }
        
        .swatch-item.active {
            background: var(--color-accent);
        }
        
        .swatch-thumb {
            width: 30px;
            height: 30px;
            background-size: cover;
            border-radius: 4px;
            border: 1px solid var(--color-border);
            image-rendering: pixelated;
        }
        
        .swatch-info {
            flex: 1;
            min-width: 0;
        }
        
        .swatch-name {
            font-weight: 500;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        
        .main-content {
            background: var(--color-bg-secondary);
            border-radius: 4px;
            padding: 20px;
        }
        
        .message {
            padding: 12px;
            background: #28a745;
            color: white;
            border-radius: 4px;
            margin-bottom: 20px;
        }
        
        .form-group {
            margin-bottom: 16px;
        }
        
        label {
            display: block;
            margin-bottom: 4px;
            color: var(--color-text-secondary);
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        input[type="text"],
        input[type="number"],
        input[type="color"],
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
        
        .btn {
            background: var(--color-accent);
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            transition: background 0.2s;
        }
        
        .btn:hover {
            background: var(--color-accent-hover);
        }
        
        .btn-danger {
            background: #dc3545;
            margin-left: 8px;
        }
        
        .btn-danger:hover {
            background: #c82333;
        }
        
        .btn-group {
            display: flex;
            gap: 8px;
            margin-top: 20px;
        }
        
        .tags-section {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid var(--color-border);
        }
        
        .tag-list {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-bottom: 16px;
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
            color: #dc3545;
            cursor: pointer;
            padding: 0;
            font-size: 16px;
            line-height: 1;
        }
        
        .add-tag-form {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 8px;
            align-items: end;
        }
        
        .new-tag-section {
            margin-top: 30px;
            padding: 20px;
            background: var(--color-bg-tertiary);
            border-radius: 4px;
        }
        
        .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
        }
        
        .preview-image {
            max-width: 200px;
            margin-top: 8px;
            border: 1px solid var(--color-border);
            border-radius: 4px;
            image-rendering: pixelated;
        }
        
        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: var(--color-text-secondary);
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Sidebar with swatch list -->
        <div class="sidebar">
            <h2>Swatches</h2>
            <div class="swatch-list">
                <?php 
                $current_category = '';
                while ($swatch = $swatches->fetch_assoc()): 
                    if ($current_category !== $swatch['category_name']):
                        $current_category = $swatch['category_name'];
                        echo '<div style="margin-top: 12px; margin-bottom: 8px; font-size: 11px; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">' . htmlspecialchars($current_category) . '</div>';
                    endif;
                ?>
                    <a href="?edit=<?php echo $swatch['id']; ?>" 
                       class="swatch-item <?php echo ($selected_swatch && $selected_swatch['id'] == $swatch['id']) ? 'active' : ''; ?>">
                        <div class="swatch-thumb" style="background-image: url('../<?php echo htmlspecialchars($swatch['url']); ?>');"></div>
                        <div class="swatch-info">
                            <div class="swatch-name"><?php echo htmlspecialchars($swatch['name']); ?></div>
                        </div>
                    </a>
                <?php endwhile; ?>
            </div>
        </div>
        
        <!-- Main content area -->
        <div class="main-content">
            <?php if ($message): ?>
                <div class="message"><?php echo htmlspecialchars($message); ?></div>
            <?php endif; ?>
            
            <?php if ($selected_swatch): ?>
                <h1>Edit: <?php echo htmlspecialchars($selected_swatch['name']); ?></h1>
                
                <form method="post" action="">
                    <input type="hidden" name="swatch_id" value="<?php echo $selected_swatch['id']; ?>">
                    
                    <div class="form-row">
                        <div class="form-group">
                            <label>Name</label>
                            <input type="text" name="name" value="<?php echo htmlspecialchars($selected_swatch['name']); ?>" required>
                        </div>
                        
                        <div class="form-group">
                            <label>Generated Name</label>
                            <input type="text" name="generated_name" value="<?php echo htmlspecialchars($selected_swatch['generated_name']); ?>">
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label>URL</label>
                        <input type="text" name="url" value="<?php echo htmlspecialchars($selected_swatch['url']); ?>" required>
                        <?php if ($selected_swatch['url']): ?>
                            <img src="../<?php echo htmlspecialchars($selected_swatch['url']); ?>" class="preview-image" alt="Preview">
                        <?php endif; ?>
                    </div>
                    
                    <div class="form-row">
                        <div class="form-group">
                            <label>Category</label>
                            <select name="category_id" required>
                                <?php 
                                $categories->data_seek(0);
                                while ($cat = $categories->fetch_assoc()): 
                                ?>
                                    <option value="<?php echo $cat['id']; ?>" 
                                            <?php echo ($cat['id'] == $selected_swatch['category_id']) ? 'selected' : ''; ?>>
                                        <?php echo htmlspecialchars($cat['name']); ?>
                                    </option>
                                <?php endwhile; ?>
                            </select>
                        </div>
                        
                        <div class="form-group">
                            <label>&nbsp;</label>
                            <div class="checkbox-group">
                                <input type="checkbox" name="is_pixelated" id="is_pixelated" 
                                       <?php echo $selected_swatch['is_pixelated'] ? 'checked' : ''; ?>>
                                <label for="is_pixelated" style="margin: 0; text-transform: none;">Pixelated</label>
                                
                                <input type="checkbox" name="is_active" id="is_active" 
                                       <?php echo $selected_swatch['is_active'] ? 'checked' : ''; ?>>
                                <label for="is_active" style="margin: 0; text-transform: none;">Active</label>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Frame Info -->
                    <h3>Frame Data</h3>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Frame Count</label>
                            <input type="number" name="frame_count" value="<?php echo htmlspecialchars($selected_swatch['frame_count']); ?>" min="0">
                        </div>
                        
                        <div class="form-group">
                            <label>Frame Rate (centiseconds)</label>
                            <input type="number" name="frame_rate" value="<?php echo htmlspecialchars($selected_swatch['frame_rate']); ?>" min="0">
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <div class="checkbox-group">
                            <input type="checkbox" name="is_variable_framerate" id="is_variable_framerate" 
                                   <?php echo $selected_swatch['is_variable_framerate'] ? 'checked' : ''; ?>>
                            <label for="is_variable_framerate" style="margin: 0; text-transform: none;">Variable Frame Rate</label>
                        </div>
                    </div>
                    
                    <!-- Color Info -->
                    <h3>Color Data</h3>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Color Codes (comma-separated hex)</label>
                            <input type="text" name="color_codes" value="<?php echo htmlspecialchars($selected_swatch['color_codes']); ?>" placeholder="#FF0000,#00FF00">
                        </div>
                        
                        <div class="form-group">
                            <label>Color Value (brightness 0-255)</label>
                            <input type="number" name="color_value" value="<?php echo htmlspecialchars($selected_swatch['color_value']); ?>" min="0" max="255">
                        </div>
                    </div>
                    
                    <div class="form-row">
                        <div class="form-group">
                            <label>Hue (0-1, neutrals=1.1)</label>
                            <input type="text" name="hue" value="<?php echo htmlspecialchars($selected_swatch['hue']); ?>" placeholder="0.500">
                        </div>
                        
                        <div class="form-group">
                            <label>Sort Order</label>
                            <input type="number" name="sort_order" value="<?php echo htmlspecialchars($selected_swatch['sort_order']); ?>">
                        </div>
                    </div>
                    
                    <div class="btn-group">
                        <button type="submit" name="update_swatch" class="btn">Update Swatch</button>
                    </div>
                </form>
                
                <!-- Delete Form -->
                <form method="post" style="margin-top: 12px;">
                    <input type="hidden" name="swatch_id" value="<?php echo $selected_swatch['id']; ?>">
                    <button type="submit" name="delete_swatch" class="btn btn-danger" 
                            onclick="return confirm('Are you sure you want to delete this swatch? This will also remove all associated tags.');">
                        Delete Swatch
                    </button>
                </form>
                
                <!-- Tags Section -->
                <div class="tags-section">
                    <h2>Tags</h2>
                    
                    <div class="tag-list">
                        <?php foreach ($swatch_tags as $tag): ?>
                            <div class="tag">
                                <?php if ($tag['hex_color']): ?>
                                    <span class="tag-color" style="background-color: <?php echo htmlspecialchars($tag['hex_color']); ?>;"></span>
                                <?php endif; ?>
                                <?php echo htmlspecialchars($tag['name']); ?>
                                <form method="post" style="display: inline;">
                                    <input type="hidden" name="swatch_tag_id" value="<?php echo $tag['swatch_tag_id']; ?>">
                                    <button type="submit" name="remove_tag" class="tag-remove" 
                                            onclick="return confirm('Remove this tag?');">×</button>
                                </form>
                            </div>
                        <?php endforeach; ?>
                    </div>
                    
                    <form method="post" class="add-tag-form">
                        <input type="hidden" name="swatch_id" value="<?php echo $selected_swatch['id']; ?>">
                        <div class="form-group" style="margin: 0;">
                            <label>Add Tag</label>
                            <select name="tag_id" required>
                                <option value="">Select a tag...</option>
                                <?php foreach ($tags_by_category as $cat_name => $tags): ?>
                                    <optgroup label="<?php echo htmlspecialchars($cat_name); ?>">
                                        <?php foreach ($tags as $tag): ?>
                                            <option value="<?php echo $tag['id']; ?>">
                                                <?php echo htmlspecialchars($tag['name']); ?>
                                            </option>
                                        <?php endforeach; ?>
                                    </optgroup>
                                <?php endforeach; ?>
                            </select>
                        </div>
                        <button type="submit" name="add_tag" class="btn">Add</button>
                    </form>
                </div>
                
                <!-- Create New Tag Section -->
                <div class="new-tag-section">
                    <h2>Create New Tag</h2>
                    <form method="post">
                        <div class="form-row">
                            <div class="form-group">
                                <label>Tag Name</label>
                                <input type="text" name="tag_name" required>
                            </div>
                            
                            <div class="form-group">
                                <label>Tag Category</label>
                                <select name="tag_category_id" required>
                                    <?php 
                                    $tag_categories->data_seek(0);
                                    while ($tc = $tag_categories->fetch_assoc()): 
                                    ?>
                                        <option value="<?php echo $tc['id']; ?>">
                                            <?php echo htmlspecialchars($tc['name']); ?>
                                        </option>
                                    <?php endwhile; ?>
                                </select>
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label>Hex Color (optional, for color tags)</label>
                            <input type="text" name="hex_color" placeholder="#FF0000">
                        </div>
                        
                        <button type="submit" name="create_tag" class="btn">Create Tag</button>
                    </form>
                </div>
                
            <?php else: ?>
                <div class="empty-state">
                    <h2>Select a swatch to edit</h2>
                    <p>Choose a swatch from the list on the left to begin editing.</p>
                </div>
            <?php endif; ?>
        </div>
    </div>
</body>
</html>