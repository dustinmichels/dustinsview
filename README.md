# DustinsView

A static archive of [dustinsview.com](https://dustinsview.com/) built with [Eleventy (11ty)](https://www.11ty.dev/).

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+ recommended)
- npm

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

## Available Scripts

| Command                  | Description                                                         |
| ------------------------ | ------------------------------------------------------------------- |
| `npm start`              | Run Eleventy dev server with hot reload (`eleventy --serve`)        |
| `npm run build`          | Build static files to `_site/`                                      |
| `npm run import`         | Import and normalize posts/pages from WordPress raw snapshots       |
| `npm run download:media` | Download and archive remote media assets locally to `public/media/` |
| `npm run export:wxr`     | Export WordPress content via WXR                                    |
| `npm run redirects`      | Regenerate `public/_redirects` (historical WordPress URL mapping)   |
| `npm run audit`          | Run route and link validation                                       |

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
