// Builds src/_data/comments.json from the offline snapshot.
//
// Sources (backup/wp-raw-snapshot/):
//   comments.json       WordPress REST approved comments (post ID, parent, author URL, avatar)
//   disqus-export.xml   Disqus export (live comment system; moderation state, original Unicode bodies)
//   posts.json          WordPress posts (ID -> slug/permalink)
//
// Merge policy:
//   - Disqus comments carrying <id>wp_id=N</id> are the same comment as WP comment N.
//   - Disqus comments without wp_id are matched to WP comments by (author name, minute of creation).
//   - Matched comments use the Disqus body (WP copies lost emoji as "??") and Disqus timestamp.
//   - Disqus-only comments (posted after Disqus->WP sync stopped) are included.
//   - WP comments whose Disqus counterpart is deleted or spam are excluded.
//   - Replies whose parent is absent from both sources are promoted to top level and flagged.
import fs from 'node:fs/promises';
import path from 'node:path';

const SNAPSHOT_DIR = path.resolve('backup/wp-raw-snapshot');
const OUT_FILE = path.resolve('src/_data/comments.json');
const DISQUS_AUTHOR_USERNAME = 'dustinmichels';

function decodeEntities(str) {
  if (!str) return '';
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
  return str.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return named[e] ?? m;
  });
}

function escapeAttr(str) {
  return str.replace(/&(?!(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);)/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

const ALLOWED_TAGS = new Set(['p', 'br', 'a', 'blockquote', 'em', 'strong', 'i', 'b', 'code', 'pre', 'ul', 'ol', 'li']);
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|noscript|svg|form|template)\b[\s\S]*?<\/\1\s*>/gi;

// Allowlist sanitizer: keeps simple formatting tags, safe links only; drops images (tracking pixels), embeds, scripts.
export function sanitizeCommentHtml(html) {
  let out = (html || '').replace(/<!--[\s\S]*?-->/g, '').replace(DROP_WITH_CONTENT, '');
  out = out.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (tag, name, attrs) => {
    const lower = name.toLowerCase();
    if (!ALLOWED_TAGS.has(lower)) return '';
    if (tag.startsWith('</')) return lower === 'br' ? '' : `</${lower}>`;
    if (lower === 'br') return '<br>';
    if (lower !== 'a') return `<${lower}>`;
    const hrefMatch = attrs.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const href = decodeEntities(hrefMatch ? (hrefMatch[2] ?? hrefMatch[3] ?? hrefMatch[4]) : '').trim();
    if (!/^(https?:|mailto:)/i.test(href)) return '<a>';
    return `<a href="${escapeAttr(href)}" rel="nofollow ugc noopener">`;
  });
  // Unclosed/orphan <a> without href renders as plain text container; collapse empty links and paragraphs.
  out = out.replace(/<a[^>]*>\s*<\/a>/g, '').replace(/<p>\s*<\/p>/g, '');
  return out.replace(/\r\n/g, '\n').trim();
}

function safeUrl(url) {
  const u = (url || '').trim();
  return /^https?:\/\//i.test(u) ? u : null;
}

function tagText(block, tag) {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : null;
}

function parseDisqus(xml) {
  const threads = new Map();
  for (const m of xml.matchAll(/<thread dsq:id="(\d+)">([\s\S]*?)<\/thread>/g)) {
    const body = m[2];
    const idText = tagText(body, 'id') || '';
    const wpPostId = /^(\d+)\s/.test(idText) ? Number(idText.match(/^(\d+)/)[1]) : null;
    threads.set(m[1], { wpPostId, link: decodeEntities(tagText(body, 'link') || '') });
  }
  const posts = [];
  for (const m of xml.matchAll(/<post dsq:id="(\d+)">([\s\S]*?)<\/post>/g)) {
    const body = m[2];
    const wpIdMatch = body.match(/<id>wp_id=(\d+)<\/id>/);
    const message = body.match(/<message><!\[CDATA\[([\s\S]*?)\]\]><\/message>/);
    const author = body.match(/<author>([\s\S]*?)<\/author>/)?.[1] || '';
    posts.push({
      dsqId: m[1],
      wpId: wpIdMatch ? Number(wpIdMatch[1]) : null,
      message: message ? message[1] : '',
      createdAt: tagText(body, 'createdAt'),
      isDeleted: tagText(body, 'isDeleted') === 'true',
      isSpam: tagText(body, 'isSpam') === 'true',
      authorName: decodeEntities(tagText(author, 'name') || '').trim(),
      username: tagText(author, 'username'),
      threadId: body.match(/<thread dsq:id="(\d+)"/)?.[1] || null,
      parentDsqId: body.match(/<parent dsq:id="(\d+)"/)?.[1] || null,
    });
  }
  return { threads, posts };
}

const matchKey = (name, iso) => `${name.trim().toLowerCase()}|${iso.slice(0, 16)}`;
const toUtcIso = (s) => (/[zZ]|[+-]\d\d:\d\d$/.test(s) ? new Date(s) : new Date(`${s}Z`)).toISOString();

