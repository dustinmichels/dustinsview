#!/usr/bin/env node
/**
 * Generates public/_redirects (Netlify / Cloudflare Pages syntax) from the
 * offline WordPress snapshot and the historical route inventory.
 *
 * Inputs:
 *   inventory-routes.json                         crawled historical routes
 *   backup/wp-raw-snapshot/<date>/posts.json      post permalinks + IDs
 *   backup/wp-raw-snapshot/<date>/pages.json      page permalinks + IDs
 *   backup/wp-raw-snapshot/<date>/media.json      attachment pages + parents
 *
 * Usage: node scripts/generate-redirects.mjs
 */
import fs from "node:fs";
import path from "node:path";

const SNAPSHOT_ROOT = "backup/wp-raw-snapshot";
const OUTPUT = "public/_redirects";

const snapshotDir = path.join(
  SNAPSHOT_ROOT,
  fs
    .readdirSync(SNAPSHOT_ROOT)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .at(-1),
);
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const posts = readJson(path.join(snapshotDir, "posts.json"));
const pages = readJson(path.join(snapshotDir, "pages.json"));
const media = readJson(path.join(snapshotDir, "media.json"));
const inventory = readJson("inventory-routes.json").routes;

const pathOf = (url) => new URL(url).pathname;
const uploadsToMedia = (url) => "/media/" + pathOf(url).replace(/^\/wp-content\/uploads\//, "");

const postById = new Map(posts.map((p) => [p.id, pathOf(p.link)]));
const postBySlug = new Map(posts.map((p) => [p.slug, pathOf(p.link)]));
const mediaBySlug = new Map(media.map((m) => [m.slug, m]));

/** Parent post permalink for an attachment, or its local media file when unattached. */
function attachmentTarget(item) {
  return postById.get(item.post) ?? uploadsToMedia(item.source_url);
}

const sections = [];
const seen = new Set();
function section(title, rules) {
  const lines = [];
  for (const [from, to, status] of rules) {
    if (seen.has(from)) continue;
    seen.add(from);
    lines.push([from, to, String(status)]);
  }
  if (lines.length) sections.push({ title, lines });
}

// 1. Obsolete WordPress admin/API endpoints. 410 is not honored by Netlify or
//    Cloudflare Pages `_redirects`, so these are explicit 404s.
section("Obsolete WordPress admin and API endpoints (404)", [
  ["/wp-admin", "/404.html", 404],
  ["/wp-admin/*", "/404.html", 404],
  ["/wp-login.php", "/404.html", 404],
  ["/wp-json", "/404.html", 404],
  ["/wp-json/*", "/404.html", 404],
  ["/xmlrpc.php", "/404.html", 404],
  ["/wp-includes/*", "/404.html", 404],
  ["/wp-cron.php", "/404.html", 404],
]);

// 2. Uploads live at the same relative path under /media/.
section("Media uploads", [["/wp-content/uploads/*", "/media/:splat", 301]]);

// 3. Feeds.
section("Feeds", [
  ...[
    "/feed",
    "/feed/",
    "/feed/rss/",
    "/feed/rss2/",
    "/feed/atom/",
    "/rss",
    "/rss/",
    "/atom",
    "/atom/",
    "/comments/feed",
    "/comments/feed/",
  ].map((p) => [p, "/feed.xml", 301]),
  ["/category/:slug/feed/", "/feed.xml", 301],
  ["/tag/:slug/feed/", "/feed.xml", 301],
  ["/author/:slug/feed/", "/feed.xml", 301],
  ["/:year/:slug/feed/", "/feed.xml", 301],
]);

// 4. WordPress core sitemaps.
section("Sitemaps", [
  ...inventory.filter((r) => r.routeType === "sitemap").map((r) => [r.path, "/sitemap.xml", 301]),
  ["/wp-sitemap*", "/sitemap.xml", 301],
]);

// 5. Archive pagination: only the home index is paginated in the static site.
section("Archive pagination", [
  ["/page/1/", "/", 301],
  ["/category/:slug/page/*", "/category/:slug/", 301],
  ["/tag/:slug/page/*", "/tag/:slug/", 301],
  ["/author/admin/page/*", "/author/admin/", 301],
  ["/:year/page/*", "/:year/", 301],
]);

// 6. Author: single author, all other author slugs collapse to the archive.
section("Author", [["/author/*", "/author/admin/", 301]]);

// 7. Categories/tags with no published posts have no static archive page.
const usedTermIds = new Set(posts.flatMap((p) => [...p.categories, ...p.tags]));
section(
  "Empty category/tag archives -> topics",
  inventory
    .filter(
      (r) => (r.routeType === "category" || r.routeType === "tag") && !usedTermIds.has(r.termId),
    )
    .map((r) => [r.path, "/topics/", 301]),
);

// 8. Month archives -> year archives.
section(
  "Month archives -> year archives",
  inventory
    .filter((r) => r.routeType === "month_archive")
    .map((r) => [r.path, `/${r.path.split("/")[1]}/`, 301]),
);

// 9. Old permalink structure (/%category%/%postname%/) and attachment pages
//    beneath it. Post segment resolves by current slug, else via an attachment's parent.
const legacy = [];
for (const r of inventory.filter(
  (r) => r.routeType === "redirect" || r.routeType === "attachment",
)) {
  const [prefix, postSegment, ...rest] = r.path.split("/").filter(Boolean);
  if (/^\d{4}$/.test(prefix)) continue; // year-based attachment pages handled from media.json
  const attachment =
    rest[0] === "attachment"
      ? (mediaBySlug.get(decodeURIComponent(rest[1]).toLowerCase()) ?? mediaBySlug.get(rest[1]))
      : null;
  const postPath = postBySlug.get(postSegment) ?? (attachment && postById.get(attachment.post));
  if (!postPath) throw new Error(`Cannot resolve legacy route ${r.path}`);
  legacy.push([`/${prefix}/${postSegment}/`, postPath, 301]);
  if (rest[0] === "attachment") {
    legacy.push([r.path, attachment ? attachmentTarget(attachment) : postPath, 301]);
    legacy.push([`/${prefix}/${postSegment}/attachment/*`, postPath, 301]);
  }
}
section("Legacy category-prefixed permalinks", legacy);

// 10. Attachment pages from the media library.
section(
  "Attachment pages -> parent post or media file",
  media.map((m) => [pathOf(m.link), attachmentTarget(m), 301]).filter(([from, to]) => from !== to),
);

// 11. Query-string permalinks (Netlify only; Cloudflare Pages ignores query matching).
//     Forced (`!`): `/index.html` exists, so unforced rules on `/` would be shadowed.
const queryRules = [
  ...posts.map((p) => [`/ p=${p.id}`, pathOf(p.link), "301!"]),
  ...pages.map((p) => [`/ page_id=${p.id}`, pathOf(p.link), "301!"]),
  ...media.map((m) => [`/ attachment_id=${m.id}`, attachmentTarget(m), "301!"]),
];
section("Query-string permalinks (?p=, ?page_id=, ?attachment_id=)", queryRules);

const body = sections
  .map((s) => `# ${s.title}\n` + s.lines.map((line) => line.join("  ")).join("\n"))
  .join("\n\n");

const header = `# Generated by scripts/generate-redirects.mjs — do not edit by hand.
# Netlify / Cloudflare Pages _redirects. Rules are not forced: existing files win.
`;
fs.writeFileSync(OUTPUT, `${header}\n${body}\n`);
console.log(`Wrote ${seen.size} rules to ${OUTPUT}`);
