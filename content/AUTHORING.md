# Writing modal pages

Every modal (history, personal-web, aylana, preservation, about, welcome, guide) is written in `content/src/<page>.src.html` and built into `modals/<page>.html`. Never edit the built file. Voice, structure and citation style for the articles: `docs/local/HISTORY-PAGE-STYLE-GUIDE.md` (local-only), especially "Every sentence earns its place".

## Cheat sheet

| Write | For |
|---|---|
| `{@geocities}` | Anything in `content/entities.json`: a site, program, company, work, person or handle. The registry decides how it looks |
| `{@olia-lialina\|Lialina}` | Same entity, different visible text |
| `{@aim\|notip}` / `{@aim\|tip}` | Keep the entity's gloss off this mention / put it here |
| `{?Neonlove}` | "This should be an entity, deal with it later." Renders as plain text |
| `{y:2001}` / `{date:2001-06-07\|7 June 2001}` | A year / any other date (ISO value, then the visible text) |
| `{file:FB12.gif}` `{dir:/BAR}` `{page:TOOLS.html}` | File, folder and page names |
| `{usenet:news:alt.discuss.4-webtv}` | A Usenet address |
| `{tip:Explanation}term{/tip}` | A tooltip on a term that isn't an entity (`\|tag=span` for a non-bold one) |
| `{link:external\|URL}text{/link}` | A link. Other kinds: `archive-wayback`, `archive-index`, `archive-mirror`, `archive-service`, `historical-snapshot`. Options: `\|@slug`, `\|tip=…`, `\|preservation` |
| `{dead:page-offline\|href=URL\|tip=Offline: this site no longer exists}text{/dead}` | A page that's gone. States: `page-offline`, `host-closed`, `domain-repurposed`, `service-closed`. Options: `\|@slug`, `\|host=slug` |
| `{goto:HeadingId}text{/goto}` / `{open:historyModal}text{/open}` | A link to a heading here / a button that opens another modal |
| `[@lialina-2015-kuleshova]` `[@a][@b]` | A citation (numbered for you) |
| `[@todo: Stardrops home page capture]` | A citation you don't have yet. Renders nothing; listed by `--todo` |
| `{references}` inside `<ol id="…ReferencesList">` | The numbered references, in first-citation order |
| `{references:general}` inside `<ul … class="general-references-list">` | Sources whose `general` lists this page, alphabetically |
| `{toc:HistoryTOC}` | The contents list, on its own line |
| `{ui-tool:select}` `{ui-tool-icon:select}` `{ui-panel:textSettingsSection}` `{ui-shortcuts}` | Guide only: names, icons and shortcuts from the app's registries |

Everything else is plain HTML.

| Command | Does |
|---|---|
| `node tools/entities.js find "neonlove.net"` | Which slug is this? Matches names, aliases and domains |
| `node tools/entities.js tag history` | Shows untagged names (first mention per section); `--write` tags them |
| `node tools/cite.js add <url>` | Adds a draft source (title, nearest Wayback capture, key) and prints its `[@key]` |
| `node tools/cite.js find <text>` | Searches existing sources before you add one |
| `node tools/build-modals.js --watch` | Rebuilds on save (runs when the folder opens). Unknown slugs and sources warn instead of failing |
| `node tools/build-modals.js --todo` | Every `{?…}`, `[@todo]`, draft entity and draft source |
| `node tools/build-modals.js --check` | The commit gate: strict, 0 errors, outputs current |
| `node tools/voice-check.js history` | Optional: likely teasers, negation setups and kicker closers |

On localhost, `index.html#modal=history&at=HistoryMicasTile` opens a page at a heading, and an open page re-renders when the watcher rebuilds it.

Missing something? A name you can't find becomes `{?Name}` or a draft entity; a source you don't have becomes `[@todo: …]`. Keep writing.

## Rules

These keep people and AI agents from inventing structure.

