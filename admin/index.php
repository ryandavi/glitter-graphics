<?php

// Disable all caching
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Cache-Control: post-check=0, pre-check=0", false);
header("Pragma: no-cache");
header("Expires: Sat, 26 Jul 1997 05:00:00 GMT");

include_once('includes/config.php');

?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Swatch Editor</title>

    <link rel="stylesheet" href="css/swatch_admin.css">

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

                <div id="editorContent" class="editor-content">
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

            <div class="modal-header">
                <h3 class="modal-title">Add New Swatch</h3>
            </div>


            <div class="modal-body">

            <div class="form-section">
                <div class="form-group">
                    <label>Name</label>
                    <input type="text" id="newSwatchName" placeholder="My Glitter">
                </div>

                <div class="form-group">
                    <label>Category & File</label>
                    <div style="display: flex; gap: 8px; margin-bottom: 4px;">
                        <select id="quickCategory" style="flex: 1;" onchange="app.updateFilePath()">
                            <option value="">Select category...</option>
                            <!-- Populated from this.categories -->
                        </select>
                        <input type="file" id="filePathInput" accept=".gif" style="display: none;" onchange="app.handleFileSelection(event)">
                        <label for="filePathInput" class="btn btn-secondary" style="margin: 0; cursor: pointer;">
                            Browse…
                        </label>
                    </div>
                    <input type="text" id="newSwatchUrl" placeholder="images/glitter/sparkle/my-glitter.gif" style="width: 100%;">
                </div>
            </div>
</div>

            <div class="modal-footer">
                <button class="btn btn-primary" onclick="app.addSwatch()">Add</button>
                <button class="btn btn-secondary" onclick="app.hideAddModal()">Cancel</button>
            </div>


        </div>

    </div>

    <!-- Analyze Results Modal -->
    <div class="modal" id="analyzeModal">
        <div class="modal-content" style="max-width: 500px;">

        <div class="modal-header">
            <h3 class="modal-title">Auto-Analysis Results</h3>
</div>

            <div class="modal-body">
            <p>
                Select which fields to apply:
            </p>
            <div id="analyzeResults"></div>
            </div>

            <div class="modal-footer">
                <button class="btn btn-primary" onclick="app.applyAnalysis()">Apply Selected</button>
                <button class="btn btn-secondary" onclick="app.hideAnalyzeModal()">Cancel</button>
            </div>

        </div>
    </div>

    <!-- Manage Categories Modal -->
    <div class="modal" id="manageCategoriesModal">
        <div class="modal-content" style="max-width: 600px;">
            <div class="modal-header">
                 <h3 class="modal-title">Manage Categories</h3>
            </div>

            <div class="modal-body">
            <div class="form-section new-category">
                <h4>Add New Category</h4>
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

                <div class="form-group buttons">
                <button class="btn btn-primary" onclick="app.addCategory()">Add Category</button>
                </div>
            </div>

            <div class="existing-categories">
                <h4>Existing Categories</h4>
                <div class="category-list" id="categoryList"></div>
            </div>
            </div>

            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="app.hideManageCategoriesModal()">Close</button>
            </div>


        </div>

        
    </div>

    <!-- Manage Tags Modal -->
    <div class="modal" id="manageTagsModal">
        <div class="modal-content">

            <div class="modal-header">
                 <h3 class="modal-title">Manage Tags</h3>
            </div>

            <div class="modal-body">
                <div class="form-section">
                <h4>Add New Tag</h4>
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

                <div class="form-group buttons">
                <button class="btn btn-primary" onclick="app.addNewTag()">Add Tag</button>
                </div>
            </div>

            <div>
                <h4>Existing Tags</h4>
                <div class="tag-management-list" id="tagList"></div>
            </div>
            </div>

            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="app.hideManageTagsModal()">Close</button>
            </div>
        </div>
    </div>

    <script>
        const CONFIG = <?php echo json_encode($CONFIG); ?>;
    </script>
    <script src="js/swatch_admin.js"></script>
</body>

</html>