async function main() {
  const [wpComments, wpPosts, xml] = await Promise.all([
    fs.readFile(path.join(SNAPSHOT_DIR, 'comments.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(SNAPSHOT_DIR, 'posts.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(SNAPSHOT_DIR, 'disqus-export.xml'), 'utf8'),
  ]);
  const { threads, posts: disqusPosts } = parseDisqus(xml);

  const postById = new Map(wpPosts.map((p) => [p.id, p]));
  const postIdByPath = new Map(wpPosts.map((p) => [new URL(p.link).pathname, p.id]));
  const postSlugByLastSegment = new Map(wpPosts.map((p) => [p.slug, p.id]));

  const resolveThreadPost = (threadId) => {
    const t = threads.get(threadId);
    if (!t) return null;
    if (t.wpPostId && postById.has(t.wpPostId)) return t.wpPostId;
    try {
      const pathname = new URL(t.link).pathname;
      if (postIdByPath.has(pathname)) return postIdByPath.get(pathname);
      const slug = pathname.split('/').filter(Boolean).pop();
      return postSlugByLastSegment.get(slug) ?? null;
    } catch {
      return null;
    }
  };

  // Match Disqus posts to WP comments.
  const wpById = new Map(wpComments.filter((c) => c.status === 'approved').map((c) => [c.id, c]));
  const wpByKey = new Map([...wpById.values()].map((c) => [matchKey(c.author_name, c.date_gmt), c]));
  const disqusByWpId = new Map();
  const disqusOnly = [];
  const wpIdByDsqId = new Map();
  for (const d of disqusPosts) {
    let wp = d.wpId != null ? wpById.get(d.wpId) : null;
    if (!wp && d.wpId == null && d.createdAt) wp = wpByKey.get(matchKey(d.authorName, d.createdAt)) || null;
    if (wp) {
      disqusByWpId.set(wp.id, d);
      wpIdByDsqId.set(d.dsqId, wp.id);
    } else if (!d.isDeleted && !d.isSpam) {
      disqusOnly.push(d);
    }
  }

  // Normalized flat records.
  const records = new Map(); // key -> record
  const stats = { wpApproved: wpById.size, matched: 0, excludedByDisqusModeration: 0, disqusOnly: 0, unmappedPost: 0, orphanReplies: 0 };

  for (const wp of wpById.values()) {
    const d = disqusByWpId.get(wp.id);
    if (d && (d.isDeleted || d.isSpam)) {
      stats.excludedByDisqusModeration++;
      continue;
    }
    if (d) stats.matched++;
    records.set(`wp-${wp.id}`, {
      id: String(wp.id),
      postId: wp.post,
      parentKey: wp.parent ? `wp-${wp.parent}` : null,
      author_name: decodeEntities(wp.author_name).trim() || 'Anonymous',
      author_url: safeUrl(wp.author_url),
      avatar_url: wp.author_avatar_urls?.['96'] || null,
      isPostAuthor: wp.author !== 0 || d?.username === DISQUS_AUTHOR_USERNAME,
      date: toUtcIso(d?.createdAt || wp.date_gmt),
      content: sanitizeCommentHtml(d ? d.message : wp.content.rendered),
      source: d ? 'disqus+wordpress' : 'wordpress',
    });
  }

  for (const d of disqusOnly) {
    const postId = resolveThreadPost(d.threadId);
    if (!postId) {
      stats.unmappedPost++;
      continue;
    }
    stats.disqusOnly++;
    let parentKey = null;
    if (d.parentDsqId) {
      parentKey = wpIdByDsqId.has(d.parentDsqId) ? `wp-${wpIdByDsqId.get(d.parentDsqId)}` : `disqus-${d.parentDsqId}`;
    }
    records.set(`disqus-${d.dsqId}`, {
      id: `disqus-${d.dsqId}`,
      postId,
      parentKey,
      author_name: d.authorName || 'Anonymous',
      author_url: null,
      avatar_url: null,
      isPostAuthor: d.username === DISQUS_AUTHOR_USERNAME,
      date: toUtcIso(d.createdAt),
      content: sanitizeCommentHtml(d.message),
      source: 'disqus',
    });
  }

  // Build threads.
  const nodes = new Map([...records].map(([key, r]) => [key, { ...r, children: [] }]));
  const roots = new Map(); // postId -> top-level nodes
  for (const node of nodes.values()) {
    const parent = node.parentKey ? nodes.get(node.parentKey) : null;
    if (node.parentKey && (!parent || parent.postId !== node.postId)) {
      node.parentMissing = true;
      stats.orphanReplies++;
    }
    if (parent && parent.postId === node.postId) parent.children.push(node);
    else {
      if (!roots.has(node.postId)) roots.set(node.postId, []);
      roots.get(node.postId).push(node);
    }
  }

  const byDate = (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id, undefined, { numeric: true });
  const finalize = (list) =>
    list.sort(byDate).map(({ parentKey, postId, children, ...rest }) => ({ ...rest, children: finalize(children) }));
  const countTree = (list) => list.reduce((n, c) => n + 1 + countTree(c.children), 0);

  const output = {};
  for (const [postId, list] of [...roots].sort((a, b) => a[0] - b[0])) {
    const post = postById.get(postId);
    if (!post) {
      stats.unmappedPost += countTree(list);
      continue;
    }
    const comments = finalize(list);
    output[post.slug] = { wordpressId: postId, count: countTree(comments), comments };
  }

  await fs.writeFile(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
  const total = Object.values(output).reduce((n, p) => n + p.count, 0);
  console.log(`Disqus posts: ${disqusPosts.length} (${disqusPosts.filter((d) => !d.isDeleted && !d.isSpam).length} visible)`);
  console.log(stats);
  console.log(`Wrote ${total} comments across ${Object.keys(output).length} posts to ${path.relative(process.cwd(), OUT_FILE)}`);
}

main().catch((err) => {
  console.error('Comment import failed:', err);
  process.exit(1);
});
