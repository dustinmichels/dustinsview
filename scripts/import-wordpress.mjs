import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { parseFragment, serialize } from 'parse5';

const SNAPSHOT_DIR = path.resolve('backup/wp-raw-snapshot');
const POSTS_OUT_DIR = path.resolve('content/posts');
const PAGES_OUT_DIR = path.resolve('content/pages');
const DATA_OUT_DIR = path.resolve('src/_data');
// YouTube videos deleted since publication (oEmbed returns 404; checked 2026-10-12).
// Their embeds are replaced with a visible "no longer available" notice.
const REMOVED_YOUTUBE_IDS = new Set(['Zza3GqEL5B0']);

// HTML entity decoder supporting named and numeric entities
export function decodeHtmlEntities(str) {
  if (!str) return '';
  const named = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&apos;': "'",
    '&nbsp;': ' ',
    '&hellip;': '…',
    '&rarr;': '→',
    '&mdash;': '—',
    '&ndash;': '–',
    '&lsquo;': '‘',
    '&rsquo;': '’',
    '&ldquo;': '“',
    '&rdquo;': '”',
    '&copy;': '©',
    '&reg;': '®',
    '&trade;': '™',
    '&#038;': '&',
    '&#039;': "'",
  };
  return str
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&[a-zA-Z0-9#]+;/g, m => named[m] !== undefined ? named[m] : m);
}

// Convert HTML excerpt into clean plain text
export function cleanExcerpt(rawHtml) {
  if (!rawHtml) return '';
  // Remove "Continue reading..." more links
  let text = rawHtml.replace(/<a\s+class="more-link"[\s\S]*?<\/a>/gi, '');
  // Remove any remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Decode HTML entities
  text = decodeHtmlEntities(text);
  // Normalize whitespace
  return text.replace(/\s+/g, ' ').trim();
}

