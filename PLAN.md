# Static Blog Archive Plan & Migration Checklist

Build a **self-contained Eleventy static site** whose source content and media are committed to this repository. Preserve existing public URLs, replace WordPress-generated chrome with a simple archival design, and ensure the finished site works without WordPress, a database, or third-party JavaScript.

> **Scope Note**: Interactive widgets (e.g. CartoDB/Leaflet maps, interactive visualization embeds) do not need to be retained or recreated. Archival focus is strictly on the posts, static text, images, and audio/video media.

| Content type | Current count | Source / Method                                                |
| ------------ | ------------: | -------------------------------------------------------------- |
| Posts        |            46 | WordPress REST API (`/wp-json/wp/v2/posts`)                    |
| Pages        |             2 | WordPress REST API (`/wp-json/wp/v2/pages`)                    |
| Media items  |           162 | Media API (`/wp-json/wp/v2/media`) & post scrapers             |
| Categories   |             8 | REST API (`/wp-json/wp/v2/categories`)                         |
| Tags         |           205 | REST API (`/wp-json/wp/v2/tags`)                               |
| Comments     |           238 | Disqus export (XML) / WordPress REST (238 approved, 332 total) |

---

```text
dustinsview/
├── content/
│   ├── posts/                 # One Markdown/HTML file per post
│   └── pages/                 # About and Topics pages
├── public/
│   ├── media/                 # Locally archived images, PDFs, audio
│   ├── favicon.*
│   └── robots.txt
├── src/
│   ├── _data/                 # Site metadata, taxonomies, media manifest, comments
│   ├── _includes/
│   │   ├── layouts/           # Base, post, page, archive templates
│   │   └── partials/          # Header, footer, nav, post-card, comments
│   └── css/                   # Lightweight, typography-focused styles
├── scripts/
│   ├── import-wordpress.mjs   # REST API importer and normalizer
│   ├── import-comments.mjs    # Disqus/WP comments parser & normalizer
│   ├── download-media.mjs     # Asset download & path rewrite script
│   └── audit-links.mjs        # Static route and link validator
├── _site/                     # Generated output (git-ignored)
├── eleventy.config.js
└── package.json
```

---

## Phase 1: Source Snapshot & Inventory

- [x] **1.1 REST API Extraction**
  - [x] Fetch all published posts via `/wp-json/wp/v2/posts?per_page=100&status=publish`.
  - [x] Fetch all published pages via `/wp-json/wp/v2/pages?per_page=100&status=publish`.
  - [x] Fetch all media object metadata via `/wp-json/wp/v2/media?per_page=100`.
  - [x] Fetch all categories via `/wp-json/wp/v2/categories?per_page=100`.
  - [x] Fetch all tags via `/wp-json/wp/v2/tags?per_page=100`.
  - [x] Fetch author profiles via `/wp-json/wp/v2/users`.
  - [x] Save raw JSON responses into a dated directory (`backup/wp-raw-snapshot/`).
  - [x] Fetch historical comments via WordPress REST API (`/wp-json/wp/v2/comments?per_page=100`) if available.
  - [x] Download raw Disqus XML export via Disqus Admin (`Disqus > Admin > Community > Export`) and save to `backup/wp-raw-snapshot/disqus-export.xml`.

- [x] **1.2 Database & XML Disaster-Recovery Backup**
  - [x] Generate and download full WordPress XML export (WXR) via WP Admin (`Tools > Export`). Saved to `backup/wxr/dustinsview.WordPress.2026-10-12.xml`.
  - [!] Download complete WordPress SQL database dump if host/phpMyAdmin access is available. - **Note:** Requires direct MySQL/phpMyAdmin host access (not accessible via WP Admin credentials alone).
  - [!] Download raw `/wp-content/uploads/` directory backup if SFTP/SSH access is available. - **Note:** Raw upload dir backup requires SFTP/SSH access; individual media assets are downloaded in Phase 4.
  - [x] Store backup archives in secure, versioned offline storage (`backup/wxr/` and `backup/wp-raw-snapshot/`).

