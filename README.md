# DustinsView

A static archive of [dustinsview.com](https://dustinsview.com/) built with [Eleventy (11ty)](https://www.11ty.dev/).

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+ recommended)
- npm
- Java runtime (only for `npm run validate`, which runs the bundled Nu HTML Checker)
- `xmllint` (preinstalled on macOS; `libxml2-utils` on Debian/Ubuntu) for `npm run validate`

### Installation

```bash
npm install
```

### Running the Site

- **Development server (with live reload):**

  ```bash
  npm start
  ```

  Starts the local server at [http://localhost:8080/](http://localhost:8080/).

- **Production build:**
  ```bash
  npm run build
  ```
  Compiles static output into the `_site/` directory.

### Draft Posts

To mark a post as a draft, add `draft: true` to its front matter in `content/posts/<slug>.md`:

```yaml
---
title: "My Draft Post"
date: "2026-10-13"
draft: true
---
```

- **Local development (`npm start`):** Draft posts are excluded by default.
- **Local development with drafts (`npm run start:drafts`):** Draft posts are included and rendered for local previewing.
- **Production build (`npm run build`):** Draft posts are excluded from output files and all collections (homepage, archives, category/tag listings, RSS feed, and sitemap).
- **Build with drafts enabled:** To force drafts into a static build, set `BUILD_DRAFTS=true` (e.g. `BUILD_DRAFTS=true npm run build`).

## Available Scripts

| Command                  | Description                                                         |
| ------------------------ | ------------------------------------------------------------------- |
| `npm start`              | Run Eleventy dev server with hot reload (`eleventy --serve`)        |
| `npm run start:drafts`   | Run Eleventy dev server with drafts enabled                         |
| `npm run build`          | Build static files to `_site/`                                      |
| `npm run import`         | Import and normalize posts/pages from WordPress raw snapshots       |
| `npm run download:media` | Download and archive remote media assets locally to `public/media/` |
| `npm run export:wxr`     | Export WordPress content via WXR                                    |
| `npm run redirects`      | Regenerate `public/_redirects` (historical WordPress URL mapping)   |
| `npm run audit`          | Run route and link validation                                       |
| `npm run validate`       | Nu HTML Checker on all pages, RSS feed and sitemap (XSD) checks     |

## Design

The stylesheet (`src/css/style.css`) recreates the original WordPress theme,
[Libre](https://wordpress.org/themes/libre/) by Automattic, together with the
site's own Additional CSS (`#99004d` links, 1.0875rem blockquotes). Libre
Baskerville is self-hosted from `public/fonts/` under the SIL Open Font License
(`public/fonts/OFL.txt`), so pages make no third-party font requests. Departures
from the original: a light/dark scheme, a faint resting underline on in-text
links (color alone fails WCAG 1.4.1), excerpts instead of full posts on index
pages, and a static sidebar (Latest, Categories, Archives) in place of the
dynamic tabbed/trending widgets.

## Project Structure

```text
dustinsview/
├── content/
│   ├── posts/         # Markdown & HTML post source files
│   └── pages/         # Static pages (About, etc.)
├── public/
│   ├── media/         # Archived local images and assets
│   └── static/        # Static assets
├── src/
│   ├── _data/         # Site metadata and taxonomy data
│   ├── _includes/     # Nunjucks layouts and partials
│   └── css/           # Site stylesheets
├── scripts/           # Migration, media download, and audit scripts
├── eleventy.config.js # Eleventy configuration
└── _site/             # Generated static site (ignored by git)
```
