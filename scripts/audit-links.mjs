#!/usr/bin/env node
/**
 * Static route and link audit for the generated site.
 *
 * 1. Builds the site with Eleventy (skip with --no-build).
 * 2. Verifies exactly one output page per post/page source file.
 * 3. Resolves every route in inventory-routes.json against _site/ and
 *    public/_redirects (Netlify semantics: first match wins, existing files
 *    shadow non-forced rules).
 * 4. Checks every internal href/src/srcset (and #fragment) in the output HTML.
 * 5. Checks every /media/ reference points at an existing file.
 * 6. Flags leftover WordPress/PHP endpoint references.
 * 7. Flags insecure http:// subresources and http:// links to the site itself.
 *
 * Exits non-zero when any check fails.
 * Usage: node scripts/audit-links.mjs [--no-build]
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SITE = "_site";
const ORIGIN = "https://dustinsview.com";
const EXPECTED = { posts: 46, pages: 2 };

if (!process.argv.includes("--no-build")) {
  console.log("Building site (npm run build)...");
  fs.rmSync(SITE, { recursive: true, force: true });
  execSync("npx @11ty/eleventy --quiet", { stdio: "inherit" });
}

const failures = [];
const fail = (check, message) => failures.push({ check, message });

// ---------------------------------------------------------------- helpers

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

const outputFiles = walk(SITE);
const fileSet = new Set(outputFiles.map((f) => "/" + path.relative(SITE, f).split(path.sep).join("/")));

/** Output file served for a URL path, or null. Mirrors static-host lookup. */
function fileFor(urlPath) {
  if (fileSet.has(urlPath)) return urlPath;
  const dir = urlPath.endsWith("/") ? urlPath : urlPath + "/";
  if (fileSet.has(dir + "index.html")) return dir + "index.html";
  if (!urlPath.endsWith("/") && fileSet.has(urlPath + ".html")) return urlPath + ".html";
  return null;
}

