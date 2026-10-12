# Static Blog Archive Plan & Migration Checklist

## Overview

Build a **self-contained Eleventy static site** whose source content and media are committed to this repository. Preserve existing public URLs, replace WordPress-generated chrome with a simple archival design, and ensure the finished site works without WordPress, a database, or third-party JavaScript.

### Content Scope

| Content type | Current count | Source / Method                                    |
| ------------ | ------------: | -------------------------------------------------- |
| Posts        |            46 | WordPress REST API (`/wp-json/wp/v2/posts`)        |
| Pages        |             2 | WordPress REST API (`/wp-json/wp/v2/pages`)        |
| Media items  |           162 | Media API (`/wp-json/wp/v2/media`) & post scrapers |
| Categories   |             8 | REST API (`/wp-json/wp/v2/categories`)             |
| Tags         |           205 | REST API (`/wp-json/wp/v2/tags`)                   |

---

## Target Project Architecture

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
│   ├── _data/                 # Site metadata, taxonomies, media manifest
│   ├── _includes/
│   │   ├── layouts/           # Base, post, page, archive templates
│   │   └── partials/          # Header, footer, nav, post-card
│   └── css/                   # Lightweight, typography-focused styles
├── scripts/
│   ├── import-wordpress.mjs   # REST API importer and normalizer
│   ├── download-media.mjs     # Asset download & path rewrite script
│   └── audit-links.mjs        # Static route and link validator
├── _site/                     # Generated output (git-ignored)
├── eleventy.config.js
└── package.json
```

---

## Migration Checklist

### Phase 1: Source Snapshot & Inventory

- [ ] **1.1 REST API Extraction**
  - [ ] Fetch all published posts via `/wp-json/wp/v2/posts?per_page=100&status=publish`.
  - [ ] Fetch all published pages via `/wp-json/wp/v2/pages?per_page=100&status=publish`.
  - [ ] Fetch all media object metadata via `/wp-json/wp/v2/media?per_page=100`.
  - [ ] Fetch all categories via `/wp-json/wp/v2/categories?per_page=100`.
  - [ ] Fetch all tags via `/wp-json/wp/v2/tags?per_page=100`.
  - [ ] Fetch author profiles via `/wp-json/wp/v2/users`.
  - [ ] Save raw JSON responses into a dated directory (`backup/wp-raw-snapshot/`).

- [ ] **1.2 Database & XML Disaster-Recovery Backup**
  - [ ] Generate and download full WordPress XML export (WXR) via WP Admin (`Tools > Export`).
  - [ ] Download complete WordPress SQL database dump if host/phpMyAdmin access is available.
  - [ ] Download raw `/wp-content/uploads/` directory backup if SFTP/SSH access is available.
  - [ ] Store backup archives in secure, versioned offline storage.

- [ ] **1.3 Historical Route Discovery & Inventory**
  - [ ] Download and parse `https://dustinsview.com/wp-sitemap.xml`.
  - [ ] Crawl live site to discover internal links and historical query URLs.
  - [ ] Catalog all paginated archive routes (`/page/2/`, etc.).
  - [ ] Catalog all category routes (`/category/:slug/`) and tag routes (`/tag/:slug/`).
  - [ ] Catalog author route (`/author/admin/`).
  - [ ] Catalog historical feed endpoints (`/feed/`, `/rss/`, `/atom/`).
  - [ ] Compile master route inventory spreadsheet/manifest (`inventory-routes.json`).

---

### Phase 2: Project Scaffolding & Eleventy Setup

- [ ] **2.1 Repository & Node Environment**
  - [ ] Initialize `package.json` (`npm init -y`).
  - [ ] Set `"type": "module"` in `package.json`.
  - [ ] Install Eleventy (`@11ty/eleventy`).
  - [ ] Install development dependencies (e.g. `luxon` for dates, `html-minifier-terser` if needed).
  - [ ] Add `.gitignore` covering `node_modules/`, `_site/`, `.cache/`, and local temporary files.

- [ ] **2.2 Directory Structure Creation**
  - [ ] Create `content/posts/` and `content/pages/`.
  - [ ] Create `public/media/` and `public/static/`.
  - [ ] Create `src/_data/`, `src/_includes/layouts/`, and `src/_includes/partials/`.
  - [ ] Create `src/css/`.
  - [ ] Create `scripts/`.