- [x] **1.3 Historical Route Discovery & Inventory**
  - [x] Download and parse `https://dustinsview.com/wp-sitemap.xml`.
  - [x] Crawl live site to discover internal links and historical query URLs.
  - [x] Catalog all paginated archive routes (`/page/2/`, etc.).
  - [x] Catalog all category routes (`/category/:slug/`) and tag routes (`/tag/:slug/`).
  - [x] Catalog author route (`/author/admin/`).
  - [x] Catalog historical feed endpoints (`/feed/`, `/rss/`, `/atom/`).
  - [x] Compile master route inventory spreadsheet/manifest (`inventory-routes.json`).

---

## Phase 2: Project Scaffolding & Eleventy Setup

- [x] **2.1 Repository & Node Environment**
  - [x] Initialize `package.json` (`npm init -y`).
  - [x] Set `"type": "module"` in `package.json`.
  - [x] Install Eleventy (`@11ty/eleventy`).
  - [x] Install development dependencies (e.g. `luxon` for dates, `html-minifier-terser` if needed).
  - [x] Add `.gitignore` covering `node_modules/`, `_site/`, `.cache/`, and local temporary files.

- [x] **2.2 Directory Structure Creation**
  - [x] Create `content/posts/` and `content/pages/`.
  - [x] Create `public/media/` and `public/static/`.
  - [x] Create `src/_data/`, `src/_includes/layouts/`, and `src/_includes/partials/`.
  - [x] Create `src/css/`.
  - [x] Create `scripts/`.

- [x] **2.3 Eleventy Configuration**
  - [x] Create `eleventy.config.js`.
  - [x] Configure input directory (`.`) and output directory (`_site`).
  - [x] Configure passthrough copy for `public/` into output root.
  - [x] Configure passthrough copy for `src/css/` to `css/`.
  - [x] Set up date formatting filters (e.g., `readableDate`, `isoDate`).
  - [x] Add npm scripts to `package.json`:
    - [x] `npm run build`: Production build.
    - [x] `npm start`: Local development server with live reload.
    - [x] `npm run import`: Run WordPress import script.
    - [x] `npm run audit`: Run link and route audit script.

---

## Phase 3: Content Importer & Normalization

- [x] **3.1 Build Repeatable Importer Script (`scripts/import-wordpress.mjs`)**
  - [x] Read offline snapshot JSON files (or query live API with offline cache).
  - [x] Map WP category and tag IDs back to readable names and slugs.
  - [x] Extract featured media URLs and alt text.
  - [x] Handle author attribution mapping.

- [x] **3.2 Front Matter Generation**
  - [x] Generate clean YAML front matter for every post:
    - [x] `title`: String with unescaped HTML entities.
    - [x] `date`: ISO publication timestamp (`YYYY-MM-DD`).
    - [x] `updated`: ISO modified timestamp (if different from publish date).
    - [x] `permalink`: Exact historical canonical path (e.g. `/:year/:slug/`).
    - [x] `categories`: List of category slugs/names.
    - [x] `tags`: List of tag slugs/names.
    - [x] `excerpt`: Plain-text excerpt.
    - [x] `wordpressId`: Original numeric WP ID for auditing.
    - [x] `layout`: `layouts/post.njk`.
  - [x] Generate front matter for standalone pages (`About`, `Topics`).

- [x] **3.3 Body Content Cleaning & Semantic HTML Preservation**
  - [x] Preserve semantic rendered HTML to avoid lossy Markdown conversion issues.
  - [x] Normalize heading levels (`h1` -> `h2` if title is `h1`).
  - [x] Clean up redundant WordPress inline styles and unused utility classes.
  - [x] Preserve syntax highlighting / code blocks.
  - [x] Preserve blockquotes, poems, and intentional whitespace/line breaks.
  - [x] Preserve footnotes and in-page anchor links.
  - [x] Write processed files to `content/posts/:slug.md` (or `.html`).
  - [x] Write processed pages to `content/pages/:slug.md`.
  - [x] Confirm total file count matches source (46 posts, 2 pages).

---

## Phase 4: Media Localization & Asset Pipeline

