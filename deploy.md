# Deploy TODO

## Phase 10: Preview Deployment & Cutover

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

## Phase 11: WordPress Decommissioning & Archival Handoff

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