- [ ] **2.3 Eleventy Configuration**
  - [ ] Create `eleventy.config.js`.
  - [ ] Configure input directory (`.`) and output directory (`_site`).
  - [ ] Configure passthrough copy for `public/` into output root.
  - [ ] Configure passthrough copy for `src/css/` to `css/`.
  - [ ] Set up date formatting filters (e.g., `readableDate`, `isoDate`).
  - [ ] Add npm scripts to `package.json`:
    - [ ] `npm run build`: Production build.
    - [ ] `npm start`: Local development server with live reload.
    - [ ] `npm run import`: Run WordPress import script.
    - [ ] `npm run audit`: Run link and route audit script.

---

### Phase 3: Content Importer & Normalization

- [ ] **3.1 Build Repeatable Importer Script (`scripts/import-wordpress.mjs`)**
  - [ ] Read offline snapshot JSON files (or query live API with offline cache).
  - [ ] Map WP category and tag IDs back to readable names and slugs.
  - [ ] Extract featured media URLs and alt text.
  - [ ] Handle author attribution mapping.

- [ ] **3.2 Front Matter Generation**
  - [ ] Generate clean YAML front matter for every post:
    - [ ] `title`: String with unescaped HTML entities.
    - [ ] `date`: ISO publication timestamp (`YYYY-MM-DD`).
    - [ ] `updated`: ISO modified timestamp (if different from publish date).
    - [ ] `permalink`: Exact historical canonical path (e.g. `/:year/:slug/`).
    - [ ] `categories`: List of category slugs/names.
    - [ ] `tags`: List of tag slugs/names.
    - [ ] `excerpt`: Plain-text excerpt.
    - [ ] `wordpressId`: Original numeric WP ID for auditing.
    - [ ] `layout`: `layouts/post.njk`.
  - [ ] Generate front matter for standalone pages (`About`, `Topics`).

- [ ] **3.3 Body Content Cleaning & Semantic HTML Preservation**
  - [ ] Preserve semantic rendered HTML to avoid lossy Markdown conversion issues.
  - [ ] Normalize heading levels (`h1` -> `h2` if title is `h1`).
  - [ ] Clean up redundant WordPress inline styles and unused utility classes.
  - [ ] Preserve syntax highlighting / code blocks.
  - [ ] Preserve blockquotes, poems, and intentional whitespace/line breaks.
  - [ ] Preserve footnotes and in-page anchor links.
  - [ ] Write processed files to `content/posts/:slug.md` (or `.html`).
  - [ ] Write processed pages to `content/pages/:slug.md`.
  - [ ] Confirm total file count matches source (46 posts, 2 pages).

---

### Phase 4: Media Localization & Asset Pipeline

- [ ] **4.1 Media Download Script (`scripts/download-media.mjs`)**
  - [ ] Extract all URLs matching `dustinsview.com/wp-content/uploads/**` across all posts.
  - [ ] Query WordPress media library API for all 162 media attachments.
  - [ ] Download all original image files (PNG, JPG, WebP) into `public/media/`.
  - [ ] Download animated GIFs in original form without recompression.
  - [ ] Download all PDFs and document attachments into `public/media/`.
  - [ ] Download any audio or podcast files into `public/media/`.
  - [ ] Download historical favicon and logo assets.

- [ ] **4.2 Media Manifest Creation**
  - [ ] Generate `src/_data/mediaManifest.json` during download.
  - [ ] Record source URL, local file path, MIME type, file size, and SHA-256 hash.
  - [ ] Detect any 404 or missing media files on live WordPress site.

- [ ] **4.3 Content Path Rewriting**
  - [ ] Replace `https://dustinsview.com/wp-content/uploads/...` with `/media/...` in post bodies.
  - [ ] Replace `http://dustinsview.com/wp-content/uploads/...` (insecure) with `/media/...`.
  - [ ] Strip WordPress responsive image `srcset` attributes pointing to external WP URLs (or regenerate locally).
  - [ ] Filter out plugin tracking pixels (e.g., `cookies-for-comments/css.php`).

---

### Phase 5: External Embeds & Third-Party Cleanup

- [ ] **5.1 YouTube Embed Modernization**
  - [ ] Identify all embedded YouTube videos across posts.
  - [ ] Convert `youtube.com/watch` or `iframe` embeds to privacy-enhanced `www.youtube-nocookie.com/embed/...`.
  - [ ] Add `<noscript>` or visible fallback hyperlink below each video embed.
  - [ ] Ensure iframes use `loading="lazy"` and responsive aspect-ratio containers.

