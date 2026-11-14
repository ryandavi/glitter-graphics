# Deployment

The editor shell stays static; the public site uses PHP templates. It is online in two places, built from two branches, and each one updates on its own:

| | Current editor | Standalone public site |
|---|---|---|
| Branch | `glitter-and-sticker-editor` (main and default branch) | `public-pages` |
| Address | `https://ryandavi.github.io/glitter-graphics/` | `https://labs.ryandavi.com/glitter/` |
| Host | GitHub Pages (Settings > Pages, branch source) | Apache on Ryan's server, `.htaccess` enabled |
| Updates | Automatically, on every push to the main branch | When `/root/bin/deploy-glitter.sh` is run on the server |

## Keeping them separate

- Editor fixes go on the main branch, then get merged **into** `public-pages`. Never merge `public-pages` into the main branch: everything on the main branch goes live on GitHub Pages.
- The branches differ on purpose in two places. If a merge from main conflicts in either, keep the `public-pages` side:
  - the `og:url`, `og:image` and `twitter:image` lines of `index.html`, which point at each site's own address;
  - the `history` and `personalWeb` stages in `js/core/features.js`: `on` on `public-pages` (public with the new site), `local` on main, so GitHub Pages keeps them hidden. After resolving, run `node tools/build.js`.
- The labs deploy only ever reads `public-pages`, and GitHub Pages only ever reads the main branch, so deploying one never changes the other.
- CI runs the checks on every push to every branch. Neither site waits for it, so check the Actions tab before deploying labs.

## How a labs deploy works

On the server, `/root/bin/deploy-glitter.sh`:

1. Fetches the `public-pages` branch from GitHub into `/root/deploy/glitter`.
2. Copies only the paths listed under `publish` in `tools/site.json` into `/var/www/labs.ryandavi.com/glitter/`. This is the same set `tools/build-site.js` builds for `production`, with `index.html` unchanged. `admin/`, `tests/`, `tools/`, `docs/`, `content/` and the SCSS sources are never published.
3. Removes anything on the server that is no longer in that set.

The server has no Node.js, so nothing is built there. The committed `css/style.css`, `js/dist/boot.js`, the content pages (`about/`, `guide/`, `history/`, `personal-web/`, `preservation/`, `updates/`), `studio/index.php`, `404.php`, the shared `site/` includes and `sitemap.xml` are what get published. Compile the SCSS, then run `node tools/build.js` before committing: it rebuilds the modals and pages too, and the pages carry the stylesheet hash. The page list, titles, descriptions and the canonical `origin` are in `tools/site.json`.

Each public article has a generated `content.html` body and a tiny `index.php`
entry. `site/page.php` loads generated metadata and renders the shared
`layout.php`, `header.php` and `footer.php`. The editor fetches the rendered
article and extracts `.doc-content` for its modal; refreshing the article URL
loads the same PHP page. No Node.js is needed at request time.

PHP must be enabled on Apache. The published `.htaccess` lists `index.php`
before `index.html`, so the site root serves the homepage (`index.php`,
`site/home.php`) and `index.html` stays the editor shell that `studio/` serves.
Old generated article `index.html` files must be removed during deployment so
they cannot take precedence. The build removes them locally and the deploy
must continue removing paths absent from git. GitHub Pages remains on the
separate main branch and does not receive these PHP pages.

Because the server folder is overwritten from git, never edit files there directly. The change would be lost on the next deploy.

## Staging

`https://labs.ryandavi.com/glitter-staging/` is a password-protected copy for checking work before it goes to `/glitter/`.

- `/root/bin/deploy-glitter.sh --staging [branch]` publishes the same paths into `/var/www/labs.ryandavi.com/glitter-staging/`. The branch defaults to `public-pages`; any pushed branch works.
- The staging deploy deletes every `site:analytics` region from the published `.html` files, including `site/analytics.html`, so staging visits are never counted.
- The password, `X-Robots-Tag: noindex, nofollow` and `Cache-Control: private, no-store` are set in a `<Directory>` block in `/etc/apache2/sites-available/labs.ryandavi.com.conf`, not in the folder, so deploys never remove them. The no-store header keeps Cloudflare from caching staging files and serving them without the password.
- The password file is `/etc/apache2/.htpasswd-glitter-staging` (user `ryan`). Change the password with `htpasswd /etc/apache2/.htpasswd-glitter-staging ryan`.
- Generated pages always carry production canonical URLs. Staging is never indexed, so that is harmless.

