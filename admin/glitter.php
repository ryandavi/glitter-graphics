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
    <title>Glitter Admin</title>

    <link rel="stylesheet" href="css/swatch_admin.css">

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
                    <h2>Select a glitter to edit</h2>
                    <p>Choose a glitter from the list or add a new one.</p>
                </div>

                <div id="editorContent" class="editor-content">
                    <!-- Editor populated by JavaScript -->
                </div>
            </div>

            <!-- Fixed Footer -->
            <div class="fixed-footer">
                <span class="status-message" id="statusMessage">Ready</span>
                <div class="footer-actions">
                    <button class="btn btn-secondary" onclick="app.exportJSON()">Export glitter.json</button>
                    <button class="btn btn-secondary" onclick="app.exportCategoriesJSON()">Export glitter-categories.json</button>
                    <button class="btn btn-primary" onclick="app.saveSwatch()">Save Changes</button>
                </div>
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

                    <div class="form-wrapper">
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

    <!-- Category Management Modal -->
    <div class="modal" id="categoryModal">
        <div class="modal-content" style="max-width: 800px;">
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
                            <label>Name:</label>
                            <input type="text" id="newCategoryName" placeholder="e.g., Classic Sparkle">

                        </div>
                        <div class="form-row">
                            <label>
                                Slug:</label>
                            <input type="text" id="newCategorySlug" placeholder="e.g., classic-sparkle">

                        </div>
                        <div class="form-row">
                            <label>
                                Description:</label>
                            <textarea id="newCategoryDescription" rows="2" placeholder="Category description"></textarea>

                        </div>
                        <div class="form-row">
                            <label>
                                Icon Path:</label>
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
                            <input type="number" id="newCategorySortOrder" value="0" min="0">

                        </div>
                        <button class="btn btn-primary" onclick="app.addCategory()">Add Category</button>

</div>
                    </div>

                    <!-- Existing Categories List -->
                    <div class="category-list-section">
                        <h4>Existing Categories</h4>
                        <div id="categoriesList" class="categories-list">
                            <!-- Populated by JavaScript -->
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Edit Category Modal -->
    <div class="modal" id="editCategoryModal">
        <div class="modal-content" style="max-width: 600px;">
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
    </script>
    <script src="js/swatch_admin.js"></script>
</body>

</html>