- [x] **4.1 Media Download Script (`scripts/download-media.mjs`)**
  - [x] Extract all URLs matching `dustinsview.com/wp-content/uploads/**` across all posts.
  - [x] Query WordPress media library API for all 162 media attachments.
  - [x] Download all original image files (PNG, JPG, WebP) into `public/media/`.
  - [x] Download animated GIFs in original form without recompression.
  - [x] Download all PDFs and document attachments into `public/media/`.
  - [x] Download any audio or podcast files into `public/media/`.
  - [x] Download historical favicon and logo assets.

- [x] **4.2 Media Manifest Creation**
  - [x] Generate `src/_data/mediaManifest.json` during download.
  - [x] Record source URL, local file path, MIME type, file size, and SHA-256 hash.
  - [x] Detect any 404 or missing media files on live WordPress site.

- [x] **4.3 Content Path Rewriting**
  - [x] Replace `https://dustinsview.com/wp-content/uploads/...` with `/media/...` in post bodies.
  - [x] Replace `http://dustinsview.com/wp-content/uploads/...` (insecure) with `/media/...`.
  - [x] Strip WordPress responsive image `srcset` attributes pointing to external WP URLs (or regenerate locally).
  - [x] Filter out plugin tracking pixels (e.g., `cookies-for-comments/css.php`).

---

## Phase 5: External Embeds & Third-Party Cleanup

- [x] **5.1 YouTube Embed Modernization**
  - [x] Identify all embedded YouTube videos across posts.
  - [x] Convert `youtube.com/watch` or `iframe` embeds to privacy-enhanced `www.youtube-nocookie.com/embed/...`.
  - [x] Add `<noscript>` or visible fallback hyperlink below each video embed.
  - [x] Ensure iframes use `loading="lazy"` and responsive aspect-ratio containers.

- [x] **5.2 Maps & Legacy Interactive Widgets**
  - [x] Strip out obsolete interactive widget scripts and broken iframe map embeds (e.g. CartoDB/Leaflet).
  - [x] Retain static context (e.g. existing static screenshot figures or simple external links where helpful); do not re-engineer interactive widgets.

- [x] **5.3 External Link & Embed Audit**
  - [x] Check for external audio embeds (SoundCloud, Spotify, etc.) and add fallback links.
  - [x] Audit all external outbound links for dead targets.
  - [x] Visibly mark dead external resources instead of silently breaking layout.
  - [x] Remove all tracking scripts, analytics, cookie consent popups, and comment scripts.

---

## Phase 6: Eleventy Templates & Archive UI

- [x] **6.1 Base Layout & Styling** - Restyled after the original WordPress theme, Libre by Automattic, plus the site's Additional CSS: Libre Baskerville self-hosted in `public/fonts/` (SIL OFL), `#404040` text, `#99004d`/`#e60074` links, Libre's breakpoints and widths, title/meta column beside the excerpt on index pages, content + sidebar on posts and pages, italic meta lines with short rules, large-quote-mark blockquotes, bordered previous/next navigation. Topics dropdown from the original menu, CSS-only.
  - [x] Create `src/_includes/layouts/base.njk` with semantic HTML5 structure.
  - [x] Implement responsive, typography-first CSS in `src/css/style.css`.
  - [x] Ensure readable layout works completely with zero JavaScript.
  - [x] Support system dark/light color schemes via CSS media queries.
  - [x] Add header partial with site title and navigation.
  - [x] Add footer partial with archive notice, copyright, and RSS feed link.
  - [x] Add static sidebar partial (`partials/sidebar.njk`: Latest, Categories, Archives) replacing the dynamic tabbed/trending widgets.

- [x] **6.2 Post & Page Layouts**
  - [x] Create `src/_includes/layouts/post.njk`:
    - [x] Article title (`<h1>`).
    - [x] Formatted publication date (`<time>`).
    - [x] Updated date display (when materially different from publication date).
    - [x] Rendered body content.
    - [x] Category and tag badges/links.
    - [x] Previous and next post navigation links.
    - [x] Canonical URL tag (`<link rel="canonical">`).
    - [x] Open Graph and Twitter Card metadata.
    - [x] Static comments list partial (`partials/comments.njk`) with closed comment notice.
  - [x] Create `src/_includes/layouts/page.njk` for About and Topics pages.