function frontMatter(file) {
  const m = fs.readFileSync(file, "utf8").match(/^---\n([\s\S]*?)\n---/);
  const permalink = m?.[1].match(/^permalink:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1];
  return { permalink };
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#038": "&", "#38": "&", "#039": "'", "#39": "'" };
const decodeEntities = (s) => s.replace(/&(#?\w+);/g, (m, e) => ENTITIES[e] ?? m);

// -------------------------------------------------------- _redirects model

const redirectRules = fs
  .readFileSync(path.join(SITE, "_redirects"), "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"))
  .map((line) => {
    const parts = line.split(/\s+/);
    const from = parts[0];
    const [to, statusRaw] = parts.slice(-2);
    const query = Object.fromEntries(parts.slice(1, -2).map((q) => q.split("=")));
    const forced = statusRaw.endsWith("!");
    const status = Number(statusRaw.replace("!", ""));
    const pattern = new RegExp(
      "^" +
        decodeURIComponent(from)
          .replace(/\/$/, "")
          .split(/(\*|:[a-z]+)/)
          .map((seg) => (seg === "*" ? "(?<splat>.*)" : seg.startsWith(":") ? `(?<${seg.slice(1)}>[^/]+)` : seg.replace(/[.?+()[\]{}|^$\\]/g, "\\$&")))
          .join("") +
        "/?$",
    );
    return { line, pattern, query, to, status, forced };
  });

/** Netlify-style resolution: returns { status, file, chain } for a path + query. */
function resolve(urlPath, search = "", depth = 0) {
  const params = new URLSearchParams(search);
  const existing = fileFor(urlPath);
  for (const rule of redirectRules) {
    if (existing && !rule.forced) continue;
    const m = urlPath.match(rule.pattern);
    if (!m) continue;
    if (!Object.entries(rule.query).every(([k, v]) => params.get(k) === v || (v.startsWith(":") && params.has(k)))) continue;
    const target = rule.to.replace(/:(\w+)/g, (_, k) => m.groups?.[k] ?? `:${k}`);
    if (rule.status === 404) return { status: 404, file: fileFor(target), chain: [rule.line] };
    if (depth > 5) return { status: 0, file: null, chain: [rule.line, "redirect loop"] };
    const next = resolve(new URL(target, ORIGIN).pathname, "", depth + 1);
    return { status: rule.status, file: next.status === 200 ? next.file : null, chain: [rule.line, ...next.chain] };
  }
  return existing ? { status: 200, file: existing, chain: [] } : { status: 404, file: null, chain: [] };
}

// ------------------------------------------------- 1. generated page counts

for (const [kind, dir] of [["posts", "content/posts"], ["pages", "content/pages"]]) {
  const sources = fs.readdirSync(dir).filter((f) => /\.(md|html|njk)$/.test(f));
  const built = sources.filter((f) => {
    const { permalink } = frontMatter(path.join(dir, f));
    if (!permalink) return fail("page-count", `${dir}/${f} has no permalink`), false;
    if (!fileFor(permalink)) return fail("page-count", `${dir}/${f} -> ${permalink} not generated`), false;
    return true;
  });
  if (sources.length !== EXPECTED[kind] || built.length !== EXPECTED[kind]) {
    fail("page-count", `expected ${EXPECTED[kind]} ${kind}, found ${sources.length} sources / ${built.length} built`);
  }
  console.log(`Generated ${kind}: ${built.length}/${EXPECTED[kind]}`);
}
const postHtml = [...fileSet].filter((f) => /^\/\d{4}\/(?!page\/)[^/]+\/index\.html$/.test(f));
if (postHtml.length !== EXPECTED.posts) fail("page-count", `expected ${EXPECTED.posts} /YYYY/slug/ outputs, found ${postHtml.length}`);

// ------------------------------------------------ 2. inventory route parity

const inventory = JSON.parse(fs.readFileSync("inventory-routes.json", "utf8")).routes;
const routeStats = { 200: 0, 301: 0, 404: 0 };
for (const route of inventory) {
  const url = new URL(route.path, ORIGIN);
  const r = resolve(decodeURIComponent(url.pathname), url.search);
  if (route.routeType === "admin_api") {
    if (r.status !== 404 || r.file !== "/404.html") fail("inventory", `${route.path} should be 404 -> /404.html, got ${r.status}`);
  } else if (!r.file || (r.status !== 200 && r.status !== 301)) {
    fail("inventory", `${route.path} (${route.routeType}) -> ${r.status} ${r.chain.join(" => ") || "no rule"}`);
  } else if (["post", "page"].includes(route.routeType) && r.status !== 200) {
    fail("inventory", `${route.path} canonical ${route.routeType} is not served directly (${r.status})`);
  } else if (route.routeType === "query_url" && r.status !== 301) {
    fail("inventory", `${route.path} query permalink is not redirected (${r.status} ${r.file})`);
  } else if (route.target) {
    // Crawl-derived attachment targets sometimes guessed the wrong year; only compare targets that exist.
    const expected = resolve(new URL(route.target, ORIGIN).pathname).file;
    if (expected && r.file !== expected) fail("inventory", `${route.path} resolves to ${r.file}, expected ${expected} (via ${route.target})`);
  }
  routeStats[r.status] = (routeStats[r.status] ?? 0) + 1;
}
console.log(`Inventory routes: ${inventory.length} (200: ${routeStats[200]}, 301: ${routeStats[301]}, 404: ${routeStats[404]})`);

// ------------------------------------------- 3-6. scan generated HTML files

const htmlFiles = outputFiles.filter((f) => f.endsWith(".html"));
const htmlCache = new Map();
const readHtml = (rel) => {
  if (!htmlCache.has(rel)) htmlCache.set(rel, fs.readFileSync(path.join(SITE, rel), "utf8"));
  return htmlCache.get(rel);
};
const idCache = new Map();
const idsIn = (rel) => {
  if (!idCache.has(rel)) {
    idCache.set(rel, new Set([...readHtml(rel).matchAll(/<[a-zA-Z][^>]*?\s(?:id|name)\s*=\s*["']([^"']+)["']/g)].map((m) => decodeEntities(m[1]))));
  }
  return idCache.get(rel);
};

const TAG = /<([a-zA-Z][\w-]*)(\s[^>]*)?>/g;
const ATTR = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
const URL_ATTRS = new Set(["href", "src", "srcset", "poster", "data", "action", "content"]);
const SUBRESOURCE_TAGS = new Set(["img", "script", "iframe", "source", "audio", "video", "embed", "object", "track", "input"]);
const WP_LEFTOVER = /dustinsview\.com\/wp-|^\/wp-(?:content|includes|admin|json|login)|(?:^|dustinsview\.com)\/[^?#]*\.php\b|^(?:https?:\/\/(?:www\.)?dustinsview\.com)?\/?\?(?:p|page_id|attachment_id)=\d/;

const stats = { internal: 0, media: 0, fragments: 0 };
for (const file of htmlFiles) {
  const rel = "/" + path.relative(SITE, file).split(path.sep).join("/");
  const html = readHtml(rel);
  const base = new URL(rel.replace(/index\.html$/, ""), ORIGIN);

  for (const [, tagRaw, attrs = ""] of html.matchAll(TAG)) {
    const tag = tagRaw.toLowerCase();
    const attrMap = Object.fromEntries([...attrs.matchAll(ATTR)].map((a) => [a[1].toLowerCase(), decodeEntities(a[3] ?? a[4])]));
    for (const [name, value] of Object.entries(attrMap)) {
      if (!URL_ATTRS.has(name) || !value) continue;
      if (name === "content" && !/^(og:(url|image|audio|video)|twitter:image)/.test(attrMap.property ?? attrMap.name ?? "")) continue;
      const refs = name === "srcset" ? value.split(",").map((c) => c.trim().split(/\s+/)[0]) : [value.trim()];

      for (const ref of refs) {
        if (WP_LEFTOVER.test(ref)) fail("wp-leftover", `${rel}: <${tag} ${name}="${ref}">`);

        const isSubresource = SUBRESOURCE_TAGS.has(tag) || name === "srcset" || name === "poster" ||
          (tag === "link" && /stylesheet|icon|preload|manifest/.test(attrMap.rel ?? ""));
        if (/^http:\/\//i.test(ref) && (isSubresource || /^http:\/\/(www\.)?dustinsview\.com/i.test(ref))) {
          fail("mixed-content", `${rel}: <${tag} ${name}="${ref}">`);
        }

        let url;
        try {
          url = new URL(ref, base);
        } catch {
          fail("internal-link", `${rel}: unparseable URL "${ref}"`);
          continue;
        }
        if (!/^https?:$/.test(url.protocol) || !/^(www\.)?dustinsview\.com$/.test(url.hostname)) continue;

        let target = url.pathname;
        try {
          target = decodeURIComponent(target);
        } catch {}
        const r = resolve(target, url.search);
        const isMedia = target.startsWith("/media/");
        stats[isMedia ? "media" : "internal"]++;
        if (!r.file || r.status === 404) {
          fail(isMedia ? "media" : "internal-link", `${rel}: ${ref} -> ${r.status}`);
          continue;
        }
        if (url.hash.length > 1 && r.file.endsWith(".html")) {
          stats.fragments++;
          const id = decodeURIComponent(url.hash.slice(1));
          if (!idsIn(r.file).has(id)) fail("fragment", `${rel}: ${ref} -> no #${id} in ${r.file}`);
        }
      }
    }
  }

  // Text-level scan for WordPress/PHP references outside attributes (e.g. inline styles, scripts).
  const text = html.replace(TAG, "");
  for (const m of text.matchAll(/[^\s<>"']*dustinsview\.com\/wp-[^\s<>"']*|[^\s<>"']*\b(?:xmlrpc|wp-login|admin-ajax|wp-cron)\.php[^\s<>"']*/g)) {
    fail("wp-leftover", `${rel}: text "${m[0]}"`);
  }
  for (const m of html.matchAll(/url\(\s*["']?(http:\/\/[^)"']+)/gi)) fail("mixed-content", `${rel}: css url(${m[1]})`);
}

// Stylesheets can reference assets too.
for (const css of outputFiles.filter((f) => f.endsWith(".css"))) {
  const src = fs.readFileSync(css, "utf8");
  for (const m of src.matchAll(/url\(\s*["']?([^)"']+)/g)) {
    const ref = m[1];
    if (/^http:/i.test(ref)) fail("mixed-content", `${css}: url(${ref})`);
    if (ref.startsWith("data:") || /^https?:/i.test(ref)) continue;
    const target = new URL(ref, new URL("/" + path.relative(SITE, css), ORIGIN)).pathname;
    if (!fileFor(target)) fail("internal-link", `${css}: url(${ref}) missing`);
  }
}

console.log(`HTML files scanned: ${htmlFiles.length}`);
console.log(`Internal references: ${stats.internal}, media references: ${stats.media}, fragment links: ${stats.fragments}`);

// ------------------------------------------------------------------ report

const byCheck = Object.groupBy(failures, (f) => f.check);
const checks = ["page-count", "inventory", "internal-link", "fragment", "media", "wp-leftover", "mixed-content"];
for (const check of checks) {
  const list = byCheck[check] ?? [];
  console.log(`${list.length ? "FAIL" : "ok  "} ${check}: ${list.length} issue(s)`);
  for (const { message } of list.slice(0, 50)) console.log(`       ${message}`);
  if (list.length > 50) console.log(`       ... ${list.length - 50} more`);
}
process.exit(failures.length ? 1 : 0);
