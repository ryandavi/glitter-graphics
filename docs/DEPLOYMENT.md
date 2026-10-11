# Deployment

The editor is a static site. Publishing it means uploading a set of files to a web host. This is done by GitHub, from a commit, so that what is online always matches something in git.

There are two copies of the site:

- **Staging** is a private copy for checking changes in a real browser and on a real phone before anyone else sees them.
- **Production** is the public site.

Both are built from the same commit by the same steps. They differ only in where the files go and in the per-environment settings in `tools/site.json`.

## How it works

1. A push to the main branch (`glitter-and-sticker-editor`) starts the **Deploy** workflow (`.github/workflows/deploy.yml`).
2. It runs the same checks as CI: lint, shell markup, compiled CSS and the quick and export test suites. If any fail, nothing is published.
3. `tools/build-site.js` assembles the folder to upload. It copies only the paths listed under `publish` in `tools/site.json`, and only files tracked by git. `admin/`, `tests/`, `tools/`, `docs/`, `content/` and the SCSS sources are never published.
4. The folder is uploaded to **staging** over FTPS. Only files that changed since the last deploy are sent, and files removed from the repo are removed from the server.
5. **Production** is published the same way, but only when someone runs the workflow by hand and chooses `production`.

Feature branches and pull requests run the checks through the **CI** workflow and publish nothing.

Because the server is overwritten from git, never edit files on the server directly. The change would be lost on the next deploy.

## One-time setup

### On the web host

1. Create the staging address, for example a `staging` subdomain. Note the folder it serves from.
2. Password-protect the staging subdomain's root folder in the host's control panel (often called "Directory Privacy" or "Password Protect Directories"). Protect the root, not the folder the editor is uploaded into, so the deploy never touches the protection files. A password also keeps search engines out.
3. Decide the two upload folders: one inside the staging root and one for the public site, for example `staging.example.com/glitter/` and `example.com/glitter/`.
4. Create an FTP account for deploys. If the host allows it, restrict the account to the folders above. Check that the host supports FTPS (FTP over TLS); most do.

### On GitHub

In the repository, under Settings:

1. **Environments:** create two, named exactly `staging` and `production`.
2. In each environment, add these **secrets**:

	| Secret | Value |
	|---|---|
	| `FTP_SERVER` | The host's FTP address, for example `ftp.example.com` |
	| `FTP_USERNAME` | The deploy account's user name |
	| `FTP_PASSWORD` | The deploy account's password |

3. In each environment, add this **variable**:

	| Variable | Value |
	|---|---|
	| `FTP_SERVER_DIR` | The upload folder as the FTP account sees it, ending in `/`, for example `/public_html/glitter/` |

	Add `FTP_PROTOCOL` with the value `ftp` only if the host does not support FTPS. Plain FTP sends the password unencrypted, so prefer changing hosts or accounts over using it.

4. **Secrets and variables > Actions > Variables:** add a repository variable `DEPLOY_ENABLED` with the value `true`. Until it exists the Deploy workflow runs the checks and stops. Setting it to anything else pauses all deploys.

The first deploy to each environment uploads every file (about 2,200 files, 97 MB) and takes a while. Later deploys send only what changed.

## Daily use

- **Publish to staging:** merge or push to the main branch. Watch the run under the repository's Actions tab, then open the staging address.
- **Publish to production:** Actions > Deploy > Run workflow, choose the main branch and `production`.
- **Roll back:** Actions > Deploy > Run workflow, and in the branch selector choose the tag or branch of the last good version. To roll back to a commit that has no tag, create a branch at that commit first.
- **Pause deploys:** set `DEPLOY_ENABLED` to `false`.

## Changing what is published

- A new top-level file or folder the site needs at run time: add it to `publish` in `tools/site.json`. The build fails if an entry matches no tracked file.
- A new environment: add it to `environments` in `tools/site.json`, add it to the `options` list in `deploy.yml`, and create the matching GitHub environment.
- A per-environment difference in the page: add a flag to the environment in `tools/site.json` and handle it in `applyEnvironment` in `tools/build-site.js`. Staging turns analytics off this way, by removing the `site:analytics` region from `index.html`.

To see exactly what would be uploaded, run `node tools/build-site.js --env staging` and look in `.tmp/site/staging`.

## Moving hosts

Nothing in the build depends on the host. To move, create the folders and FTP account on the new host and change the secrets and `FTP_SERVER_DIR` in the two environments. All paths in the site are relative, so it works from a subfolder or from a domain root.
