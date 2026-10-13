#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const SITE = "_site";
const ORIGIN = "https://dustinsview.com";
const BASE_URL = process.env.BASE_URL || "https://dustinsview.netlify.app";

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

const outputFiles = walk(SITE);
const fileSet = new Set(
  outputFiles.map((f) => "/" + path.relative(SITE, f).split(path.sep).join("/")),
);

function fileFor(urlPath) {
  if (fileSet.has(urlPath)) return urlPath;
  const dir = urlPath.endsWith("/") ? urlPath : urlPath + "/";
  if (fileSet.has(dir + "index.html")) return dir + "index.html";
  if (!urlPath.endsWith("/") && fileSet.has(urlPath + ".html")) return urlPath + ".html";
  return null;
}

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
          .map((seg) =>
            seg === "*"
              ? "(?<splat>.*)"
              : seg.startsWith(":")
                ? `(?<${seg.slice(1)}>[^/]+)`
                : seg.replace(/[.?+()[\]{}|^$\\]/g, "\\$&"),
          )
          .join("") +
        "/?$",
    );
    return { line, pattern, query, to, status, forced };
  });

function resolve(urlPath, search = "", depth = 0) {
  const params = new URLSearchParams(search);
  const existing = fileFor(urlPath);
  for (const rule of redirectRules) {
    if (existing && !rule.forced) continue;
    const m = urlPath.match(rule.pattern);
    if (!m) continue;
    if (
      !Object.entries(rule.query).every(
        ([k, v]) => params.get(k) === v || (v.startsWith(":") && params.has(k)),
      )
    )
      continue;
    const target = rule.to.replace(/:(\w+)/g, (_, k) => m.groups?.[k] ?? `:${k}`);
    if (rule.status === 404)
      return { status: 404, file: fileFor(target), target, chain: [rule.line] };
    if (depth > 5)
      return { status: 0, file: null, target: null, chain: [rule.line, "redirect loop"] };
    const next = resolve(new URL(target, ORIGIN).pathname, "", depth + 1);
    return {
      status: rule.status,
      target,
      file: next.status === 200 ? next.file : null,
      chain: [rule.line, ...next.chain],
    };
  }
  return existing
    ? { status: 200, file: existing, target: null, chain: [] }
    : { status: 404, file: null, target: null, chain: [] };
}

const inventory = JSON.parse(fs.readFileSync("inventory-routes.json", "utf8")).routes;

console.log(`Checking ${inventory.length} routes against ${BASE_URL}...`);

// Fetch with retry and backoff on 429/403 rate limits
async function fetchWithRetry(url, opts = {}, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, opts);
    if ((res.status === 429 || res.status === 403) && attempt < maxRetries) {
      const retryAfter = Number(res.headers.get("retry-after")) || (attempt + 1) * 500;
      await new Promise((r) => setTimeout(r, retryAfter));
      continue;
    }
    return res;
  }
}

// Concurrency pool with small delay between tasks to avoid edge rate limits
async function pool(items, concurrency, fn) {
  const results = new Array(items.length);
  let nextIdx = 0;
  async function worker() {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      results[idx] = await fn(items[idx], idx);
      // Small delay between requests
      await new Promise((r) => setTimeout(r, 15));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

function normalizeUrlPath(urlStr) {
  try {
    const u = new URL(urlStr, BASE_URL);
    return u.pathname + (u.search || "");
  } catch {
    return urlStr;
  }
}

async function verifyRoute(route, idx) {
  const urlObj = new URL(route.path, ORIGIN);
  const expected = resolve(decodeURIComponent(urlObj.pathname), urlObj.search);
  const liveUrl = new URL(route.path, BASE_URL).href;

  let initialRes;
  try {
    initialRes = await fetchWithRetry(liveUrl, {
      method: "GET",
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "*/*",
      },
    });
  } catch (err) {
    return { route, expected, error: `Initial fetch failed: ${err.message}` };
  }

  const initialStatus = initialRes.status;
  const locationHeader = initialRes.headers.get("location");
  await initialRes.text(); // consume body

  let finalRes = null;
  let finalStatus = initialStatus;
  let finalUrl = liveUrl;

  if (initialStatus >= 300 && initialStatus < 400) {
    try {
      finalRes = await fetchWithRetry(liveUrl, {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "*/*",
        },
      });
      finalStatus = finalRes.status;
      finalUrl = finalRes.url;
      await finalRes.text(); // consume body
    } catch (err) {
      return {
        route,
        expected,
        initialStatus,
        locationHeader,
        error: `Follow redirect failed: ${err.message}`,
      };
    }
  }

  return {
    route,
    expected,
    initialStatus,
    locationHeader,
    finalStatus,
    finalUrl,
  };
}

