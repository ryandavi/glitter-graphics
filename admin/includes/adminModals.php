<?php

function renderAdminManagementModals($assetLabel)
{
	?>
	<div class="modal" id="addModal">
		<div class="modal-content modal-width-xl">
			<div class="modal-header">
				<h3>Add assets</h3>
				<button type="button" class="close-btn" onclick="app.hideAddModal()" aria-label="Close">×</button>
			</div>
			<div class="modal-body"></div>
			<div class="modal-footer">
				<p class="modal-footer-note">Approving adds files to the library. They reach the editor on the next Export JSON.</p>
				<button type="button" class="btn btn-secondary" onclick="app.hideAddModal()">Done</button>
				<button type="button" class="btn btn-primary" data-approve-all hidden>Approve ready</button>
			</div>
		</div>
	</div>

	<div class="modal" id="analyzeModal">
		<div class="modal-content modal-width-md">
			<div class="modal-header">
				<h3>Analysis results</h3>
				<button type="button" class="close-btn" onclick="app.hideAnalyzeModal()" aria-label="Close">×</button>
			</div>
			<div class="modal-body">
				<div class="modal-body-content">
					<p class="modal-help" data-analysis-help></p>
					<div id="analyzeResults"></div>
				</div>
			</div>
			<div class="modal-footer">
				<button type="button" class="btn btn-secondary" data-close-analysis onclick="app.hideAnalyzeModal()">Cancel</button>
				<button type="button" class="btn btn-primary" data-apply-analysis onclick="app.applyAnalysis()">Apply selected</button>
			</div>
		</div>
	</div>

	<div class="modal" id="tagModal">
		<div class="modal-content modal-width-xl">
			<div class="modal-header">
				<h3>Manage Tags</h3>
				<button type="button" class="close-btn" onclick="app.hideManageTagsModal()" aria-label="Close">×</button>
			</div>
			<div class="modal-body"></div>
		</div>
	</div>

	<div class="modal" id="categoryModal">
		<div class="modal-content modal-width-xl">
			<div class="modal-header">
				<h3>Manage Categories</h3>
				<button type="button" class="close-btn" onclick="app.hideCategoryModal()" aria-label="Close">×</button>
			</div>
			<div class="modal-body"></div>
		</div>
	</div>
	<?php
}