- [x] **6.3 Index & Archive Collections**
  - [x] Build Home page (`index.njk`):
    - [x] Reverse-chronological post list.
    - [x] Post excerpts, dates, and permalinks.
    - [x] Pagination controls (if splitting posts across pages).
  - [x] Build Year Archive pages (`src/archives/`):
    - [x] Group posts by publication year (`2018`, `2017`, etc.).
  - [x] Build Category Archive pages (`src/category/`):
    - [x] Eleventy pagination over `collections.categoryList`.
  - [x] Build Tag Archive pages (`src/tag/`):
    - [x] Eleventy pagination over `collections.tagList` (filtering out tags with 0 posts).
  - [x] Build Topics overview page listing all categories and top tags.

- [x] **6.4 Feeds & SEO Templates**
  - [x] Create RSS/Atom feed template (`feed.xml`).
  - [x] Create XML sitemap template (`sitemap.xml`) including all posts and pages.
  - [x] Create `public/robots.txt` allowing indexing of static pages.
  - [x] Create custom `404.html` layout.

---

## Phase 7: URL Preservation & Route Mapping

- [x] **7.1 Canonical Route Verification**
  - [x] Confirm post permalinks match original pattern (e.g. `/:year/:slug/index.html`).
  - [x] Confirm page permalinks match original pattern (e.g. `/about/`, `/topics/`).
  - [x] Map `/author/admin/` either to About page or static author archive.

- [x] **7.2 Redirect Configuration**
  - [x] Generate host redirect file (`_redirects` for Netlify/Cloudflare Pages). - Generated by `npm run redirects` (`scripts/generate-redirects.mjs`); all 615 inventory routes resolve to a 200 or a 301 to an existing file.
  - [x] Add permanent redirect for `/wp-content/uploads/*` -> `/media/:splat` (if paths differ).
  - [x] Add permanent redirect for historical attachment pages -> parent post or media file.
  - [x] Add redirect for old feed endpoints (`/feed/`, `/rss/`) -> `/feed.xml`.
  - [x] Add explicit 410 Gone / 404 rules for obsolete admin/API routes: - 404 used; Netlify and Cloudflare Pages `_redirects` do not honor 410.
    - [x] `/wp-admin/*`
    - [x] `/wp-login.php`
    - [x] `/wp-json/*`
    - [x] `/xmlrpc.php`

---

## Phase 8: Comments Strategy (Option B - Static Archival with Closed Comments)

- [x] **8.1 Strategy Confirmation**
  - [x] Adopt Option B: Preserve historical comments as a static archive.
  - [x] Remove live Disqus script widget, tracking tags, and iframe containers.
  - [x] Remove all interactive comment submission forms and dynamic reply mechanisms.
  - [x] Close comments across all posts.

- [x] **8.2 Comment Data Extraction & Processing (`scripts/import-comments.mjs`)** - Run via `npm run import:comments`. Merges WordPress REST (239 approved) with the Disqus export (238 visible): 231 matched (Disqus body/timestamp used; WP copies lost emoji), 7 Disqus-only added, 2 excluded as deleted in Disqus → 244 comments on 20 posts.
  - [x] Parse Disqus XML export and/or WordPress comments data.
  - [x] Extract author name, profile/avatar URL (if static), ISO timestamp, and body text. - Gravatar URL stored as `avatar_url` but not rendered (avoids external requests).
  - [x] Reconstruct comment hierarchy / threading (parent/child relations). - Up to 21 levels deep; 1 reply to a comment missing from both sources is promoted to top level with `parentMissing: true`.
  - [x] Sanitize HTML comment bodies (strip scripts, tracking pixels, unsafe embeds). - Allowlist sanitizer; links limited to http(s)/mailto with `rel="nofollow ugc noopener"`.
  - [x] Map comment threads to posts by canonical URL, post slug, or WP ID.
  - [x] Output structured comment data into `src/_data/comments.json`. - Keyed by post slug: `{ wordpressId, count, comments: [tree] }`.

