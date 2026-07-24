<?php
require_once('includes/config.php');
require_once('includes/auth.php');

requireAuth('page');
$adminCsrfToken = getCsrfToken();

// Disable all caching
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Cache-Control: post-check=0, pre-check=0", false);
header("Pragma: no-cache");
header("Expires: Sat, 26 Jul 1997 05:00:00 GMT");
?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Glitter Admin</title>
    <script>(function(){try{var s=JSON.parse(localStorage.getItem('glitterEditorSettings')||'{}');document.documentElement.dataset.theme=s.interfaceTheme||'dark';}catch(e){document.documentElement.dataset.theme='dark';}}());</script>
    <link rel="stylesheet" href="css/swatch_admin.css?v=2">

</head>

<body>
    <div class="container">

        <!-- Header -->
        <div class="header">
            <h1><a href="index.php">Glitter Admin</a> / Glitter</h1>
            <ul>
                <li class="current">Glitter</li>
                <li><a href="sticker.php">Stickers</a></li>
            </ul>
        </div>

        <!-- Sidebar -->
        <div class="sidebar">
            <div class="sidebar-header">
                <h2>Glitter</h2>
                <button class="add-swatch-btn" onclick="app.showAddModal()">+ Add New</button>
                <div class="sidebar-action-row">
                    <button class="btn btn-secondary sidebar-action" onclick="app.showManageCategoriesModal()">Manage Categories</button>
                    <button class="btn btn-secondary sidebar-action" onclick="app.showManageTagsModal()">Manage Tags</button>
                </div>
                <div class="sidebar-bulk-action">
                    <label class="bulk-colors-option"><input type="checkbox" id="bulkIncludeColors" checked> Include colors</label>
                    <button class="btn btn-primary bulk-analyze-button" onclick="app.analyzeBulk()">🔍 Bulk Analyze All</button>
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
                    <h2>Select a glitter to edit</h2>
                    <p>Choose a glitter from the list or add a new one.</p>
                </div>

                <div id="editorContent" class="editor-content">
                    <!-- Editor populated by JavaScript -->
                </div>
            </div>

            <!-- Fixed Footer -->
            <div class="fixed-footer">
                <span class="status-message" id="statusMessage"></span>
                <div class="button-group">
                    <button class="btn btn-secondary" onclick="app.exportJSON()">Export JSON</button>
                    <button class="btn btn-secondary" onclick="app.exportCategoriesJSON()">Export Categories</button>
                    <button class="btn btn-danger" onclick="app.deleteAsset()">Delete</button>
                    <button class="btn btn-primary" onclick="app.saveAsset()">Save</button>
                </div>
            </div>
        </div>
    </div>

    <!-- Add Modal -->
    <div class="modal" id="addModal">
        <div class="modal-content">
            <div class="modal-header">
                <h3>Add New Glitter</h3>
                <button class="close-btn" onclick="app.hideAddModal()">×</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>Category</label>
                    <select id="quickCategory" onchange="app.updateFilePath()">
                        <!-- Populated by JavaScript -->
                    </select>
                </div>

                <div class="form-group">
                    <label>Name</label>
                    <input type="text" id="newGlitterName" placeholder="e.g., Pink Sparkle">
                </div>

                <div class="form-group">
                    <label>URL</label>
                    <input type="text" id="newGlitterUrl" placeholder="images/glitter/sparkle/pink.gif">
                </div>

                <div class="form-group">
                    <label>Or Upload File</label>
                    <input type="file" accept="image/gif,image/png,image/jpeg" multiple onchange="app.handleFileSelection(event)">
                    <small>Select a category first, then choose a file</small>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="app.hideAddModal()">Cancel</button>
                <button class="btn btn-primary" onclick="app.addAsset()">Add Glitter</button>
            </div>
        </div>
    </div>

    <!-- Analyze Modal -->
    <div class="modal" id="analyzeModal">
        <div class="modal-content modal-width-md">
            <div class="modal-header">
                <h3>Analysis Results</h3>
                <button class="close-btn" onclick="app.hideAnalyzeModal()">×</button>
            </div>
            <div class="modal-body">
                <p class="modal-help">
                    Select which properties to apply to the current glitter:
                </p>
                <div id="analyzeResults">
                    <!-- Populated by JavaScript -->
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="app.hideAnalyzeModal()">Cancel</button>
                <button class="btn btn-primary" onclick="app.applyAnalysis()">Apply Selected</button>
            </div>
        </div>
    </div>

    <!-- Tag Management Modal -->
    <div class="modal" id="tagModal">
        <div class="modal-content modal-width-lg">
            <div class="modal-header">
                <h3>Manage Tags</h3>
                <button class="close-btn" onclick="app.hideManageTagsModal()">×</button>
            </div>
            <div class="modal-body">
                <div class="tag-manager">
                    <div>
                        <h4>Add New Tag</h4>
                        <div class="tag-form-section">
                            <div class="form-group">
                                <label>Tag Name</label>
                                <input type="text" id="newTagName" placeholder="e.g., Holographic">
                            </div>

                            <div class="form-group">
                                <label>Tag Category</label>
                                <select id="newTagCategory">
                                    <!-- Populated by JavaScript -->
                                </select>
                            </div>

                            <div class="form-group">
                                <label>Hex Color (optional, for color tags)</label>
                                <input type="text" id="newTagHexColor" placeholder="#FF0000">
                            </div>

                            <div class="form-group buttons">
                                <button class="btn btn-primary" onclick="app.addNewTag()">Add Tag</button>
                            </div>
                        </div>


                    </div>

                    <div>
                        <h4>Existing Tags</h4>
                        <div class="tag-management-list">
                            <!-- Populated by JavaScript -->
                        </div>
                    </div>
                </div>

                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="app.hideManageTagsModal()">Close</button>
                </div>
            </div>
        </div>
    </div>

    <!-- Category Management Modal -->
    <div class="modal" id="categoryModal">
        <div class="modal-content modal-width-lg">
            <div class="modal-header">
                <h3>Manage Categories</h3>
                <button class="close-btn" onclick="app.hideCategoryModal()">×</button>
            </div>
            <div class="modal-body">
                <div class="category-manager">
                    <!-- Add New Category Form -->
                    <div class="category-form-section">
                        <h4>Add New Category</h4>

                        <div class="form-wrapper">
                        <div class="form-row">
                            <label>
                                Name:</label>
                            <input type="text" id="newCategoryName" placeholder="e.g., Sparkle">

                        </div>
                        <div class="form-row">
                            <label>
                                Slug:</label>
                            <input type="text" id="newCategorySlug" placeholder="e.g., sparkle">

                        </div>
                        <div class="form-row">
                            <label>
                                Description: </label>
                            <textarea id="newCategoryDescription" rows="2" placeholder="Optional description"></textarea>

                        </div>
                        <div class="form-row">
                            <label>
                                Icon Path: </label>
                            <input type="text" id="newCategoryIcon" placeholder="images/glitter/sparkle/icon.gif">

                        </div>

                        <div class="form-row">
                            <label>
                                Color:</label>
                            <input type="color" id="newCategoryColor" value="#ff69b4">

                        </div>

                        <div class="form-row">
                            <label>
                                Sort Order:</label>
                            <input type="number" id="newCategorySortOrder" min="0" value="0">

                        </div>
                        <div class="form-row">
                            <button class="btn btn-primary" onclick="app.addCategory()">Add Category</button>
                        </div>