- [ ] **5.2 Maps & Other Third-Party Embeds**
  - [ ] Audit for Google Maps or legacy interactive map embeds.
  - [ ] Capture static screenshot fallbacks for broken/obsolete map widgets.
  - [ ] Replace embeds with static map image linking out to OpenStreetMap/Google Maps.

- [ ] **5.3 External Link & Embed Audit**
  - [ ] Check for external audio embeds (SoundCloud, Spotify, etc.) and add fallback links.
  - [ ] Audit all external outbound links for dead targets.
  - [ ] Visibly mark dead external resources instead of silently breaking layout.
  - [ ] Remove all tracking scripts, analytics, cookie consent popups, and comment scripts.

---

### Phase 6: Eleventy Templates & Archive UI

- [ ] **6.1 Base Layout & Styling**
  - [ ] Create `src/_includes/layouts/base.njk` with semantic HTML5 structure.
  - [ ] Implement responsive, typography-first CSS in `src/css/style.css`.
  - [ ] Ensure readable layout works completely with zero JavaScript.
  - [ ] Support system dark/light color schemes via CSS media queries.
  - [ ] Add header partial with site title and navigation.
  - [ ] Add footer partial with archive notice, copyright, and RSS feed link.

- [ ] **6.2 Post & Page Layouts**
  - [ ] Create `src/_includes/layouts/post.njk`:
    - [ ] Article title (`<h1>`).
    - [ ] Formatted publication date (`<time>`).
    - [ ] Updated date display (when materially different from publication date).
    - [ ] Rendered body content.
    - [ ] Category and tag badges/links.
    - [ ] Previous and next post navigation links.
    - [ ] Canonical URL tag (`<link rel="canonical">`).
    - [ ] Open Graph and Twitter Card metadata.
  - [ ] Create `src/_includes/layouts/page.njk` for About and Topics pages.

- [ ] **6.3 Index & Archive Collections**
  - [ ] Build Home page (`index.njk`):
    - [ ] Reverse-chronological post list.
    - [ ] Post excerpts, dates, and permalinks.
    - [ ] Pagination controls (if splitting posts across pages).
  - [ ] Build Year Archive pages (`src/archives/`):
    - [ ] Group posts by publication year (`2018`, `2017`, etc.).
  - [ ] Build Category Archive pages (`src/category/`):
    - [ ] Eleventy pagination over `collections.categoryList`.
  - [ ] Build Tag Archive pages (`src/tag/`):
    - [ ] Eleventy pagination over `collections.tagList` (filtering out tags with 0 posts).
  - [ ] Build Topics overview page listing all categories and top tags.

- [ ] **6.4 Feeds & SEO Templates**
  - [ ] Create RSS/Atom feed template (`feed.xml`).
  - [ ] Create XML sitemap template (`sitemap.xml`) including all posts and pages.
  - [ ] Create `public/robots.txt` allowing indexing of static pages.
  - [ ] Create custom `404.html` layout.

---

### Phase 7: URL Preservation & Route Mapping

- [ ] **7.1 Canonical Route Verification**
  - [ ] Confirm post permalinks match original pattern (e.g. `/:year/:slug/index.html`).
  - [ ] Confirm page permalinks match original pattern (e.g. `/about/`, `/topics/`).
  - [ ] Map `/author/admin/` either to About page or static author archive.

- [ ] **7.2 Redirect Configuration**
  - [ ] Generate host redirect file (`_redirects` for Netlify/Cloudflare Pages).
  - [ ] Add permanent redirect for `/wp-content/uploads/*` -> `/media/:splat` (if paths differ).
  - [ ] Add permanent redirect for historical attachment pages -> parent post or media file.
  - [ ] Add redirect for old feed endpoints (`/feed/`, `/rss/`) -> `/feed.xml`.
  - [ ] Add explicit 410 Gone / 404 rules for obsolete admin/API routes:
    - [ ] `/wp-admin/*`
    - [ ] `/wp-login.php`
    - [ ] `/wp-json/*`
    - [ ] `/xmlrpc.php`

---

### Phase 8: Comments Strategy

- [ ] **8.1 Decision & Strategy**
  - [ ] Confirm decision: Remove live Disqus widget and dynamic comment forms.
  - [ ] Evaluate need to preserve historical comment text.

- [ ] **8.2 Execution**
  - [ ] _Option A (Default - Full Removal)_:
    - [ ] Remove all Disqus script tags and container divs.
    - [ ] Remove all WordPress comment submission HTML and styles.
  - [ ] _Option B (If Preserving Historical Comments)_:
    - [ ] Export Disqus/WP comments via XML/JSON export.
    - [ ] Parse comments by post ID.
    - [ ] Render comments statically below article body (author name, timestamp, comment text).
    - [ ] Disable all reply/post functionality.