- [x] **8.3 Static Comment Templates & UI Integration**
  - [x] Build static comment partial (`src/_includes/partials/comments.njk`). - Recursive macro; replies nest 3 levels, deeper replies render flat with an "In reply to <name>" link. Old `#comment-<wpId>` anchors preserved.
  - [x] Render chronological comment threads under posts that have comments. - 244 comments across 20 posts rendered (212 on the Beyond Vegetarian interview).
  - [x] Include clear archival status note: "Comments on this post are closed."
  - [x] Handle empty states gracefully for posts with 0 comments. - 26 posts show "No comments were posted on this article."
  - [x] Verify zero third-party JavaScript or external network calls on post pages. - 0 `<script>` tags across 46 post pages; headless load of the largest thread requested only the local host. Only remaining third-party resources are the 6 intentional YouTube nocookie iframes from Phase 5.

---

## Phase 9: Quality Assurance & Route Auditing

- [x] **9.1 Automated Audit Script (`scripts/audit-links.mjs`)** - Run via `npm run audit` (`--no-build` to reuse `_site/`); exits non-zero on any issue. Last run: all checks 0 issues.
  - [x] Build static site (`npm run build`). - Script cleans `_site/` and rebuilds with Eleventy before auditing.
  - [x] Verify generated file count: exactly 46 post HTML files + 2 page HTML files. - Each `content/` permalink must exist; 46 `/YYYY/slug/index.html` outputs.
  - [x] Compare `_site/` generated routes against `inventory-routes.json` master list. - Resolves all 615 routes against `_site/` + `_redirects` with Netlify semantics (199 served, 412 redirected, 4 admin 404s). Found query-string rules (`/?p=`, `?page_id=`, `?attachment_id=`) were shadowed by `/index.html`; `generate-redirects.mjs` now emits them forced (`301!`).
  - [x] Check every internal hyperlink: 0 broken internal links (0 404s). - 6,210 internal refs + 615 `#fragment` links checked. Fixed in importer: footnote markers renumbered to match the bottom list (3 posts), 19 absolute `http://dustinsview.com/...` legacy/attachment links rewritten to canonical post paths or local media files.
  - [x] Check every local media reference (`/media/...`): 0 missing assets. - 173 refs (href/src/srcset/og:image).
  - [x] Scan output HTML for accidental references to `dustinsview.com/wp-` or live PHP endpoints.
  - [x] Scan output HTML for insecure `http://` internal assets (mixed-content check). - Flags `http://` subresources (img/iframe/source/stylesheet/CSS `url()`) and any `http://dustinsview.com` link.

- [x] **9.2 Content Fidelity & Spot Checks**
  - [x] Spot-check posts containing image galleries. - Only gallery: community-kitchen post (4 images, 2-column grid, 1 column at 375px). Also checked the 5 other posts with 3+ images: 0 broken images, 0 overflow at desktop or mobile.
  - [x] Spot-check posts with footnotes and cross-references. - 4 footnoted posts: markers match list numbering, 0 missing targets. Fixed: Easy Footnotes "back to text" anchors were empty (icon font lost); importer now emits a visible `↩` with `aria-label`. Marker → note → back round-trip verified in browser.
  - [x] Spot-check poetry/lyric posts for correct stanza line-breaks and formatting. - `<br>` and `<p>` counts match the raw WordPress `content.rendered` for all 46 posts; visually checked "Ode to HD 40307g" (verse/chorus stanzas and italic section labels intact).
  - [x] Spot-check YouTube video and audio embeds. - All 6 source embeds render as 16:9 `youtube-nocookie` iframes with a visible "Watch on YouTube" link (343px wide, no overflow at 375px). `Zza3GqEL5B0` (Dr. Pepper post) is deleted on YouTube (oEmbed 404) → importer now replaces it with a visible "[Video no longer available …]" notice, leaving 5 iframes. Removed the `<noscript>` duplicate of the visible link. 7 other YouTube references are plain links. No audio files or audio embeds exist in the source. "Ode to HD 40307g" mentions a video that is already absent from the WordPress source (WXR).
  - [x] Spot-check downloadable PDF links. - `/media/2016/08/From-London-With-Love.pdf` serves 200 `application/pdf`, SHA-256 matches `mediaManifest.json`. The meiosis-song chord sheet linked to `dustinmichels.com/lyrics/make_new_humans_chords.pdf` (now 404); recovered from Wayback capture `20220805205010` (SHA-1 matches CDX digest) into `public/media/lyrics/` and the importer rewrites the link. 3 third-party PDF links remain external: `wfp.org` OK, `rgs.org` 404, `apps.carleton.edu` now returns an HTML page (dead-link marking belongs to Phase 5.3).
  - [x] Spot-check longest post for typography and readability. - Longest is the Beyond Vegetarian interview (3,173 words + 212 comments): 18px Georgia, 1.75 line-height, ~70 characters per line, 11 `h3` questions, 9 blockquote answers, 5 images loaded. Fixed in `src/css/style.css`: `.wp-caption` came after `.alignleft/.alignright` and overrode their margins, so floated captioned images had 0 gap to the text (moved it above them; floats now have a 24px gutter). Long bare URLs in comments and footnotes overflowed at 375px (`overflow-wrap` added to `.post-content` and `.comment-body`). Now 0 horizontal overflow at 375px across all 46 posts, About, Topics, and home. Checked light and dark schemes. (Later superseded by the Libre restyle in 6.1: body is 16px Libre Baskerville, content class is `.entry-content`; both fixes carried over and overflow re-verified in 9.3.)

