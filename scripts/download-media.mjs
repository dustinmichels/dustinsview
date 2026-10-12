import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);

const PROJECT_ROOT = process.cwd();
const WXR_PATH = path.join(PROJECT_ROOT, "backup/wxr/dustinsview.WordPress.2026-10-12.xml");
const REST_MEDIA_PATH = path.join(PROJECT_ROOT, "backup/wp-raw-snapshot/media.json");
const POSTS_DIR = path.join(PROJECT_ROOT, "content/posts");
const PAGES_DIR = path.join(PROJECT_ROOT, "content/pages");
const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");
const MEDIA_DIR = path.join(PUBLIC_DIR, "media");
const MANIFEST_PATH = path.join(PROJECT_ROOT, "src/_data/mediaManifest.json");

const MIME_MAP = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

function getMimeType(filePath, contentTypeHeader) {
  if (contentTypeHeader) {
    const cleanType = contentTypeHeader.split(";")[0].trim().toLowerCase();
    if (cleanType && cleanType !== "application/octet-stream" && cleanType !== "text/html") {
      return cleanType;
    }
  }
  const ext = path.extname(filePath).toLowerCase();
  return MIME_MAP[ext] || "application/octet-stream";
}

function computeSha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

// 1. Extract all URLs matching wp-content/uploads/ from WXR XML
export async function extractWxrMediaUrls() {
  const urls = new Set();
  try {
    const xmlContent = await fs.readFile(WXR_PATH, "utf8");
    const attachmentRegex =
      /<wp:post_type><!\[CDATA\[attachment\]\]><\/wp:post_type>[\s\S]*?<wp:attachment_url><!\[CDATA\[(.*?)\]\]><\/wp:attachment_url>/g;
    let match;
    while ((match = attachmentRegex.exec(xmlContent)) !== null) {
      const u = match[1].trim();
      if (u) {
        urls.add(u.replace("http://dustinsview.com", "https://dustinsview.com"));
      }
    }
  } catch (err) {
    console.warn(`Warning reading WXR file: ${err.message}`);
  }
  return urls;
}

// 2. Extract media URLs and sizes from REST API media.json
export async function extractRestMediaUrls(includeSizes = true) {
  const urls = new Set();
  try {
    const content = await fs.readFile(REST_MEDIA_PATH, "utf8");
    const media = JSON.parse(content);
    for (const m of media) {
      if (m.source_url) {
        urls.add(m.source_url.replace("http://dustinsview.com", "https://dustinsview.com"));
      }
      if (includeSizes) {
        const sizes = m.media_details?.sizes || {};
        for (const s of Object.values(sizes)) {
          if (s.source_url) {
            urls.add(s.source_url.replace("http://dustinsview.com", "https://dustinsview.com"));
          }
        }
      }
    }
  } catch (err) {
    console.warn(`Warning reading REST media file: ${err.message}`);
  }
  return urls;
}

// 3. Extract all URLs matching dustinsview.com/wp-content/uploads/** from markdown files
export async function extractContentMediaUrls() {
  const urls = new Set();
  const dirs = [POSTS_DIR, PAGES_DIR];
  const uploadRegex =
    /(?:https?:\/\/(?:www\.)?dustinsview\.com\/wp-content\/uploads\/|\/media\/)([^\s"'<>)]+)/g;

  for (const dir of dirs) {
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        const filePath = path.join(dir, file);
        const text = await fs.readFile(filePath, "utf8");
        let match;
        while ((match = uploadRegex.exec(text)) !== null) {
          const rel = match[1];
          urls.add(`https://dustinsview.com/wp-content/uploads/${rel}`);
        }
      }
    } catch (err) {
      console.warn(`Warning reading markdown dir ${dir}: ${err.message}`);
    }
  }
  return urls;
}