// Clean redundant WordPress inline styles and unused utility classes
export function cleanHtmlBody(html, postId = null, footnotesCache = {}) {
  let cleaned = html;

  // 1. Normalize heading levels (h1 -> h2 in post content since article title is h1)
  cleaned = cleaned.replace(/<h1(\b[^>]*)>/gi, '<h2$1>').replace(/<\/h1>/gi, '</h2>');

  // 2. Convert collapseomatic accordion to semantic HTML5 <details>
  const collapseRegex = /<span\s+class="collapseomatic\s*"\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/span>\s*<div\s+id="target-\1"\s+class="collapseomatic_content\s*">([\s\S]*?)<\/div>/gi;
  cleaned = cleaned.replace(collapseRegex, (_, id, summary, content) => {
    return `<details class="collapse-details">\n<summary>${summary.trim()}</summary>\n${content.trim()}\n</details>`;
  });

  // 3. Clean redundant Google Docs and WordPress inline styles
  const redundantStyles = [
    /font-weight:\s*400;?/gi,
    /background-color:\s*transparent;?/gi,
    /color:\s*black;?/gi,
    /font-style:\s*normal;?/gi,
    /font-weight:\s*normal;?/gi,
    /text-decoration:\s*none;?/gi,
    /vertical-align:\s*baseline;?/gi,
    /white-space:\s*pre-wrap;?/gi,
    /list-style-type:\s*disc;?/gi,
    /font-family:\s*Arial,\s*Helvetica,\s*sans-serif;?/gi,
    /font-family:\s*Verdana,\s*Arial,\s*Helvetica,\s*sans-serif;?/gi,
    /font-family:\s*Verdana;?/gi,
    /background-image:\s*none;?/gi,
  ];

  redundantStyles.forEach(re => {
    cleaned = cleaned.replace(re, '');
  });

  // Clean empty style attributes style="" or style=" " or style=";"
  cleaned = cleaned.replace(/\s*style=["']\s*;?\s*["']/gi, '');

  // 4. Normalize absolute in-page footnote links: href='https://dustinsview.com/.../#easy-footnote-bottom...' -> href='#easy-footnote-bottom...'
  cleaned = cleaned.replace(/href=["']https?:\/\/dustinsview\.com\/[^"']*?(#easy-footnote-[^"']+)["']/gi, 'href="$1"');

  // 5. Append bottom footnotes list if available in cache and present in post
  if (postId && footnotesCache[postId] && !cleaned.includes('easy-footnotes-wrapper')) {
    cleaned = cleaned.trim() + '\n\n' + footnotesCache[postId].trim();
  }

  // 5b. Easy Footnotes numbers inline markers per render, so the REST content can be
  //     offset (e.g. 11-15) from the cached bottom list (1-5). Renumber inline markers
  //     in order of appearance to match the list.
  const wrapperAt = cleaned.indexOf('easy-footnotes-wrapper');
  if (postId && wrapperAt !== -1) {
    const listStart = cleaned.lastIndexOf('<', wrapperAt);
    const [inline, list] = [cleaned.slice(0, listStart), cleaned.slice(listStart)];
    const idRe = new RegExp(`id=["']easy-footnote-(\\d+)-${postId}["']`, 'g');
    const inlineNums = [...inline.matchAll(idRe)].map(m => m[1]);
    const listNums = [...list.matchAll(new RegExp(`id=["']easy-footnote-bottom-(\\d+)-${postId}["']`, 'g'))].map(m => m[1]);
    if (inlineNums.length === listNums.length && inlineNums.some((n, i) => n !== listNums[i])) {
      const renumber = new Map(inlineNums.map((n, i) => [n, listNums[i]]));
      const fixed = inline
        .replace(
          new RegExp(`(easy-footnote-(?:bottom-)?)(\\d+)(-${postId})`, 'g'),
          (m, prefix, n, suffix) => (renumber.has(n) ? prefix + renumber.get(n) + suffix : m),
        )
        // Visible marker text: <a href="#easy-footnote-bottom-N-ID" ...><sup>N</sup>
        .replace(new RegExp(`(href=["']#easy-footnote-bottom-(\\d+)-${postId}["'][^>]*><sup>)\\d+(</sup>)`, 'g'), '$1$2$3');
      cleaned = fixed + list;
    }
  }

  // 5c. The Easy Footnotes plugin drew its "back to text" arrow with an icon font, leaving
  //     the anchors empty. Give them visible, accessible text.
  cleaned = cleaned.replace(
    /(<a\b[^>]*class=["']easy-footnote-to-top["'][^>]*)><\/a>/gi,
    '$1 aria-label="Back to text">↩</a>',
  );

  // 6. Media path localization and cleanup
  // Remove tracking pixels
  cleaned = cleaned.replace(/<img[^>]*cookies-for-comments[^>]*>/gi, '');
  cleaned = cleaned.replace(/<link[^>]*cookies-for-comments[^>]*>/gi, '');
  cleaned = cleaned.replace(/<script[^>]*cookies-for-comments[^>]*>[\s\S]*?<\/script>/gi, '');
  cleaned = cleaned.replace(/<img[^>]*\b(?:width=["']1["']\s+height=["']1["']|height=["']1["']\s+width=["']1["'])[^>]*>/gi, '');

  // Strip WordPress responsive image srcset and sizes
  cleaned = cleaned.replace(/\s+srcset=(["'])[\s\S]*?\1/gi, '');
  cleaned = cleaned.replace(/\s+sizes=(["'])[\s\S]*?\1/gi, '');

  // Replace dustinsview.com/wp-content/uploads/ with /media/
  cleaned = cleaned.replace(/https?:\/\/(?:www\.)?dustinsview\.com\/wp-content\/uploads\//gi, '/media/');
  // Replace external blogspot spacetime image with local media
  cleaned = cleaned.replace(/https?:\/\/4\.bp\.blogspot\.com\/-lXbGJfz2268\/TbTsE8_NMUI\/AAAAAAAAAXo\/HBhBjVgdZqY\/s1600\/spacetime\.jpg/gi, '/media/spacetime.jpg');
  // Author's chord-sheet PDF, gone from dustinmichels.com; local copy recovered from the
  // Wayback Machine (capture 20220805205010, SHA-1 digest matches the CDX record).
  cleaned = cleaned.replace(/https?:\/\/(?:www\.)?dustinmichels\.com\/lyrics\/make_new_humans_chords\.pdf/gi, '/media/lyrics/make_new_humans_chords.pdf');

  // 7. YouTube embed modernization
  const youtubeIframeRegex = /(?:<p>\s*)?<iframe\b[^>]*\bsrc=["']https?:\/\/(?:www\.)?(?:youtube\.com\/(?:embed\/|watch\?v=)|youtube-nocookie\.com\/embed\/)([a-zA-Z0-9_-]+)[^"']*["'][^>]*><\/iframe>(?:\s*<\/p>)?/gi;
  cleaned = cleaned.replace(youtubeIframeRegex, (_, videoId) => {
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    if (REMOVED_YOUTUBE_IDS.has(videoId)) {
      return `<p class="video-unavailable">[Video no longer available: this YouTube video (<code>${watchUrl}</code>) has been removed.]</p>`;
    }
    return `<div class="video-embed" style="aspect-ratio: 16 / 9; max-width: 100%;">\n  <iframe src="https://www.youtube-nocookie.com/embed/${videoId}" loading="lazy" style="width: 100%; height: 100%; border: 0;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>\n</div>\n<p class="video-fallback"><a href="${watchUrl}" target="_blank" rel="noopener noreferrer">Watch on YouTube: ${watchUrl}</a></p>`;
  });

  // 8. Handle obsolete / broken interactive map iframes (Carto / CartoDB)
  const cartoMapRegex = /(?:<p>\s*)?<iframe\b[^>]*\bsrc=["']https?:\/\/[^"']*(?:cartodb\.com|carto\.com)[^"']*["'][^>]*><\/iframe>(?:\s*<\/p>)?/gi;
  cleaned = cleaned.replace(cartoMapRegex, () => {
    if (postId === 77) {
      return '<p class="archival-notice"><em>[Archival note: The original interactive CartoDB map visualization is no longer available online. A static annotated depiction of the map is preserved below.]</em></p>';
    }
    return '<p class="archival-notice"><em>[Archival note: The original interactive Carto map visualization is no longer available online.]</em></p>';
  });

  return normalizeHtml(cleaned).trim();
}

const isBlankText = node => node.nodeName === '#text' && /^\s*$/.test(node.value);

// WordPress output is not always well-formed: Easy Footnotes markers and Google Docs
// pastes leave unbalanced <span>s, and some old posts have stray </p> tags. Parse the
// body the way a browser does and re-serialize it as balanced markup, then:
// - unwrap attribute-less <span>s (left behind once redundant inline styles are stripped),
// - drop the empty <a name="more"> read-more marker,
// - drop empty paragraphs (including ones the parser creates for stray </p>),
// - promote headings so the body's top level is h2 (the article title is the only h1).
export function normalizeHtml(html) {
  const fragment = parseFragment(html);
  const headings = [];
  const walk = parent => {
    for (let i = 0; i < parent.childNodes.length; i++) {
      const node = parent.childNodes[i];
      if (!node.tagName) continue;
      walk(node);
      const attrs = node.attrs;
      if (node.tagName === 'span' && attrs.length === 0) {
        for (const child of node.childNodes) child.parentNode = parent;
        parent.childNodes.splice(i, 1, ...node.childNodes);
        i += node.childNodes.length - 1;
      } else if (
        (node.tagName === 'a' && attrs.length === 1 && attrs[0].name === 'name' && attrs[0].value === 'more' && node.childNodes.length === 0) ||
        (node.tagName === 'p' && node.childNodes.every(isBlankText))
      ) {
        parent.childNodes.splice(i, 1);
        i--;
      } else if (/^h[1-6]$/.test(node.tagName)) {
        headings.push(node);
      }
    }
  };
  walk(fragment);
  const shift = Math.min(...headings.map(h => Number(h.tagName[1]))) - 2;
  if (shift > 0) {
    for (const h of headings) h.tagName = h.nodeName = `h${Number(h.tagName[1]) - shift}`;
  }
  return serialize(fragment);
}

// Rewrite absolute links to the old site (legacy category-prefixed permalinks and
// attachment pages) to their local equivalents: the post's canonical path, or the
// attachment's archived media file.
export function localizeInternalLinks(html, { postBySlug, mediaBySlug }) {
  return html.replace(/href=(["'])https?:\/\/(?:www\.)?dustinsview\.com(\/[^"']*)\1/gi, (match, quote, urlPath) => {
    const [pathname, hash = ''] = urlPath.split('#');
    const segments = pathname.split('/').filter(Boolean).map(s => decodeURIComponent(s).toLowerCase());
    let target = null;
    const attachmentAt = segments.indexOf('attachment');
    if (attachmentAt !== -1) {
      const media = mediaBySlug.get(segments[attachmentAt + 1]);
      target = media
        ? media.source_url.replace(/^https?:\/\/(?:www\.)?dustinsview\.com\/wp-content\/uploads\//i, '/media/')
        : postBySlug.get(segments[attachmentAt - 1]);
    } else {
      target = postBySlug.get(segments.at(-1)) ?? (pathname.startsWith('/') ? pathname : null);
    }
    return target ? `href=${quote}${target}${hash ? '#' + hash : ''}${quote}` : match;
  });
}

// Clean SiteOrigin panels from Topics page
export function cleanTopicsContent(html) {
  const regex = /<div[^>]*class="[^"]*so-panel[^"]*"[^>]*>\s*<h3 class="widget-title">([^<]+)<\/h3>\s*([\s\S]*?)<\/div>/g;
  const cards = [];
  let match;
  while ((match = regex.exec(html)) !== null) {
    const title = match[1];
    let body = cleanHtmlBody(match[2].trim());
    body = body.replace(/style="[^"]*"/gi, '').trim();
    cards.push(`  <div class="topic-card">\n    <h2>${title}</h2>\n    ${body}\n  </div>`);
  }
  if (cards.length > 0) {
    return `<div class="topics-grid">\n${cards.join('\n')}\n</div>`;
  }
  return cleanHtmlBody(html);
}

async function loadJson(filename) {
  const filePath = path.join(SNAPSHOT_DIR, filename);
  const data = await fs.readFile(filePath, 'utf8');
  return JSON.parse(data);
}

async function main() {
  console.log('--- Starting WordPress Import & Content Normalization ---');

  // Ensure directories exist
  await fs.mkdir(POSTS_OUT_DIR, { recursive: true });
  await fs.mkdir(PAGES_OUT_DIR, { recursive: true });
  await fs.mkdir(DATA_OUT_DIR, { recursive: true });

  // 3.1 Read offline snapshot JSON files
  console.log('Loading snapshot JSON files...');
  const posts = await loadJson('posts.json');
  const pages = await loadJson('pages.json');
  const categories = await loadJson('categories.json');
  const tags = await loadJson('tags.json');
  const media = await loadJson('media.json');
  const users = await loadJson('users.json');

  let footnotesCache = {};
  try {
    footnotesCache = await loadJson('footnotes-cache.json');
  } catch {
    console.warn('Note: footnotes-cache.json not found, proceeding without footnote bottom cache.');
  }

  // Build lookup maps
  const catMap = new Map(categories.map(c => [c.id, c]));
  const tagMap = new Map(tags.map(t => [t.id, t]));
  const mediaMap = new Map(media.map(m => [m.id, m]));
  const userMap = new Map(users.map(u => [u.id, u]));
  const linkMaps = {
    postBySlug: new Map(posts.map(p => [p.slug, new URL(p.link).pathname])),
    mediaBySlug: new Map(media.map(m => [decodeURIComponent(m.slug).toLowerCase(), m])),
  };

  // Save taxonomies to src/_data for Eleventy collections and templates
  await fs.writeFile(
    path.join(DATA_OUT_DIR, 'categories.json'),
    JSON.stringify(categories.map(c => ({ id: c.id, name: c.name, slug: c.slug, count: c.count })), null, 2)
  );
  await fs.writeFile(
    path.join(DATA_OUT_DIR, 'tags.json'),
    JSON.stringify(tags.map(t => ({ id: t.id, name: t.name, slug: t.slug, count: t.count })), null, 2)
  );
  console.log('Saved categories.json and tags.json to src/_data/');

  // Process Posts (46)
  console.log(`Processing ${posts.length} posts...`);
  let postCount = 0;

  for (const post of posts) {
    const title = decodeHtmlEntities(post.title?.rendered || '');
    const date = post.date.slice(0, 10);
    const modified = post.modified.slice(0, 10);
    const permalink = new URL(post.link).pathname;

    // Author
    const authorUser = userMap.get(post.author);
    const author = authorUser ? authorUser.name : 'Dustin';

    // Categories
    const postCategories = (post.categories || []).map(id => catMap.get(id)).filter(Boolean);
    const categoryNames = postCategories.map(c => c.name);
    const categorySlugs = postCategories.map(c => c.slug);

    // Tags
    const postTags = (post.tags || []).map(id => tagMap.get(id)).filter(Boolean);
    const tagNames = postTags.map(t => t.name);
    const tagSlugs = postTags.map(t => t.slug);

    // Excerpt
    const excerpt = cleanExcerpt(post.excerpt?.rendered || '');

    // Featured Media
    let featuredMedia = null;
    if (post.featured_media && mediaMap.has(post.featured_media)) {
      const m = mediaMap.get(post.featured_media);
      const rawUrl = m.source_url || '';
      featuredMedia = {
        id: m.id,
        url: rawUrl.replace(/^https?:\/\/(?:www\.)?dustinsview\.com\/wp-content\/uploads\//i, '/media/'),
        alt: decodeHtmlEntities(m.alt_text || m.title?.rendered || ''),
      };
    }

    // Build front matter object
    const frontMatter = {
      title,
      date,
      ...(modified !== date ? { updated: modified } : {}),
      permalink,
      author,
      layout: 'layouts/post.njk',
      wordpressId: post.id,
      postSlug: post.slug,
      categories: categoryNames,
      categorySlugs,
      tags: tagNames,
      tagSlugs,
      excerpt,
      ...(featuredMedia ? { featuredMedia } : {}),
    };

    // Clean body HTML
    const cleanedHtml = localizeInternalLinks(cleanHtmlBody(post.content?.rendered || '', post.id, footnotesCache), linkMaps);

    // Format Markdown file with YAML front matter
    const yamlStr = yaml.dump(frontMatter, { lineWidth: -1, quotingType: '"', forceQuotes: false });
    const fileContent = `---\n${yamlStr}---\n\n${cleanedHtml}\n`;

    const outPath = path.join(POSTS_OUT_DIR, `${post.slug}.md`);
    await fs.writeFile(outPath, fileContent, 'utf8');
    postCount++;
  }
  console.log(`Wrote ${postCount} posts to content/posts/`);

  // Process Pages (2)
  console.log(`Processing ${pages.length} pages...`);
  let pageCount = 0;

  for (const page of pages) {
    const title = decodeHtmlEntities(page.title?.rendered || '');
    const date = page.date.slice(0, 10);
    const modified = page.modified.slice(0, 10);
    const permalink = new URL(page.link).pathname;

    const authorUser = userMap.get(page.author);
    const author = authorUser ? authorUser.name : 'Dustin';

    const excerpt = cleanExcerpt(page.excerpt?.rendered || '');

    let featuredMedia = null;
    if (page.featured_media && mediaMap.has(page.featured_media)) {
      const m = mediaMap.get(page.featured_media);
      const rawUrl = m.source_url || '';
      featuredMedia = {
        id: m.id,
        url: rawUrl.replace(/^https?:\/\/(?:www\.)?dustinsview\.com\/wp-content\/uploads\//i, '/media/'),
        alt: decodeHtmlEntities(m.alt_text || m.title?.rendered || ''),
      };
    }

    const frontMatter = {
      title,
      date,
      ...(modified !== date ? { updated: modified } : {}),
      permalink,
      author,
      layout: 'layouts/page.njk',
      wordpressId: page.id,
      pageSlug: page.slug,
      ...(excerpt ? { excerpt } : {}),
      ...(featuredMedia ? { featuredMedia } : {}),
    };

    let cleanedHtml;
    if (page.slug === 'topics') {
      cleanedHtml = cleanTopicsContent(page.content?.rendered || '');
    } else {
      cleanedHtml = cleanHtmlBody(page.content?.rendered || '');
    }

    const yamlStr = yaml.dump(frontMatter, { lineWidth: -1, quotingType: '"', forceQuotes: false });
    const fileContent = `---\n${yamlStr}---\n\n${cleanedHtml}\n`;

    const outPath = path.join(PAGES_OUT_DIR, `${page.slug}.md`);
    await fs.writeFile(outPath, fileContent, 'utf8');
    pageCount++;
  }
  console.log(`Wrote ${pageCount} pages to content/pages/`);

  // Verification counts
  const postFiles = await fs.readdir(POSTS_OUT_DIR);
  const pageFiles = await fs.readdir(PAGES_OUT_DIR);
  const totalPostsWritten = postFiles.filter(f => f.endsWith('.md')).length;
  const totalPagesWritten = pageFiles.filter(f => f.endsWith('.md')).length;

  console.log('\n--- Import Verification ---');
  console.log(`Post files written: ${totalPostsWritten} (expected: ${posts.length})`);
  console.log(`Page files written: ${totalPagesWritten} (expected: ${pages.length})`);

  if (totalPostsWritten !== posts.length || totalPagesWritten !== pages.length) {
    throw new Error(`File count mismatch! Posts: ${totalPostsWritten}/${posts.length}, Pages: ${totalPagesWritten}/${pages.length}`);
  }

  console.log('Import completed successfully!');
}

main().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