</div>
                    </div>

                    <!-- Existing Categories List -->
                    <div class="categories-list-section">
                        <h4>Existing Categories</h4>
                        <div id="categoriesList">
                            <!-- Populated by JavaScript -->
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Edit Category Modal -->
    <div class="modal" id="editCategoryModal">
        <div class="modal-content modal-width-md">
            <div class="modal-header">
                <h3>Edit Category</h3>
                <button class="close-btn" onclick="app.hideEditCategoryModal()">×</button>
            </div>
            <div class="modal-body">

            <div class="form-wrapper">
                <input type="hidden" id="editCategoryId">
                <div class="form-row">
                    <label>
                        Name:</label>
                    <input type="text" id="editCategoryName">

                </div>
                <div class="form-row">
                    <label>
                        Slug:</label>
                    <input type="text" id="editCategorySlug">

                </div>
                <div class="form-row">
                    <label>
                        Description: </label>
                    <textarea id="editCategoryDescription" rows="2"></textarea>

                </div>
                <div class="form-row">
                    <label>
                        Icon Path: </label>
                    <input type="text" id="editCategoryIcon" placeholder="images/glitter/sparkle/icon.gif">

                </div>

                <div class="form-row">
                    <label>
                        Color:</label>
                    <input type="color" id="editCategoryColor">

                </div>

                <div class="form-row">
                    <label>
                        Sort Order:</label>
                    <input type="number" id="editCategorySortOrder" min="0">

                </div>
                <div class="form-actions">
                    <button class="btn btn-secondary" onclick="app.hideEditCategoryModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="app.saveCategory()">Save Changes</button>
                </div>

</div>
            </div>
        </div>
    </div>



    <script>
        const CONFIG = <?php echo json_encode($CONFIG); ?>;
        const ADMIN_CSRF_TOKEN = <?php echo json_encode($adminCsrfToken); ?>;
    </script>
    <script src="js/admin_api.js?v=2"></script>
    <script src="js/asset_admin.js?v=3"></script>
    <script src="js/glitter_admin.js?v=3"></script>
</body>

</html>