// 4. Download file with retries using fetch (fallback)
async function downloadWithFetch(url, targetPath, maxRetries = 3, timeoutMs = 20000) {
  let attempt = 0;
  while (attempt < maxRetries) {
    attempt++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) dustinsview-archive/1.0",
        },
      });
      clearTimeout(timer);

      if (!res.ok) {
        return { ok: false, status: res.status, error: `HTTP ${res.status}` };
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(targetPath, buffer);
      return { ok: true, status: res.status, buffer, contentType: res.headers.get("content-type") };
    } catch (err) {
      clearTimeout(timer);
      const isAbort = err.name === "AbortError";
      const msg = isAbort ? `Timeout after ${timeoutMs}ms` : err.message;
      if (attempt >= maxRetries) {
        return { ok: false, status: 0, error: msg };
      }
      await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }
  return { ok: false, status: 0, error: "Max retries exceeded" };
}

// 5. Rewrite Markdown content (front matter + body)
export function rewriteContent(markdown) {
  let content = markdown;

  // Split front matter and body
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    return rewriteHtmlBody(content);
  }

  const rawYaml = fmMatch[1];
  let body = fmMatch[2];

  let parsedFm;
  try {
    parsedFm = yaml.load(rawYaml);
  } catch {
    parsedFm = null;
  }

  if (parsedFm && parsedFm.featuredMedia?.url) {
    parsedFm.featuredMedia.url = parsedFm.featuredMedia.url.replace(
      /^https?:\/\/(?:www\.)?dustinsview\.com\/wp-content\/uploads\//i,
      "/media/",
    );
  }

  body = rewriteHtmlBody(body);

  if (parsedFm) {
    const updatedYaml = yaml.dump(parsedFm, {
      lineWidth: -1,
      quotingType: '"',
      forceQuotes: false,
    });
    return `---\n${updatedYaml}---\n${body}`;
  } else {
    // If YAML parsing failed, fallback to string replacement in front matter
    const updatedYaml = rawYaml.replace(
      /https?:\/\/(?:www\.)?dustinsview\.com\/wp-content\/uploads\//gi,
      "/media/",
    );
    return `---\n${updatedYaml}---\n${body}`;
  }
}

