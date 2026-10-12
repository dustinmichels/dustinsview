import fs from "node:fs/promises";
import path from "node:path";

const BASE_URL = "https://dustinsview.com";

const SITEMAPS = [
  "wp-sitemap.xml",
  "wp-sitemap-posts-post-1.xml",
  "wp-sitemap-posts-page-1.xml",
  "wp-sitemap-taxonomies-category-1.xml",
  "wp-sitemap-taxonomies-post_tag-1.xml",
  "wp-sitemap-users-1.xml",
];

async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.text();
    } catch (err) {
      if (i === retries - 1) throw err;
      console.warn(`Retry ${i + 1}/${retries} for ${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

function extractLocs(xml) {
  const locs = [];
  const regex = /<loc>(https?:\/\/[^<]+)<\/loc>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    locs.push(match[1].trim());
  }
  return locs;
}

async function main() {
  const sitemapDir = path.resolve("backup/sitemaps");
  await fs.mkdir(sitemapDir, { recursive: true });

  const sitemapUrls = new Map();

  for (const sm of SITEMAPS) {
    const url = `${BASE_URL}/${sm}`;
    console.log(`Downloading sitemap: ${url}...`);
    const xml = await fetchWithRetry(url);
    await fs.writeFile(path.join(sitemapDir, sm), xml, "utf8");

    const locs = extractLocs(xml);
    console.log(`  Parsed ${locs.length} URLs from ${sm}`);
    sitemapUrls.set(sm, locs);
  }

  // Load snapshot data
  const posts = JSON.parse(await fs.readFile("backup/wp-raw-snapshot/posts.json", "utf8"));
  const pages = JSON.parse(await fs.readFile("backup/wp-raw-snapshot/pages.json", "utf8"));
  const categories = JSON.parse(
    await fs.readFile("backup/wp-raw-snapshot/categories.json", "utf8"),
  );
  const tags = JSON.parse(await fs.readFile("backup/wp-raw-snapshot/tags.json", "utf8"));
  const users = JSON.parse(await fs.readFile("backup/wp-raw-snapshot/users.json", "utf8"));

  const masterInventory = [];
  const seenPaths = new Set();

  function addRoute(entry) {
    const normPath = entry.path.startsWith("/") ? entry.path : "/" + entry.path;
    const key = `${entry.routeType}:${normPath}`;
    if (!seenPaths.has(key)) {
      seenPaths.add(key);
      masterInventory.push({
        ...entry,
        path: normPath,
        url: entry.url || `${BASE_URL}${normPath}`,
      });
    }
  }

  // 1. Root and Home Pagination
  addRoute({
    path: "/",
    routeType: "home",
    statusCode: 200,
    source: "sitemap",
    notes: "Home page / recent posts index",
  });
  for (let p = 2; p <= 5; p++) {
    addRoute({
      path: `/page/${p}/`,
      routeType: "pagination",
      statusCode: 200,
      source: "crawl",
      notes: `Home paginated archive page ${p}`,
    });
  }
  // Historical /page/1/ redirect
  addRoute({
    path: "/page/1/",
    routeType: "pagination",
    statusCode: 301,
    target: "/",
    source: "crawl",
    notes: "Home page 1 redirects to /",
  });

  // 2. Standalone Pages
  for (const page of pages) {
    const pPath = new URL(page.link).pathname;
    addRoute({
      path: pPath,
      routeType: "page",
      statusCode: 200,
      target: pPath,
      source: "rest_api & sitemap",
      wordpressId: page.id,
      slug: page.slug,
      title: page.title.rendered,
    });
    // Query permalink for page
    addRoute({
      path: `/?page_id=${page.id}`,
      routeType: "query_url",
      statusCode: 301,
      target: pPath,
      source: "historical_query",
      wordpressId: page.id,
    });
  }

  // 3. Posts
  for (const post of posts) {
    const pPath = new URL(post.link).pathname;
    addRoute({
      path: pPath,
      routeType: "post",
      statusCode: 200,
      target: pPath,
      source: "rest_api & sitemap",
      wordpressId: post.id,
      slug: post.slug,
      title: post.title.rendered,
      date: post.date,
    });
    // Query permalink for post
    addRoute({
      path: `/?p=${post.id}`,
      routeType: "query_url",
      statusCode: 301,
      target: pPath,
      source: "historical_query",
      wordpressId: post.id,
    });
  }

  // 4. Categories & Category Pagination
  for (const cat of categories) {
    const cPath = new URL(cat.link).pathname;
    addRoute({
      path: cPath,
      routeType: "category",
      statusCode: cat.count > 0 ? 200 : 200,
      source: "rest_api & sitemap",
      termId: cat.id,
      slug: cat.slug,
      name: cat.name,
      postCount: cat.count,
    });
    // Feed endpoint for category
    addRoute({
      path: `${cPath}feed/`,
      routeType: "feed",
      statusCode: 200,
      source: "standard_wp",
      notes: `RSS feed for category ${cat.name}`,
    });

    // Pagination for category 'all' (35 posts = 4 pages)
    if (cat.slug === "all") {
      for (let p = 2; p <= 4; p++) {
        addRoute({
          path: `${cPath}page/${p}/`,
          routeType: "pagination",
          statusCode: 200,
          source: "crawl",
          notes: `Category all paginated archive page ${p}`,
        });
      }
    }
  }

  // 5. Tags & Tag Pagination
  for (const tag of tags) {
    const tPath = new URL(tag.link).pathname;
    addRoute({
      path: tPath,
      routeType: "tag",
      statusCode: 200,
      source: "rest_api & sitemap",
      termId: tag.id,
      slug: tag.slug,
      name: tag.name,
      postCount: tag.count,
    });
    // Tag feed
    addRoute({
      path: `${tPath}feed/`,
      routeType: "feed",
      statusCode: 200,
      source: "standard_wp",
      notes: `RSS feed for tag ${tag.name}`,
    });

    // Tag 'environment' has 12 posts = 2 pages
    if (tag.slug === "environment") {
      addRoute({
        path: `${tPath}page/2/`,
        routeType: "pagination",
        statusCode: 200,
        source: "crawl",
        notes: "Tag environment paginated archive page 2",
      });
    }
  }

  // 6. Author routes
  for (const user of users) {
    const aPath = new URL(user.link).pathname;
    addRoute({
      path: aPath,
      routeType: "author",
      statusCode: 200,
      source: "rest_api & sitemap",
      authorId: user.id,
      name: user.name,
      slug: user.slug,
    });
    for (let p = 2; p <= 5; p++) {
      addRoute({
        path: `${aPath}page/${p}/`,
        routeType: "pagination",
        statusCode: 200,
        source: "crawl",
        notes: `Author paginated archive page ${p}`,
      });
    }
    addRoute({
      path: `${aPath}feed/`,
      routeType: "feed",
      statusCode: 200,
      source: "standard_wp",
      notes: `RSS feed for author ${user.name}`,
    });
  }

  // 7. Year & Month Archives
  const years = [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018];
  for (const y of years) {
    addRoute({
      path: `/${y}/`,
      routeType: "year_archive",
      statusCode: 200,
      source: "crawl",
      year: y,
    });
  }
  // 2016 paginated year archive
  addRoute({
    path: "/2016/page/2/",
    routeType: "pagination",
    statusCode: 200,
    source: "crawl",
    year: 2016,
    notes: "2016 year archive page 2",
  });

  // Month archives
  const yearMonths = new Set();
  for (const post of posts) {
    const d = new Date(post.date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    yearMonths.add(`${y}/${m}`);
  }
  for (const ym of [...yearMonths].sort()) {
    addRoute({
      path: `/${ym}/`,
      routeType: "month_archive",
      statusCode: 200,
      source: "crawl",
      yearMonth: ym,
    });
  }

  // 8. Feed endpoints
  const feedRoutes = [
    { path: "/feed/", statusCode: 200, notes: "Main RSS2 feed" },
    { path: "/rss/", statusCode: 301, target: "/feed/", notes: "Legacy RSS feed redirect" },
    { path: "/atom/", statusCode: 301, target: "/feed/", notes: "Legacy Atom feed redirect" },
    { path: "/feed/rss/", statusCode: 301, target: "/feed/", notes: "RSS redirect" },
    { path: "/feed/rss2/", statusCode: 301, target: "/feed/", notes: "RSS2 redirect" },
    { path: "/feed/atom/", statusCode: 200, notes: "Atom feed" },
    { path: "/comments/feed/", statusCode: 200, notes: "Comments RSS feed" },
  ];
  for (const f of feedRoutes) {
    addRoute({
      ...f,
      routeType: "feed",
      source: "crawl & standard_wp",
    });
  }

  // 9. Crawled Content Links (Attachment pages & legacy redirects)
  const crawledDiscovered = [
    {
      path: "/all/biology-a-quick-lesson-on-cells-cartoon/attachment/img133/",
      target: "/2016/biology-a-quick-lesson-on-cells-cartoon/",
      routeType: "attachment",
    },
    {
      path: "/all/daily-camera-stop-propagating-climate-change-denial/attachment/earth/",
      target: "/2016/daily-camera-stop-propagating-climate-change-denial/",
      routeType: "attachment",
    },
    {
      path: "/all/insult-absurdity-make-america-great/attachment/hat/",
      target: "/2017/insult-absurdity-make-america-great/",
      routeType: "attachment",
    },
    {
      path: "/all/made-bernie-things/attachment/11167804_464585873698267_1888080400337553208_n/",
      target: "/2016/made-bernie-things/",
      routeType: "attachment",
    },
    {
      path: "/all/made-bernie-things/attachment/12657278_10205319627141313_2465876425985884890_o/",
      target: "/2016/made-bernie-things/",
      routeType: "attachment",
    },
    {
      path: "/all/made-bernie-things/attachment/the_future/",
      target: "/2016/made-bernie-things/",
      routeType: "attachment",
    },
    {
      path: "/all/myth-conscientious-consumption/attachment/recycle/",
      target: "/2016/myth-conscientious-consumption/",
      routeType: "attachment",
    },
    {
      path: "/all/pooping-with-java/attachment/java/",
      target: "/2015/pooping-with-java/",
      routeType: "attachment",
    },
    {
      path: "/all/the-joy-of-cycling/attachment/sony-dsc/",
      target: "/2016/the-joy-of-cycling/",
      routeType: "attachment",
    },
    {
      path: "/all/the-magnetic-house-of-cards/attachment/house_cards/",
      target: "/2016/the-magnetic-house-of-cards/",
      routeType: "attachment",
    },
    {
      path: "/eurotrip2016/little-differences-observations-europe/attachment/bike/",
      target: "/2016/little-differences-observations-europe/",
      routeType: "attachment",
    },
    {
      path: "/eurotrip2016/little-differences-observations-europe/attachment/cream_tea_img/",
      target: "/2016/little-differences-observations-europe/",
      routeType: "attachment",
    },
    {
      path: "/eurotrip2016/little-differences-observations-europe/attachment/img_2599/",
      target: "/2016/little-differences-observations-europe/",
      routeType: "attachment",
    },
    {
      path: "/eurotrip2016/little-differences-observations-europe/attachment/kalles_img/",
      target: "/2016/little-differences-observations-europe/",
      routeType: "attachment",
    },
    {
      path: "/eurotrip2016/little-differences-observations-europe/attachment/nutella/",
      target: "/2016/little-differences-observations-europe/",
      routeType: "attachment",
    },
    {
      path: "/eurotrip2016/little-differences-observations-europe/attachment/swedish_binder_img/",
      target: "/2016/little-differences-observations-europe/",
      routeType: "attachment",
    },
    {
      path: "/perspective/songs-of-peaceful-resignation/attachment/%c2%80i/",
      target: "/2013/songs-of-peaceful-resignation/",
      routeType: "attachment",
    },
    {
      path: "/book-review/wit-and-wisdom-in-the-monkey-wrench-gang/",
      target: "/2014/wit-and-wisdom-in-the-monkey-wrench-gang/",
      routeType: "redirect",
      statusCode: 301,
    },
    {
      path: "/review/slaughterhouse-five-and-reflections-on-destiny/",
      target: "/2013/slaughterhouse-five-and-reflections-on-destiny/",
      routeType: "redirect",
      statusCode: 301,
    },
  ];
  for (const c of crawledDiscovered) {
    addRoute({
      ...c,
      source: "crawl_content",
    });
  }

  // 10. Sitemap files themselves
  for (const sm of SITEMAPS) {
    addRoute({
      path: `/${sm}`,
      routeType: "sitemap",
      statusCode: 200,
      source: "sitemap",
    });
  }

  // 11. Legacy WP admin / api endpoints
  const obsoleteEndpoints = [
    { path: "/wp-admin/", statusCode: 302, notes: "Admin login redirect" },
    { path: "/wp-login.php", statusCode: 200, notes: "Login page" },
    { path: "/wp-json/", statusCode: 200, notes: "REST API index" },
    { path: "/xmlrpc.php", statusCode: 405, notes: "XML-RPC endpoint" },
  ];
  for (const o of obsoleteEndpoints) {
    addRoute({
      ...o,
      routeType: "admin_api",
      source: "wp_core",
    });
  }

  // Write out inventory-routes.json
  const manifest = {
    generatedAt: new Date().toISOString(),
    totalRoutes: masterInventory.length,
    countsByType: masterInventory.reduce((acc, r) => {
      acc[r.routeType] = (acc[r.routeType] || 0) + 1;
      return acc;
    }, {}),
    routes: masterInventory,
  };

  await fs.writeFile("inventory-routes.json", JSON.stringify(manifest, null, 2), "utf8");

  console.log("\nMaster Route Inventory Generated: inventory-routes.json");
  console.log(`Total Routes: ${manifest.totalRoutes}`);
  console.table(manifest.countsByType);
}

main().catch((err) => {
  console.error("Error generating inventory:", err);
  process.exit(1);
});