// Concurrency of 4
const checkResults = await pool(inventory, 4, verifyRoute);

const failures = [];
const stats = { initial: {}, final: {} };

for (const res of checkResults) {
  if (res.error) {
    failures.push({ route: res.route.path, type: res.route.routeType, error: res.error });
    continue;
  }

  const { route, expected, initialStatus, locationHeader, finalStatus, finalUrl } = res;
  stats.initial[initialStatus] = (stats.initial[initialStatus] || 0) + 1;
  stats.final[finalStatus] = (stats.final[finalStatus] || 0) + 1;

  // 1. admin_api routes: must be 404
  if (route.routeType === "admin_api") {
    if (initialStatus !== 404) {
      failures.push({
        route: route.path,
        type: route.routeType,
        error: `admin_api expected status 404, got ${initialStatus}`,
      });
    }
    continue;
  }

  // 2. canonical posts, pages, home: must be served directly (200)
  if (route.routeType === "home" || route.routeType === "post" || route.routeType === "page") {
    if (initialStatus !== 200) {
      failures.push({
        route: route.path,
        type: route.routeType,
        error: `Canonical ${route.routeType} expected initial 200, got ${initialStatus} (location: ${locationHeader})`,
      });
    }
    if (finalStatus !== 200) {
      failures.push({
        route: route.path,
        type: route.routeType,
        error: `Canonical ${route.routeType} final status expected 200, got ${finalStatus}`,
      });
    }
    continue;
  }

  // 3. query_url: must be 301 redirect
  if (route.routeType === "query_url") {
    if (initialStatus !== 301) {
      failures.push({
        route: route.path,
        type: route.routeType,
        error: `query_url expected initial 301, got ${initialStatus}`,
      });
    }
  }

  // 4. Expected initial status according to local rules (200 vs 301)
  if (expected.status === 200) {
    if (initialStatus !== 200) {
      failures.push({
        route: route.path,
        type: route.routeType,
        error: `Expected initial 200, got ${initialStatus} (location: ${locationHeader})`,
      });
    }
  } else if (expected.status === 301) {
    if (initialStatus !== 301) {
      failures.push({
        route: route.path,
        type: route.routeType,
        error: `Expected initial 301 redirect, got ${initialStatus}`,
      });
    }
    if (!locationHeader) {
      failures.push({
        route: route.path,
        type: route.routeType,
        error: `Expected Location header on 301 redirect, got none`,
      });
    } else if (expected.target) {
      const expectedPathname = new URL(expected.target, ORIGIN).pathname;
      const actualPathname = new URL(locationHeader, ORIGIN).pathname;
      if (expectedPathname !== actualPathname) {
        failures.push({
          route: route.path,
          type: route.routeType,
          error: `Redirect Location mismatch: expected ${expectedPathname}, got ${actualPathname} (${locationHeader})`,
        });
      }
    }
  }

  // 5. All non-admin routes MUST have final status 200
  if (finalStatus !== 200) {
    failures.push({
      route: route.path,
      type: route.routeType,
      error: `Final status expected 200, got ${finalStatus} (finalUrl: ${finalUrl})`,
    });
  }

  // 6. Cross-check against inventory target where specified and valid
  if (route.target) {
    const expectedInventory = resolve(new URL(route.target, ORIGIN).pathname).file;
    if (expectedInventory) {
      const finalPathname = new URL(finalUrl, ORIGIN).pathname;
      const expectedResolvedPathname = expectedInventory.replace(/\/index\.html$/, "/");
      if (finalPathname !== expectedResolvedPathname && finalPathname !== expectedInventory) {
        failures.push({
          route: route.path,
          type: route.routeType,
          error: `Inventory target mismatch: expected to reach file ${expectedInventory}, but landed on ${finalPathname}`,
        });
      }
    }
  }
}

// 1. Check all 625 media assets and legacy upload redirects
console.log("\nChecking all media assets and /wp-content/uploads/ redirects...");
const manifest = JSON.parse(fs.readFileSync("src/_data/mediaManifest.json", "utf8")).assets;
let mediaChecked = 0;
let mediaUploadsChecked = 0;

