import fs from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = 'https://dustinsview.com';
const TODAY = '2026-10-12';

const ENDPOINTS = [
  { name: 'posts', path: '/wp-json/wp/v2/posts?per_page=100&status=publish' },
  { name: 'pages', path: '/wp-json/wp/v2/pages?per_page=100&status=publish' },
  { name: 'media', path: '/wp-json/wp/v2/media?per_page=100' },
  { name: 'categories', path: '/wp-json/wp/v2/categories?per_page=100' },
  { name: 'tags', path: '/wp-json/wp/v2/tags?per_page=100' },
  { name: 'users', path: '/wp-json/wp/v2/users' },
  { name: 'comments', path: '/wp-json/wp/v2/comments?per_page=100' },
];

async function fetchWithRetry(url, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; dustinsview-archiver/1.0)',
        },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
      }
      return res;
    } catch (err) {
      if (i === retries - 1) throw err;
      console.warn(`Retry ${i + 1}/${retries} for ${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

async function fetchAllPages(endpoint) {
  const allItems = [];
  const rawPages = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const url = new URL(endpoint.path, BASE_URL);
    if (!url.searchParams.has('page') && endpoint.path.includes('per_page=')) {
      url.searchParams.set('page', String(page));
    }

    console.log(`Fetching ${endpoint.name} (page ${page})...`);
    const res = await fetchWithRetry(url.toString());
    const headerTotalPages = res.headers.get('x-wp-totalpages');
    if (headerTotalPages) {
      totalPages = parseInt(headerTotalPages, 10);
    }
    const headerTotal = res.headers.get('x-wp-total');

    const json = await res.json();
    rawPages.push({ page, data: json });

    if (Array.isArray(json)) {
      allItems.push(...json);
    } else {
      allItems.push(json);
    }

    console.log(`  Fetched page ${page}/${totalPages} for ${endpoint.name}: got ${Array.isArray(json) ? json.length : 1} items (total header: ${headerTotal || 'N/A'})`);

    if (!endpoint.path.includes('per_page=')) {
      break;
    }
    page++;
  }

  return { allItems, rawPages };
}

async function main() {
  const datedDir = path.resolve('backup/wp-raw-snapshot', TODAY);
  const rootDir = path.resolve('backup/wp-raw-snapshot');

  await fs.mkdir(datedDir, { recursive: true });

  const summary = {};

  for (const ep of ENDPOINTS) {
    const { allItems, rawPages } = await fetchAllPages(ep);
    summary[ep.name] = allItems.length;

    // Save combined aggregated file
    const combinedJson = JSON.stringify(allItems, null, 2);
    await fs.writeFile(path.join(datedDir, `${ep.name}.json`), combinedJson, 'utf8');
    await fs.writeFile(path.join(rootDir, `${ep.name}.json`), combinedJson, 'utf8');

    // Save individual raw page snapshots
    for (const rp of rawPages) {
      const pageJson = JSON.stringify(rp.data, null, 2);
      await fs.writeFile(path.join(datedDir, `${ep.name}-page-${rp.page}.json`), pageJson, 'utf8');
      await fs.writeFile(path.join(rootDir, `${ep.name}-page-${rp.page}.json`), pageJson, 'utf8');
    }
  }

  console.log('\nSnapshot Complete Summary:');
  console.table(summary);
}

main().catch((err) => {
  console.error('Snapshot failed:', err);
  process.exit(1);
});
