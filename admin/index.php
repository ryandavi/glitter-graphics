<?php
require_once('includes/config.php');
require_once('includes/auth.php');

requireAuth('page');
$adminCsrfToken = getCsrfToken();
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
            <h1><a href="index.php">Glitter Admin</a></h1>
            <ul>
                <li><a href="glitter.php">Glitter</a></li>
                <li><a href="sticker.php">Stickers</a></li>
            </ul>
        </div>

        <main class="admin-dashboard">
            <h2>Asset Health</h2>
            <p class="modal-help">Review inactive rows before exporting; exports now publish approved assets only.</p>
            <div class="health-grid" id="healthGrid">
                <p>Loading health report…</p>
            </div>
        </main>
    </div>

    <script>
        const CONFIG = <?php echo json_encode($CONFIG); ?>;
        const ADMIN_CSRF_TOKEN = <?php echo json_encode($adminCsrfToken); ?>;
    </script>
    <script src="js/admin_api.js?v=2"></script>
    <script>
        Promise.all(['glitter', 'sticker'].map(async function(type) {
            const response = await AdminAPI.fetch('includes/api.php?action=health&type=' + type);
            return [type, await response.json()];
        })).then(function(reports) {
            document.getElementById('healthGrid').replaceChildren(...reports.map(function(entry) {
                const type = entry[0];
                const report = entry[1];
                const card = document.createElement('section');
                card.className = 'health-card';
                const heading = document.createElement('h3');
                heading.textContent = type.charAt(0).toUpperCase() + type.slice(1);
                card.appendChild(heading);
                ['inactive', 'missing', 'orphans', 'duplicates'].forEach(function(key) {
                    const values = report[key] || [];
                    const details = document.createElement('details');
                    const summary = document.createElement('summary');
                    summary.textContent = key.charAt(0).toUpperCase() + key.slice(1) + ': ' + values.length;
                    details.appendChild(summary);
                    if (values.length) {
                        const list = document.createElement('ul');
                        values.forEach(function(value) {
                            const item = document.createElement('li');
                            item.className = 'health-result';
                            const description = document.createElement('span');
                            if (key === 'duplicates') {
                                description.textContent = value.url;
                                item.appendChild(description);
                                const duplicateLinks = document.createElement('span');
                                duplicateLinks.className = 'health-actions';
                                value.assets.forEach(function(asset) {
                                    duplicateLinks.appendChild(makeAssetLink(type, asset.id, 'Edit ' + asset.name));
                                });
                                item.appendChild(duplicateLinks);
                            } else if (key === 'orphans') {
                                description.textContent = value.url;
                                item.appendChild(description);
                                const actions = document.createElement('span');
                                actions.className = 'health-actions';
                                actions.appendChild(makeAssetLink(type, null, 'Add to database', value.url));
                                actions.appendChild(makeCopyButton(value.url));
                                item.appendChild(actions);
                            } else {
                                description.textContent = value.name + ' — ' + value.url;
                                item.appendChild(description);
                                const actions = document.createElement('span');
                                actions.className = 'health-actions';
                                actions.appendChild(makeAssetLink(type, value.id, 'Open asset'));
                                actions.appendChild(makeCopyButton(value.url));
                                item.appendChild(actions);
                            }
                            list.appendChild(item);
                        });
                        details.appendChild(list);
                    }
                    card.appendChild(details);
                });
                return card;
            }));
        });

        function makeAssetLink(type, id, label, addUrl) {
            const link = document.createElement('a');
            const page = type === 'glitter' ? 'glitter.php' : 'sticker.php';
            link.href = id ? page + '?asset=' + encodeURIComponent(id) : page + '?addUrl=' + encodeURIComponent(addUrl);
            link.textContent = label;
            link.className = 'btn btn-secondary btn-sm';
            return link;
        }

        function makeCopyButton(value) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn btn-secondary btn-sm';
            button.textContent = 'Copy URL';
            button.addEventListener('click', async function() {
                await navigator.clipboard.writeText(value);
                button.textContent = 'Copied';
            });
            return button;
        }
    </script>
</body>
</html>