async function checkMedia(asset) {
  const liveMediaUrl = new URL(asset.localPath, BASE_URL).href;
  try {
    const mRes = await fetchWithRetry(liveMediaUrl, {
      method: "HEAD",
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const cl = mRes.headers.get("content-length");
    if (mRes.status !== 200) {
      failures.push({
        route: asset.localPath,
        type: "media",
        error: `Expected 200 for media asset, got ${mRes.status}`,
      });
    } else if (cl && Number(cl) !== asset.fileSize) {
      failures.push({
        route: asset.localPath,
        type: "media",
        error: `Content-Length mismatch: expected ${asset.fileSize}, got ${cl}`,
      });
    } else {
      mediaChecked++;
    }
  } catch (err) {
    failures.push({ route: asset.localPath, type: "media", error: err.message });
  }

  if (asset.localPath.startsWith("/media/")) {
    const legacyPath = asset.localPath.replace(/^\/media\//, "/wp-content/uploads/");
    const liveLegacyUrl = new URL(legacyPath, BASE_URL).href;
    try {
      const legRes = await fetchWithRetry(liveLegacyUrl, {
        method: "HEAD",
        redirect: "manual",
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      const loc = legRes.headers.get("location");
      if (legRes.status !== 301) {
        failures.push({
          route: legacyPath,
          type: "media_redirect",
          error: `Expected 301 for legacy upload, got ${legRes.status}`,
        });
      } else if (loc !== asset.localPath) {
        failures.push({
          route: legacyPath,
          type: "media_redirect",
          error: `Expected redirect location ${asset.localPath}, got ${loc}`,
        });
      } else {
        mediaUploadsChecked++;
      }
    } catch (err) {
      failures.push({ route: legacyPath, type: "media_redirect", error: err.message });
    }
  }
}

await pool(manifest, 8, checkMedia);
console.log(`Media assets checked: ${mediaChecked}/${manifest.length}`);
console.log(
  `Upload redirects checked: ${mediaUploadsChecked}/${manifest.filter((a) => a.localPath.startsWith("/media/")).length}`,
);

// 2. Exhaustive check of all publish-tree regular files in _site
const publicTreeFiles = outputFiles
  .map((f) => "/" + path.relative(SITE, f).split(path.sep).join("/"))
  .filter((f) => f !== "/_redirects" && !path.basename(f).startsWith("."));

console.log(`\nChecking all ${publicTreeFiles.length} publish-tree files in _site...`);
let treeFilesChecked = 0;

async function checkTreeFile(siteFile) {
  let routePath = siteFile;
  if (siteFile === "/index.html") {
    routePath = "/";
  } else if (siteFile.endsWith("/index.html")) {
    routePath = siteFile.replace(/index\.html$/, "");
  }

  const liveUrl = new URL(routePath, BASE_URL).href;
  try {
    const res = await fetchWithRetry(liveUrl, {
      method: "HEAD",
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (siteFile === "/404.html") {
      if (res.status === 200 || res.status === 404) {
        treeFilesChecked++;
      } else {
        failures.push({
          route: routePath,
          type: "tree_file",
          error: `Expected 200/404 for /404.html, got ${res.status}`,
        });
      }
    } else if (res.status !== 200) {
      failures.push({
        route: routePath,
        type: "tree_file",
        error: `Expected 200 for publish-tree file ${siteFile}, got ${res.status}`,
      });
    } else {
      treeFilesChecked++;
    }
  } catch (err) {
    failures.push({ route: routePath, type: "tree_file", error: err.message });
  }
}

await pool(publicTreeFiles, 6, checkTreeFile);
console.log(`Publish-tree files checked: ${treeFilesChecked}/${publicTreeFiles.length}`);

// 3. Enumerate and check all concrete and representative rules from _redirects
console.log(`\nChecking all ${redirectRules.length} rules from _redirects...`);
const testCases = [];

for (const rule of redirectRules) {
  const [fromRaw, ...restParts] = rule.line.split(/\s+/);
  const toRaw = restParts[restParts.length - 2];
  const statusExpected = rule.status;

  // Check if parameterized
  if (fromRaw.includes("*") || fromRaw.includes(":")) {
    let testPath = fromRaw;
    let expectedTarget = toRaw;
    if (fromRaw === "/wp-admin/*") {
      testPath = "/wp-admin/edit.php";
      expectedTarget = "/404.html";
    } else if (fromRaw === "/wp-json/*") {
      testPath = "/wp-json/wp/v2/posts";
      expectedTarget = "/404.html";
    } else if (fromRaw === "/wp-includes/*") {
      testPath = "/wp-includes/js/wp-embed.min.js";
      expectedTarget = "/404.html";
    } else if (fromRaw === "/wp-content/uploads/*") {
      testPath = "/wp-content/uploads/2016/06/bernie.jpg";
      expectedTarget = "/media/2016/06/bernie.jpg";
    } else if (fromRaw === "/category/:slug/feed/") {
      testPath = "/category/all/feed/";
      expectedTarget = "/feed.xml";
    } else if (fromRaw === "/tag/:slug/feed/") {
      testPath = "/tag/politics/feed/";
      expectedTarget = "/feed.xml";
    } else if (fromRaw === "/author/:slug/feed/") {
      testPath = "/author/admin/feed/";
      expectedTarget = "/feed.xml";
    } else if (fromRaw === "/:year/:slug/feed/") {
      testPath = "/2016/dear-bernie/feed/";
      expectedTarget = "/feed.xml";
    } else if (fromRaw === "/wp-sitemap*") {
      testPath = "/wp-sitemap-extra.xml";
      expectedTarget = "/sitemap.xml";
    } else if (fromRaw === "/category/:slug/page/*") {
      testPath = "/category/all/page/2/";
      expectedTarget = "/category/all/";
    } else if (fromRaw === "/tag/:slug/page/*") {
      testPath = "/tag/politics/page/2/";
      expectedTarget = "/tag/politics/";
    } else if (fromRaw === "/author/admin/page/*") {
      testPath = "/author/admin/page/2/";
      expectedTarget = "/author/admin/";
    } else if (fromRaw === "/:year/page/*") {
      testPath = "/2016/page/2/";
      expectedTarget = "/2016/";
    } else if (fromRaw === "/author/*") {
      testPath = "/author/dustin/";
      expectedTarget = "/author/admin/";
    } else if (fromRaw.endsWith("/attachment/*")) {
      testPath = fromRaw.replace(/\/\*$/, "/notes/");
      expectedTarget = toRaw;
    } else if (fromRaw === "/2013/songs-of-peaceful-resignation/*") {
      testPath = "/2013/songs-of-peaceful-resignation/%c2%80i/";
      expectedTarget = toRaw;
    }
    testCases.push({ rule: rule.line, testPath, statusExpected, expectedTarget });
  } else {
    // Concrete rule (path or path + query)
    const queryParts = Object.entries(rule.query);
    let testPath = fromRaw;
    if (queryParts.length > 0) {
      const qStr = queryParts.map(([k, v]) => `${k}=${v}`).join("&");
      testPath = `${fromRaw}?${qStr}`;
    }
    testCases.push({ rule: rule.line, testPath, statusExpected, expectedTarget: toRaw });
  }
}

let rulesChecked = 0;
async function checkRule(tc) {
  const liveUrl = new URL(tc.testPath, BASE_URL).href;
  try {
    const res = await fetchWithRetry(liveUrl, {
      method: "GET",
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const location = res.headers.get("location");
    await res.text();
    if (res.status !== tc.statusExpected) {
      failures.push({
        route: tc.testPath,
        type: "redirect_rule",
        error: `Rule '${tc.rule}' expected status ${tc.statusExpected}, got ${res.status} (location: ${location})`,
      });
    } else if (tc.statusExpected === 301) {
      if (!location) {
        failures.push({
          route: tc.testPath,
          type: "redirect_rule",
          error: `Rule '${tc.rule}' expected Location header, got none`,
        });
      } else {
        const expectedPathname = new URL(tc.expectedTarget, ORIGIN).pathname;
        const actualPathname = new URL(location, ORIGIN).pathname;
        if (expectedPathname !== actualPathname) {
          failures.push({
            route: tc.testPath,
            type: "redirect_rule",
            error: `Rule '${tc.rule}' location mismatch: expected ${expectedPathname}, got ${actualPathname} (${location})`,
          });
        } else {
          rulesChecked++;
        }
      }
    } else {
      rulesChecked++;
    }
  } catch (err) {
    failures.push({ route: tc.testPath, type: "redirect_rule", error: err.message });
  }
}

await pool(testCases, 8, checkRule);
console.log(`Redirect rules checked: ${rulesChecked}/${testCases.length}`);
console.log("\n--- Crawl Results ---");
console.log("Initial status counts:", stats.initial);
console.log("Final status counts:", stats.final);

if (failures.length > 0) {
  console.error(`\nFAILED: Found ${failures.length} parity issues:\n`);
  for (const f of failures.slice(0, 30)) {
    console.error(`  [${f.type}] ${f.route}: ${f.error}`);
  }
  if (failures.length > 30) {
    console.error(`  ... and ${failures.length - 30} more.`);
  }
  process.exit(1);
} else {
  console.log(`\nSUCCESS: All ${inventory.length} routes satisfied exact parity requirements!`);
}
