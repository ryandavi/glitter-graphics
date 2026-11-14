<?php
// Keep the static editor shell shared with the root and GitHub Pages.
echo str_replace('<head>', '<head>' . "\n\t" . '<base href="../">', file_get_contents(dirname(__DIR__) . '/index.html'));