## Daily use

- **Publish to labs:** push `public-pages`, then on the server run `/root/bin/deploy-glitter.sh`. It prints the deployed commit.
- **Publish to staging:** push the branch, then run `/root/bin/deploy-glitter.sh --staging [branch]`.
- **Preview a deploy:** `/root/bin/deploy-glitter.sh --dry-run -v` lists what would change.
- **Roll back:** push the last good version to `public-pages` (for example with `git revert`), then deploy again.
- **Update GitHub Pages:** push the main branch. GitHub publishes it within a minute or two.

## Changing what is published

- A new top-level file or folder the site needs at run time: add it to `publish` in `tools/site.json`. The labs deploy reads that list, so nothing else needs changing.
- To see exactly what would be published, run `node tools/build-site.js --env production` and look in `.tmp/site/production`.

PHP derives navigation and asset URLs from the executing script path, so production, staging and local mounts stay separate. Article-body URLs remain relative.

## Studio, errors and the dedicated domain

`studio/index.php` serves the existing static editor shell with a base URL
pointing at the site root. Public-page editor links use `studio/`; no second
copy of the editor shell is stored. The site root is the homepage; its tiles,
credits, counts and latest release are built into `site/generated.json` by
`tools/build-pages.js` from the Library data, so rebuild pages after changing
glitter tiles or releases.

`404.php` uses the shared public-page layout with `noindex`, returning the
original Apache error status (or 404 on direct access). Configure Apache to
serve it internally. For the current labs deployment, put these directives
in the server's `<Directory /var/www/labs.ryandavi.com/glitter>` configuration,
outside the folder the deploy replaces:

```apache
ErrorDocument 404 /glitter/404.php
ErrorDocument 403 /glitter/404.php
ErrorDocument 500 /glitter/404.php
```

Staging uses `/glitter-staging/404.php`. Verify an unknown nested URL returns
HTTP 404 and displays the error document; do not rewrite unknown URLs to the
editor with HTTP 200. Proxy or CDN failures may need a host-level error page.

The requested production destination is `https://glitter.ryandavi.com/`, with
the editor at `/studio/`. The general project space is `lab.ryandavi.com/<project>/`.
The new hostname is active: Apache serves `glitter.ryandavi.com` from the
existing `/var/www/labs.ryandavi.com/glitter` folder, using the Cloudflare Origin
CA wildcard certificate in `/etc/ssl/cloudflare/ryandavi.com.pem`. Its virtual
host is `/etc/apache2/sites-available/glitter.ryandavi.com.conf`; HTTP redirects
to HTTPS. The labs deploy continues updating the same folder. Application URL
updates and old-address redirects below are still pending:

1. DNS, TLS and the dedicated virtual host are configured. The existing deploy
   destination is shared with labs; no second deployment folder is needed.
2. Change `tools/site.json` `origin` and the editor's Open Graph/share URLs to
   `https://glitter.ryandavi.com/`, then rebuild. Keep the current canonical
   origin until the new host is ready.
3. On the new host, use `/404.php` for the error directives above.
4. On the `ryandavi.com` virtual host, redirect `/glitter` and its descendants:

   ```apache
   RewriteEngine On
   RewriteRule ^/?glitter(?:/(.*))?$ https://glitter.ryandavi.com/$1 [R=301,L]
   ```

   Apply the same rule on `labs.ryandavi.com` to preserve existing public
   article links. Test with temporary redirects before enabling permanent ones.
5. Verify `/studio/`, direct article loads, modal Back/Forward, nested 404s,
   asset requests and both old-address redirects before announcing the move.
