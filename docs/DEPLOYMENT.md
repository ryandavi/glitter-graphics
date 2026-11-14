# Deployment

The editor is a static site. It is online in two places, built from two branches, and each one updates on its own:

| | Current editor | Standalone public site |
|---|---|---|
| Branch | `glitter-and-sticker-editor` (main and default branch) | `public-pages` |
| Address | `https://ryandavi.github.io/glitter-graphics/` | `https://labs.ryandavi.com/glitter/` |
| Host | GitHub Pages (Settings > Pages, branch source) | Apache on Ryan's server, `.htaccess` enabled |
| Updates | Automatically, on every push to the main branch | When `/root/bin/deploy-glitter.sh` is run on the server |

## Keeping them separate

- Editor fixes go on the main branch, then get merged **into** `public-pages`. Never merge `public-pages` into the main branch: everything on the main branch goes live on GitHub Pages.
- The branches differ on purpose in the `og:url`, `og:image` and `twitter:image` lines of `index.html`, which point at each site's own address. If a merge from main conflicts there, keep the `public-pages` side.
- The labs deploy only ever reads `public-pages`, and GitHub Pages only ever reads the main branch, so deploying one never changes the other.
- CI runs the checks on every push to every branch. Neither site waits for it, so check the Actions tab before deploying labs.

## How a labs deploy works

On the server, `/root/bin/deploy-glitter.sh`:

1. Fetches the `public-pages` branch from GitHub into `/root/deploy/glitter`.
2. Copies only the paths listed under `publish` in `tools/site.json` into `/var/www/labs.ryandavi.com/glitter/`. This is the same set `tools/build-site.js` builds for `production`, with `index.html` unchanged. `admin/`, `tests/`, `tools/`, `docs/`, `content/` and the SCSS sources are never published.
3. Removes anything on the server that is no longer in that set.

The server has no Node.js, so nothing is built there. The committed `css/style.css` and `js/dist/boot.js` are what get published: run `node tools/build.js` and compile the SCSS before committing.

Because the server folder is overwritten from git, never edit files there directly. The change would be lost on the next deploy.

## Daily use

- **Publish to labs:** push `public-pages`, then on the server run `/root/bin/deploy-glitter.sh`. It prints the deployed commit.
- **Preview a deploy:** `/root/bin/deploy-glitter.sh --dry-run -v` lists what would change.
- **Roll back:** push the last good version to `public-pages` (for example with `git revert`), then deploy again.
- **Update GitHub Pages:** push the main branch. GitHub publishes it within a minute or two.

## Changing what is published

- A new top-level file or folder the site needs at run time: add it to `publish` in `tools/site.json`. The labs deploy reads that list, so nothing else needs changing.
- To see exactly what would be published, run `node tools/build-site.js --env production` and look in `.tmp/site/production`.

All paths in the site are relative, so it works from a subfolder or from a domain root.
