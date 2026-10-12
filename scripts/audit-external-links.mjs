import fs from "node:fs/promises";
import path from "node:path";

const POSTS_DIR = path.resolve("content/posts");
const PAGES_DIR = path.resolve("content/pages");
const REPORT_FILE = path.resolve("scripts/external-links-audit.json");

async function extractExternalResources(dir) {
  const files = await fs.readdir(dir);
  const items = [];
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const content = await fs.readFile(path.join(dir, file), "utf8");

    // Extract href attributes
    const hrefRegex = /href=["'](https?:\/\/[^"']+)["']/gi;
    let match;
    while ((match = hrefRegex.exec(content)) !== null) {
      const rawUrl = match[1];
      const url = rawUrl.replace(/&amp;/g, "&");
      if (!url.includes("dustinsview.com") && !url.includes("localhost")) {
        items.push({ file, type: "href", rawUrl, url });
      }
    }

    // Extract src attributes (embedded resources like images/media)
    const srcRegex = /src=["'](https?:\/\/[^"']+)["']/gi;
    while ((match = srcRegex.exec(content)) !== null) {
      const rawUrl = match[1];
      const url = rawUrl.replace(/&amp;/g, "&");
      if (!url.includes("dustinsview.com") && !url.includes("localhost")) {
        items.push({ file, type: "src", rawUrl, url });
      }
    }
  }
  return items;
}

async function checkUrl(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: controller.signal,
      redirect: "follow",
    }).catch((err) => ({ error: err }));
    clearTimeout(timeout);

    if (res.error) {
      const errMsg = res.error.message || String(res.error);
      const isDnsError = errMsg.includes("ENOTFOUND") || errMsg.includes("EAI_AGAIN");
      const isTlsError = errMsg.includes("CERT") || errMsg.includes("TLS");
      const isTimeout =
        res.error.name === "AbortError" || errMsg.includes("timeout") || errMsg.includes("aborted");

      let classification = "indeterminate";
      if (isDnsError) classification = "confirmedDead";

      return {
        url,
        status: "FETCH_ERROR",
        classification,
        errorDetail: errMsg,
        isDnsError,
        isTlsError,
        isTimeout,
      };
    }

    const status = res.status;
    let classification = "other";
    if (status >= 200 && status < 400) {
      classification = "healthy";
    } else if (status === 404 || status === 410) {
      classification = "confirmedDead";
    } else if (status === 401 || status === 403 || status === 429) {
      classification = "protectedOrRateLimited";
    } else {
      classification = "indeterminate";
    }

    return { url, status, classification, ok: res.ok };
  } catch (err) {
    const errMsg = err.message || String(err);
    const isDnsError = errMsg.includes("ENOTFOUND") || errMsg.includes("EAI_AGAIN");
    return {
      url,
      status: "EXCEPTION",
      classification: isDnsError ? "confirmedDead" : "indeterminate",
      errorDetail: errMsg,
    };
  }
}

async function main() {
  console.log("--- Auditing External Resources & Outbound Links ---");
  const postItems = await extractExternalResources(POSTS_DIR);
  const pageItems = await extractExternalResources(PAGES_DIR);
  const allItems = [...postItems, ...pageItems];
  console.log(
    `Found ${allItems.length} total external resource/link references across posts and pages.`,
  );

  const uniqueUrls = Array.from(new Set(allItems.map((l) => l.url)));
  console.log(`Checking ${uniqueUrls.length} unique external URLs in parallel batches...`);

  const results = [];
  const concurrency = 10;
  for (let i = 0; i < uniqueUrls.length; i += concurrency) {
    const batch = uniqueUrls.slice(i, i + concurrency);
    const batchRes = await Promise.all(batch.map(checkUrl));
    results.push(...batchRes);
    process.stdout.write(
      `Checked ${Math.min(i + concurrency, uniqueUrls.length)}/${uniqueUrls.length}...\n`,
    );
  }

  const confirmedDead = results.filter((r) => r.classification === "confirmedDead");
  const indeterminate = results.filter((r) => r.classification === "indeterminate");
  const protectedOrRateLimited = results.filter(
    (r) => r.classification === "protectedOrRateLimited",
  );
  const healthy = results.filter((r) => r.classification === "healthy");

  console.log(`\nAudit Summary:`);
  console.log(`- Total Unique URLs: ${uniqueUrls.length}`);
  console.log(`- Healthy (2xx/3xx): ${healthy.length}`);
  console.log(`- Protected / Rate-Limited (401/403/429): ${protectedOrRateLimited.length}`);
  console.log(`- Confirmed Dead (404/410/DNS ENOTFOUND): ${confirmedDead.length}`);
  console.log(`- Indeterminate (TLS/Timeout/Transient): ${indeterminate.length}`);

  const report = {
    auditDate: new Date().toISOString(),
    totalReferences: allItems.length,
    uniqueUrls: uniqueUrls.length,
    summary: {
      healthy: healthy.length,
      protectedOrRateLimited: protectedOrRateLimited.length,
      confirmedDead: confirmedDead.length,
      indeterminate: indeterminate.length,
    },
    confirmedDeadUrls: confirmedDead.map((d) => ({
      url: d.url,
      status: d.status,
      errorDetail: d.errorDetail || null,
      occurrences: allItems
        .filter((l) => l.url === d.url)
        .map((l) => ({ file: l.file, type: l.type })),
    })),
    indeterminateUrls: indeterminate.map((d) => ({
      url: d.url,
      status: d.status,
      errorDetail: d.errorDetail || null,
      occurrences: allItems
        .filter((l) => l.url === d.url)
        .map((l) => ({ file: l.file, type: l.type })),
    })),
    allResults: results,
  };

  await fs.writeFile(REPORT_FILE, JSON.stringify(report, null, 2), "utf8");
  console.log(`Audit report written to ${REPORT_FILE}`);
}

main().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});