---

### Phase 9: Quality Assurance & Route Auditing

- [ ] **9.1 Automated Audit Script (`scripts/audit-links.mjs`)**
  - [ ] Build static site (`npm run build`).
  - [ ] Verify generated file count: exactly 46 post HTML files + 2 page HTML files.
  - [ ] Compare `_site/` generated routes against `inventory-routes.json` master list.
  - [ ] Check every internal hyperlink: 0 broken internal links (0 404s).
  - [ ] Check every local media reference (`/media/...`): 0 missing assets.
  - [ ] Scan output HTML for accidental references to `dustinsview.com/wp-` or live PHP endpoints.
  - [ ] Scan output HTML for insecure `http://` internal assets (mixed-content check).

- [ ] **9.2 Content Fidelity & Spot Checks**
  - [ ] Spot-check posts containing image galleries.
  - [ ] Spot-check posts with footnotes and cross-references.
  - [ ] Spot-check poetry/lyric posts for correct stanza line-breaks and formatting.
  - [ ] Spot-check YouTube video and audio embeds.
  - [ ] Spot-check downloadable PDF links.
  - [ ] Spot-check longest post for typography and readability.

- [ ] **9.3 Validation & Performance Checks**
  - [ ] Validate HTML syntax across key layouts (Nu HTML Checker / W3C validator).
  - [ ] Validate RSS/Atom feed XML syntax.
  - [ ] Validate `sitemap.xml` structure and canonical URLs.
  - [ ] Test complete site functionality with JavaScript disabled in browser.
  - [ ] Run Lighthouse accessibility and performance audits.

---

### Phase 10: Preview Deployment & Cutover

- [ ] **10.1 Preview Environment Setup**
  - [ ] Choose static host (Netlify, Cloudflare Pages, or GitHub Pages).
  - [ ] Connect repository to hosting provider.
  - [ ] Configure build settings (`npm run build`, publish directory: `_site`).
  - [ ] Deploy preview build to staging URL (e.g. `preview.dustinsview.pages.dev`).
  - [ ] Crawl preview site to verify all routes, media, and redirects function in production environment.

- [ ] **10.2 DNS & Cutover Preparation**
  - [ ] Lower DNS TTL on domain registrar/nameserver to 300 seconds (5 minutes) ahead of cutover.
  - [ ] Verify SSL/TLS certificate provisioning on new static hosting provider.
  - [ ] Configure apex (`dustinsview.com`) and `www` redirect rules.

- [ ] **10.3 Domain Cutover**
  - [ ] Update DNS records (A / CNAME) to point to static hosting provider.
  - [ ] Wait for DNS propagation.
  - [ ] Verify HTTPS resolves correctly on both `dustinsview.com` and `www.dustinsview.com`.
  - [ ] Run automated route crawl on live production domain.
  - [ ] Verify feeds, sitemaps, and top historical posts resolve with HTTP 200.

---

### Phase 11: WordPress Decommissioning & Archival Handoff

- [ ] **11.1 Decommissioning**
  - [ ] Monitor web server access and 404 error logs for 7-14 days.
  - [ ] Retain final cold backup of WordPress database, WXR XML export, and media directory.
  - [ ] Terminate old WordPress hosting server, PHP runtime, and MySQL database.

- [ ] **11.2 Repository Handoff & Documentation**
  - [ ] Update `README.md` with:
    - [ ] Prerequisites (Node version, package manager).
    - [ ] Installation instructions (`npm install`).
    - [ ] Local preview command (`npm start`).
    - [ ] Production build command (`npm run build`).
    - [ ] How to add or edit an archived post.
  - [ ] Confirm clean checkout builds without errors on a fresh machine.

---

## Definition of Done

- [ ] All 46 posts and 2 pages exist in `content/` and generate valid HTML.
- [ ] All 162 first-party media items are hosted locally under version control or build artifact.
- [ ] 100% of historical post and page canonical URLs resolve without broken links.
- [ ] All articles and pages are fully readable with JavaScript disabled.
- [ ] Site runs without any dependency on WordPress, PHP, MySQL, Disqus, or external APIs.
- [ ] Automated audit script confirms zero internal 404s and zero mixed-content warnings.
- [ ] A clean git clone can build and preview the entire site with one documented command.
