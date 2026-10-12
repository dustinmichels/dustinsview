#!/usr/bin/env node
/**
 * Phase 9.3 validation for the generated site.
 *
 * 1. Builds the site with Eleventy (skip with --no-build).
 * 2. HTML: runs the Nu HTML Checker (vnu-jar, needs Java) over every page in
 *    _site/. Errors fail; warnings are reported (pass --strict to fail on them).
 * 3. Feed: /feed.xml must be well-formed RSS 2.0 with the required channel and
 *    item elements, an atom:link rel="self", one item per post, RFC 822 dates,
 *    and item links that resolve to generated pages.
 * 4. Sitemap: /sitemap.xml must validate against the sitemaps.org 0.9 XSD
 *    (scripts/schemas/sitemap-0.9.xsd, via xmllint), contain no duplicates,
 *    list every post and page, and every <loc> must resolve to a generated
 *    page whose <link rel="canonical"> equals that <loc>.
 *
 * Exits non-zero when any check fails.
 * Usage: node scripts/validate.mjs [--no-build] [--strict]
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const SITE = "_site";
const ORIGIN = "https://dustinsview.com";
const strict = process.argv.includes("--strict");

if (!process.argv.includes("--no-build")) {
  console.log("Building site...");
  fs.rmSync(SITE, { recursive: true, force: true });
  execFileSync("npx", ["@11ty/eleventy", "--quiet"], { stdio: "inherit" });
}

const results = [];
function report(name, issues, warnings = []) {
  results.push({ name, issues, warnings });
}

/** Path of the generated file served for an absolute site URL, or null. */
function fileForUrl(url) {
  if (!url.startsWith(ORIGIN + "/")) return null;
  const p = decodeURIComponent(new URL(url).pathname);
  const candidate = path.join(SITE, p.endsWith("/") ? p + "index.html" : p);
  return fs.existsSync(candidate) ? candidate : null;
}

const tagText = (xml, tag) =>
  [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g"))].map((m) =>
    m[1].trim(),
  );

function xmllint(args) {
  const r = spawnSync("xmllint", ["--noout", ...args], { encoding: "utf8" });
  if (r.error) throw new Error(`xmllint unavailable: ${r.error.message}`);
  return r.status === 0 ? [] : r.stderr.trim().split("\n");
}

const postSources = fs.readdirSync("content/posts").filter((f) => f.endsWith(".md"));
const permalinkOf = (file) =>
  fs.readFileSync(file, "utf8").match(/^permalink:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1];
const postUrls = postSources.map((f) => ORIGIN + permalinkOf(path.join("content/posts", f)));
const pageUrls = fs
  .readdirSync("content/pages")
  .filter((f) => f.endsWith(".md"))
  .map((f) => ORIGIN + permalinkOf(path.join("content/pages", f)));

// --- 1. HTML (Nu HTML Checker) ---------------------------------------------
{
  const require = createRequire(import.meta.url);
  const vnu = require("vnu-jar");
  const r = spawnSync(
    "java",
    ["-jar", vnu, "--skip-non-html", "--format", "json", "--exit-zero-always", SITE],
    {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (r.error) throw new Error(`java unavailable (required by vnu-jar): ${r.error.message}`);
  const messages = JSON.parse(r.stderr || '{"messages":[]}').messages;
  const fmt = (m) => `${m.url.replace(/^.*?\/_site/, "")}:${m.lastLine ?? "?"} ${m.message}`;
  const errors = messages.filter((m) => m.type === "error" || m.type === "non-document-error");
  const warnings = messages.filter((m) => m.type === "info" && m.subType === "warning");
  report("html", errors.map(fmt), warnings.map(fmt));
}

// --- 2. RSS feed -------------------------------------------------------------
{
  const issues = [];
  const feedFile = path.join(SITE, "feed.xml");
  issues.push(...xmllint([feedFile]));
  const xml = fs.readFileSync(feedFile, "utf8");
  if (!/<rss\s[^>]*version="2\.0"/.test(xml))
    issues.push('root element is not <rss version="2.0">');
  const channel = xml.replace(/<item>[\s\S]*?<\/item>/g, "");
  for (const tag of ["title", "link", "description"]) {
    if (!tagText(channel, tag)[0]) issues.push(`channel is missing <${tag}>`);
  }
  if (!new RegExp(`<atom:link href="${ORIGIN}/feed.xml" rel="self"`).test(xml)) {
    issues.push('missing atom:link rel="self" pointing at the feed URL');
  }
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  if (items.length !== postSources.length)
    issues.push(`${items.length} items, expected ${postSources.length} posts`);
  const links = new Set();
  for (const item of items) {
    const [title] = tagText(item, "title");
    const [link] = tagText(item, "link");
    const [guid] = tagText(item, "guid");
    const [pubDate] = tagText(item, "pubDate");
    const label = link || title || "(unnamed item)";
    if (!title) issues.push(`${label}: missing <title>`);
    if (!link) issues.push(`${label}: missing <link>`);
    else if (!fileForUrl(link)) issues.push(`${label}: link does not resolve to a generated page`);
    if (guid !== link) issues.push(`${label}: permalink <guid> does not match <link>`);
    if (
      !pubDate ||
      !/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} [+-]\d{4}$/.test(pubDate)
    ) {
      issues.push(`${label}: <pubDate> "${pubDate}" is not RFC 822`);
    }
    if (links.has(link)) issues.push(`${label}: duplicate item`);
    links.add(link);
  }
  for (const url of postUrls) if (!links.has(url)) issues.push(`post missing from feed: ${url}`);
  report("feed", issues);
}

// --- 3. Sitemap ----------------------------------------------------------------
{
  const issues = [];
  const sitemapFile = path.join(SITE, "sitemap.xml");
  issues.push(
    ...xmllint(["--schema", "scripts/schemas/sitemap-0.9.xsd", sitemapFile]).filter(
      (l) => !/ validates$/.test(l),
    ),
  );
  const xml = fs.readFileSync(sitemapFile, "utf8");
  const locs = tagText(xml, "loc");
  const seen = new Set();
  for (const loc of locs) {
    if (seen.has(loc)) issues.push(`duplicate <loc>: ${loc}`);
    seen.add(loc);
    const file = fileForUrl(loc);
    if (!file) {
      issues.push(`<loc> does not resolve to a generated page: ${loc}`);
      continue;
    }
    const canonical = fs
      .readFileSync(file, "utf8")
      .match(/<link rel="canonical" href="([^"]+)">/)?.[1];
    if (canonical !== loc) issues.push(`${loc}: canonical is ${canonical ?? "missing"}`);
  }
  for (const url of [...postUrls, ...pageUrls])
    if (!seen.has(url)) issues.push(`missing from sitemap: ${url}`);
  report("sitemap", issues);
}

let failed = false;
for (const { name, issues, warnings } of results) {
  const bad = issues.length > 0 || (strict && warnings.length > 0);
  failed ||= bad;
  console.log(
    `${bad ? "FAIL" : "ok  "} ${name}: ${issues.length} error(s), ${warnings.length} warning(s)`,
  );
  for (const line of issues.slice(0, 50)) console.log(`       ${line}`);
  if (strict) for (const line of warnings.slice(0, 50)) console.log(`       warning: ${line}`);
}
process.exit(failed ? 1 : 0);
