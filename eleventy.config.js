import { parseFragment, serialize } from "parse5";
import fs from "fs";
import { DateTime } from "luxon";

const categoriesJson = JSON.parse(fs.readFileSync("src/_data/categories.json", "utf8"));
const tagsJson = JSON.parse(fs.readFileSync("src/_data/tags.json", "utf8"));
const categoryNameBySlug = new Map(categoriesJson.map((c) => [c.slug, c.name]));
const tagNameBySlug = new Map(tagsJson.map((t) => [t.slug, t.name]));

export default function (eleventyConfig) {
  // Passthrough copy
  eleventyConfig.addPassthroughCopy({ public: "/" });
  eleventyConfig.addPassthroughCopy({ "src/css": "css" });

  // Ignores
  eleventyConfig.ignores.add("README.md");
  eleventyConfig.ignores.add("PLAN.md");
  eleventyConfig.ignores.add("deploy.md");
  eleventyConfig.ignores.add("backup/**");
  eleventyConfig.ignores.add("scripts/**");

  // The first image in <main> is usually the LCP element: load it eagerly at high
  // priority instead of the lazy loading WordPress applied to every image.
  eleventyConfig.addTransform("eager-first-image", function (content) {
    if (!this.page.outputPath?.endsWith(".html")) return content;
    const mainAt = content.indexOf("<main");
    if (mainAt === -1) return content;
    const imgAt = content.indexOf("<img", mainAt);
    if (imgAt === -1) return content;
    const tagEnd = content.indexOf(">", imgAt);
    const tag = content.slice(imgAt, tagEnd);
    if (!/\sloading=["']lazy["']/.test(tag)) return content;
    const eager = tag
      .replace(/\sloading=["']lazy["']/, "")
      .replace(/^<img/, '<img fetchpriority="high"');
    return content.slice(0, imgAt) + eager + content.slice(tagEnd);
  });

  // Date filters
  eleventyConfig.addFilter("readableDate", (dateObj, format = "LLLL d, yyyy") => {
    if (!dateObj) return "";
    const dt =
      typeof dateObj === "string"
        ? DateTime.fromISO(dateObj, { zone: "utc" })
        : DateTime.fromJSDate(dateObj, { zone: "utc" });
    return dt.isValid ? dt.toFormat(format) : String(dateObj);
  });

  eleventyConfig.addFilter("isoDate", (dateObj) => {
    if (!dateObj) return "";
    const dt =
      typeof dateObj === "string"
        ? DateTime.fromISO(dateObj, { zone: "utc" })
        : DateTime.fromJSDate(dateObj, { zone: "utc" });
    return dt.isValid ? dt.toISODate() : String(dateObj);
  });

  eleventyConfig.addFilter("dateToRfc822", (dateObj) => {
    if (!dateObj) return "";
    const dt =
      typeof dateObj === "string"
        ? DateTime.fromISO(dateObj, { zone: "utc" })
        : DateTime.fromJSDate(dateObj, { zone: "utc" });
    return dt.isValid ? dt.toRFC2822() : new Date().toUTCString();
  });

  // Array slicing helper
  eleventyConfig.addFilter("head", (array, n) => {
    if (!Array.isArray(array)) return [];
    return n < 0 ? array.slice(n) : array.slice(0, n);
  });

  // Taxonomy name lookups
  eleventyConfig.addFilter("categoryName", (slug) => {
    return categoryNameBySlug.get(slug) || slug;
  });

  eleventyConfig.addFilter("tagName", (slug) => {
    return tagNameBySlug.get(slug) || slug;
  });

  // Post teaser filter: renders content up to <!--more--> with a "Continue reading..." link,
  // or renders the full content if no <!--more--> tag is present.
  eleventyConfig.addFilter("postTeaser", (post) => {
    if (!post) return "";
    const rawHtml = post.templateContent || "";
    const postUrl = post.url || "";
    const postTitle = post.data?.title || "";
    // Scope intra-post fragments (e.g. footnotes) so clicking them on index/archive pages navigates to the post
    const html = postUrl ? rawHtml.replace(/href="#([^"]+)"/g, `href="${postUrl}#$1"`) : rawHtml;
    const match = /<!--more(.*?)?-->/.exec(html);
    if (!match) {
      return html;
    }
    const teaser = html.slice(0, match.index);
    const link = `<a href="${postUrl}" class="more-link">Continue reading <span class="screen-reader-text">&ldquo;${postTitle}&rdquo;</span> <span class="meta-nav">&rarr;</span></a>`;
    const glue = teaser.endsWith("<p>") || teaser.endsWith(" ") ? "" : " ";
    const frag = parseFragment(teaser + glue + link);
    return serialize(frag);
  });

  // Collections
  // Chronological posts (oldest first) so getPreviousCollectionItem = older, getNextCollectionItem = newer
  eleventyConfig.addCollection("posts", (collectionApi) => {
    return collectionApi.getFilteredByGlob("content/posts/*.md").sort((a, b) => {
      return new Date(a.data.date) - new Date(b.data.date);
    });
  });

  // Reverse chronological posts (newest first)
  eleventyConfig.addCollection("postsReverse", (collectionApi) => {
    return collectionApi.getFilteredByGlob("content/posts/*.md").sort((a, b) => {
      return new Date(b.data.date) - new Date(a.data.date);
    });
  });

  // Year list collection: [{ year: "2018", posts: [...] }, ...]
  eleventyConfig.addCollection("yearList", (collectionApi) => {
    const posts = collectionApi.getFilteredByGlob("content/posts/*.md").sort((a, b) => {
      return new Date(b.data.date) - new Date(a.data.date);
    });
    const yearsMap = new Map();
    for (const post of posts) {
      const year = DateTime.fromISO(post.data.date, { zone: "utc" }).toFormat("yyyy");
      if (!yearsMap.has(year)) {
        yearsMap.set(year, []);
      }
      yearsMap.get(year).push(post);
    }
    const result = [];
    for (const [year, yearPosts] of yearsMap.entries()) {
      result.push({ year, posts: yearPosts });
    }
    return result.sort((a, b) => b.year.localeCompare(a.year));
  });

  // Category list collection: [{ name: "EuroTrip2016", slug: "eurotrip2016", posts: [...] }, ...]
  eleventyConfig.addCollection("categoryList", (collectionApi) => {
    const posts = collectionApi.getFilteredByGlob("content/posts/*.md").sort((a, b) => {
      return new Date(b.data.date) - new Date(a.data.date);
    });
    const catMap = new Map();
    for (const post of posts) {
      const cats = post.data.categories || [];
      const slugs = post.data.categorySlugs || [];
      for (let i = 0; i < slugs.length; i++) {
        const slug = slugs[i];
        const rawCat = cats[i];
        const name =
          categoryNameBySlug.get(slug) ||
          (typeof rawCat === "object" && rawCat !== null ? rawCat.name : rawCat) ||
          slug;
        if (!catMap.has(slug)) {
          catMap.set(slug, { name, slug, posts: [] });
        }
        catMap.get(slug).posts.push(post);
      }
    }
    return Array.from(catMap.values()).sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || "")),
    );
  });

  // Tag list collection (filtering out tags with 0 posts): [{ name: "Carleton", slug: "carleton", posts: [...] }, ...]
  eleventyConfig.addCollection("tagList", (collectionApi) => {
    const posts = collectionApi.getFilteredByGlob("content/posts/*.md").sort((a, b) => {
      return new Date(b.data.date) - new Date(a.data.date);
    });
    const tagMap = new Map();
    for (const post of posts) {
      const tags = post.data.tags || [];
      const slugs = post.data.tagSlugs || [];
      for (let i = 0; i < slugs.length; i++) {
        const slug = slugs[i];
        const rawTag = tags[i];
        const name =
          tagNameBySlug.get(slug) ||
          (typeof rawTag === "object" && rawTag !== null ? rawTag.name : rawTag) ||
          slug;
        if (!tagMap.has(slug)) {
          tagMap.set(slug, { name, slug, posts: [] });
        }
        tagMap.get(slug).posts.push(post);
      }
    }
    return Array.from(tagMap.values())
      .filter((t) => t.posts.length > 0)
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  });

  return {
    dir: {
      input: ".",
      includes: "src/_includes",
      data: "src/_data",
      output: "_site",
    },
    templateFormats: ["md", "njk", "html"],
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