- [x] **9.3 Validation & Performance Checks** - Run via `npm run validate` (`scripts/validate.mjs`; `--no-build` to reuse `_site/`, `--strict` to fail on warnings); exits non-zero on any error. Last run: html, feed, sitemap all 0 errors / 0 warnings. Each check was confirmed to fail on an injected defect.
  - [x] Validate HTML syntax across key layouts (Nu HTML Checker / W3C validator). - All 201 generated HTML pages, via the `vnu-jar` dev dependency. Fixed: `deploy.md` was being rendered to `/deploy/` as a page with no doctype (now in Eleventy ignores); heading-level skips on Archives ("Jump to Year") and Topics (card headings `h3` → `h2`, importer updated too); redundant `banner`/`contentinfo` roles; comments used heading-less `<article>`s (now `<div>`).
  - [x] Validate RSS/Atom feed XML syntax. - Well-formed (xmllint), RSS 2.0 required elements, `atom:link rel="self"`, 46 items, RFC 822 `pubDate`s, permalink `guid`s, every link resolves. Cross-checked once with the W3C Feed Validator: valid.
  - [x] Validate `sitemap.xml` structure and canonical URLs. - Validates against the sitemaps.org 0.9 XSD (`scripts/schemas/sitemap-0.9.xsd`); no duplicates; all 46 posts + 2 pages present; every `<loc>` resolves to a generated page whose `<link rel="canonical">` equals it.
  - [x] Test complete site functionality with JavaScript disabled in browser. - Headless Chromium with JS off: home, page 2, longest post, About, Topics, Archives, category, tag, year, 404 all 200 with 0 `<script>`s, fonts load, 0 broken images. Topics dropdown opens via keyboard focus (`:focus-within`); skip link shows on focus. 0 horizontal overflow at 375px on all 200 `index.html` pages.
  - [x] Run Lighthouse accessibility and performance audits. - Lighthouse 12, mobile + desktop, on home, longest post, About, Archives, tag: accessibility 100, SEO 100 on all; performance 100 on all except the longest post on mobile (84 over uncompressed `http-server`; 96 with gzip, LCP 2.7 s; 334 KB of HTML from 212 comments). Fixed: first image in `<main>` is now eager with `fetchpriority="high"` (Eleventy transform; was lazy and the LCP element); About photo link had no accessible name (alt added via importer `ALT_OVERRIDES`); in-text links relied on color alone (faint resting underline). Remaining: About mobile best-practices 96 (`image-size-responsive`: the 225×300 thumbnail is shown at 1:1 on high-DPR screens, since Phase 4.3 stripped `srcset`). `bf-cache` failures come from the local server's `no-store` header.

---