1. **The token list is closed.** Only the tokens above exist. Never invent a token, option or kind.
2. **Never guess a slug.** Before writing `{@…}`, run `node tools/entities.js find "<text>"` and use the slug it returns.
3. **Not found: add a draft, don't improvise.** Add an entry with `kind`, `name` and `"status": "draft"`. Never write a `gloss`, `host`, `owner` or `person` you can't support from the text you're editing. The build lists drafts for Ryan to confirm.
4. **Never invent a source.** `[@key]` must exist in `content/sources.json` with a URL you actually have. If you don't have one, write `[@todo: what's needed]`.
5. **Kinds.** The name as written in the sentence decides handle vs person. How the reader met it decides site vs software (Magick Studio is a site, ImageMagick is software). Publications cited in references are orgs. When unsure, pick the closest kind, mark the entry `draft`, and say so in the handoff.
6. **Done means** `node tools/build-modals.js --check` passes with 0 errors, and new drafts and todos are listed in the handoff.

## content/entities.json

One map of slugs (lowercase words joined by hyphens) to entries:

| Field | Meaning |
|---|---|
| `kind` | `site` (a place on the web or a network service), `software`, `org` (company, publisher, institution), `work` (franchise, show, band), `person` (a real name), `handle` (an online identity) |
| `name` | The name in reading order (`Olia Lialina`) |
| `sortName` | Persons only: bibliography order (`Lialina, Olia`), used when the person is a source's author |
| `aliases` | Other spellings; `find`, `tag` and the lint match them |
| `host` | The site it lived on (a handle's home, a site's host). Its icon falls back to the host's |
| `owner` | For a site: the handle or person who ran it |
| `person` | For a handle: the real-name entity behind it |
| `domains` | Domains it owns; a link to one gets its icon, and a dead source on one gets its `closed` state |
| `closed` | For a host that's gone: `host-closed`, `domain-repurposed`, … |
| `gloss` | A one-line definition, shown as a tooltip on the first mention per page |
| `icon` | Icon file name when it isn't the slug (`"icon": "wtv-zone"` for WebTV) |
| `accent` | A handle's text color (`#rrggbb`); the Glitter Connection cast have one each |
| `tags` | Finer categories. `"term"` marks an everyday word (GIF, Dollz) the tag sweep and lint leave alone |
| `status` | `"draft"` until Ryan confirms it |

How entities look is decided by kind, never by slug: sites get an icon on their first mention per section (`--icons=all` shows every one), works are italic, handles are tinted, and people, software and orgs are plain text. Handles and hosted sites also get a hover card (host, owner, real name).

**Icons:** drop `images/modal/history/platform-icons/<slug>.svg` (tinted to the text color) or `<slug>.color.svg` (drawn as is), rebuild, and recompile the SCSS. The build writes `css/generated/_entity-icons.scss`; no list to edit. `node tools/entities.js icons` lists the most-mentioned sites still drawn with the generic glyph.

## content/sources.json

Shared by every page, so a source is written once however many pages cite it.

| Field | Meaning |
|---|---|
| `author` / `publisher` | `"@slug"` for an entity (a person reads as their `sortName`) or plain text |
| `title`, `url` | The cited page. `title` may hold tokens |
| `status` | `live` (default), `dead` (the page is gone: the title renders as a dead link, its state from the host's `closed`), or `draft` |
| `archive` | `{ "url": …, "date": "2004-08-20" }` renders "Archived 20 August 2004". `label` overrides the text |
| `note` | Text after the citation. Tokens and `[@key]` allowed |
| `notes` | `{ "aylana": "…" }`: a page-specific note that replaces `note` there |
| `general` | Pages whose `{references:general}` list it |
| `link`, `dead` | Rare overrides: the link kind, or `{ state, host, tip }` for a dead link |
| `cite` | A hand-formatted citation, used as is. Only for citations the fields can't express |

Keys follow `author-year-word` (`lialina-2015-kuleshova`); `cite.js add` suggests one.

`content/sources.local.json` (git-excluded, like the pages that use it) holds sources for pages that aren't public yet. It is read together with `sources.json`; when the page goes public, move its entries into `sources.json` and delete the file.