export function rewriteHtmlBody(html) {
  let cleaned = html;

  // 1. Remove plugin tracking pixels (e.g., cookies-for-comments, 1x1 pixels)
  cleaned = cleaned.replace(/<img[^>]*cookies-for-comments[^>]*>/gi, "");
  cleaned = cleaned.replace(/<link[^>]*cookies-for-comments[^>]*>/gi, "");
  cleaned = cleaned.replace(/<script[^>]*cookies-for-comments[^>]*>[\s\S]*?<\/script>/gi, "");
  cleaned = cleaned.replace(
    /<img[^>]*\b(?:width=["']1["']\s+height=["']1["']|height=["']1["']\s+width=["']1["'])[^>]*>/gi,
    "",
  );

  // 2. Strip WordPress responsive image srcset and sizes attributes pointing to WP uploads
  cleaned = cleaned.replace(/\s+srcset=(["'])[\s\S]*?\1/gi, "");
  cleaned = cleaned.replace(/\s+sizes=(["'])[\s\S]*?\1/gi, "");

  // 3. Replace all dustinsview.com/wp-content/uploads/ with /media/
  cleaned = cleaned.replace(
    /https?:\/\/(?:www\.)?dustinsview\.com\/wp-content\/uploads\//gi,
    "/media/",
  );

  return cleaned;
}

export async function processAllContentFiles() {
  const dirs = [POSTS_DIR, PAGES_DIR];
  let updatedCount = 0;

  for (const dir of dirs) {
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const filePath = path.join(dir, file);
      const original = await fs.readFile(filePath, "utf8");
      const rewritten = rewriteContent(original);
      if (rewritten !== original) {
        await fs.writeFile(filePath, rewritten, "utf8");
        updatedCount++;
      }
    }
  }

  return updatedCount;
}

export async function main() {
  console.log("=== Step 1: Discovering Media Assets ===");

  const wxrUrls = await extractWxrMediaUrls();
  console.log(`Found ${wxrUrls.size} media attachments in WXR`);

  const restUrls = await extractRestMediaUrls();
  console.log(`Found ${restUrls.size} media URLs from REST API snapshot`);

  const contentUrls = await extractContentMediaUrls();
  console.log(`Found ${contentUrls.size} media URLs referenced in Markdown posts/pages`);

  // Historical favicons and logos
  const historicalIcons = [
    "https://dustinsview.com/favicon.ico",
    "https://dustinsview.com/wp-content/uploads/2017/01/cropped-d-logo-gray-32x32.png",
    "https://dustinsview.com/wp-content/uploads/2017/01/cropped-d-logo-gray-192x192.png",
    "https://dustinsview.com/wp-content/uploads/2017/01/cropped-d-logo-gray-180x180.png",
    "https://dustinsview.com/wp-content/uploads/2017/01/cropped-d-logo-gray.png",
    "https://dustinsview.com/wp-content/uploads/2017/01/d-logo-gray.png",
    "https://dustinsview.com/wp-content/uploads/2017/01/d-logo.png",
    "https://dustinsview.com/wp-content/uploads/2015/10/Dustins-View-Logo.png",
    "https://dustinsview.com/wp-content/uploads/2015/10/cropped-Dustins-View-Logo.png",
  ];

  // Combine all items to download
  const allMediaMap = new Map();

  function registerItem(sourceUrl, isFavicon = false) {
    const normalizedUrl = sourceUrl
      .replace("http://", "https://")
      .replace("www.dustinsview.com", "dustinsview.com");
    if (allMediaMap.has(normalizedUrl)) return;

    if (isFavicon) {
      allMediaMap.set(normalizedUrl, {
        sourceUrl: normalizedUrl,
        localPath: "/favicon.ico",
        filePath: path.join(PUBLIC_DIR, "favicon.ico"),
        isSpecial: true,
      });
      return;
    }

    const uploadPrefix = "https://dustinsview.com/wp-content/uploads/";
    if (!normalizedUrl.startsWith(uploadPrefix)) {
      return;
    }

    const relPath = normalizedUrl.slice(uploadPrefix.length);
    allMediaMap.set(normalizedUrl, {
      sourceUrl: normalizedUrl,
      localPath: `/media/${relPath}`,
      filePath: path.join(MEDIA_DIR, relPath),
    });
  }

  for (const u of wxrUrls) registerItem(u);
  for (const u of restUrls) registerItem(u);
  for (const u of contentUrls) registerItem(u);
  for (const u of historicalIcons) {
    if (u.endsWith("/favicon.ico")) {
      registerItem(u, true);
    } else {
      registerItem(u, false);
    }
  }

  const itemsToProcess = Array.from(allMediaMap.values());
  console.log(`Total unique assets to localize: ${itemsToProcess.length}`);

  console.log("\n=== Step 2: Downloading Media Assets ===");
  await fs.mkdir(MEDIA_DIR, { recursive: true });

  const missingToDownload = [];
  let cachedCount = 0;

  for (const item of itemsToProcess) {
    try {
      const st = await fs.stat(item.filePath);
      if (st.size > 0) {
        cachedCount++;
      } else {
        missingToDownload.push(item);
      }
    } catch {
      missingToDownload.push(item);
    }
  }

  console.log(`Already cached: ${cachedCount}, Need to download: ${missingToDownload.length}`);

  let downloadedCount = 0;
  let failedCount = 0;
  const missing = [];

  if (missingToDownload.length > 0) {
    // Download using chunked parallel curl
    const CHUNK_SIZE = 25;
    for (let i = 0; i < missingToDownload.length; i += CHUNK_SIZE) {
      const chunk = missingToDownload.slice(i, i + CHUNK_SIZE);
      let configFileContent = "";
      for (const item of chunk) {
        await fs.mkdir(path.dirname(item.filePath), { recursive: true });
        configFileContent += `url = "${item.sourceUrl}"\noutput = "${item.filePath}"\n`;
      }
      const tmpConfigPath = path.join(PROJECT_ROOT, ".cache_curl_config.txt");
      await fs.writeFile(tmpConfigPath, configFileContent, "utf8");

      try {
        await execFileAsync("curl", [
          "-s",
          "-K",
          tmpConfigPath,
          "--parallel",
          "--parallel-max",
          "6",
          "--retry",
          "2",
        ]);
        try {
          await fs.unlink(tmpConfigPath);
        } catch {}
        console.log(
          `Chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(missingToDownload.length / CHUNK_SIZE)}: downloaded ${chunk.length} items`,
        );
      } catch (err) {
        try {
          await fs.unlink(tmpConfigPath);
        } catch {}
        console.warn(
          `Chunk ${Math.floor(i / CHUNK_SIZE) + 1} experienced error, retrying individual items...`,
        );
        for (const item of chunk) {
          try {
            await execFileAsync("curl", [
              "-s",
              item.sourceUrl,
              "-o",
              item.filePath,
              "--retry",
              "2",
            ]);
          } catch {
            const fallback = await downloadWithFetch(item.sourceUrl, item.filePath);
            if (!fallback.ok) {
              failedCount++;
              missing.push({
                sourceUrl: item.sourceUrl,
                localPath: item.localPath,
                status: fallback.status || 0,
                error: fallback.error,
              });
              console.error(`FAILED: ${item.sourceUrl} (${fallback.error})`);
            }
          }
        }
      }
    }
  }

  console.log("\n=== Step 3: Verifying Files & Generating Media Manifest ===");
  const manifestAssets = [];
  let totalBytes = 0;

  for (const item of itemsToProcess) {
    try {
      const st = await fs.stat(item.filePath);
      if (st.size > 0) {
        const buf = await fs.readFile(item.filePath);
        const sha256 = computeSha256(buf);
        const mimeType = getMimeType(item.filePath);
        totalBytes += st.size;
        downloadedCount++;

        manifestAssets.push({
          sourceUrl: item.sourceUrl,
          localPath: item.localPath,
          filePath: path.relative(PROJECT_ROOT, item.filePath),
          mimeType,
          fileSize: st.size,
          sha256,
          status: 200,
        });
      } else {
        missing.push({
          sourceUrl: item.sourceUrl,
          localPath: item.localPath,
          status: 0,
          error: "Zero byte file",
        });
      }
    } catch (err) {
      missing.push({
        sourceUrl: item.sourceUrl,
        localPath: item.localPath,
        status: 404,
        error: err.message,
      });
    }
  }

  manifestAssets.sort((a, b) => a.localPath.localeCompare(b.localPath));

  const manifestData = {
    generatedAt: new Date().toISOString(),
    totalAssets: manifestAssets.length,
    totalBytes,
    missingCount: missing.length,
    missing,
    assets: manifestAssets,
  };

  await fs.mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifestData, null, 2), "utf8");
  console.log(
    `Wrote media manifest with ${manifestAssets.length} verified entries (${(totalBytes / (1024 * 1024)).toFixed(2)} MB) to ${path.relative(PROJECT_ROOT, MANIFEST_PATH)}`,
  );
  if (missing.length > 0) {
    console.warn(`WARNING: ${missing.length} missing media files detected!`);
  } else {
    console.log("Zero missing media files detected! All assets verified.");
  }

  console.log("\n=== Step 4: Rewriting Content Paths in Markdown Files ===");
  const updatedFiles = await processAllContentFiles();
  console.log(
    `Updated content paths in ${updatedFiles} markdown files in content/posts and content/pages`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((err) => {
    console.error("Download media script failed:", err);
    process.exit(1);
  });
}
