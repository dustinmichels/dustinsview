import fs from 'node:fs/promises';
import path from 'node:path';

function loadEnv() {
  const env = { ...process.env };
  try {
    const raw = fs.readFile('.env', 'utf-8');
    // We'll await or do it sync if needed, but in an async function we can await
  } catch {}
  return env;
}

async function getCredentials() {
  const env = { ...process.env };
  try {
    const raw = await fs.readFile('.env', 'utf-8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        env[key] = val;
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const username = env.WP_ADMIN_USER;
  const password = env.WP_ADMIN_PASSWORD;

  if (!username || !password) {
    throw new Error('Missing WP_ADMIN_USER or WP_ADMIN_PASSWORD in .env');
  }

  return { username, password, baseUrl: env.WP_BASE_URL || 'https://dustinsview.com' };
}

async function exportWxr() {
  const { username, password, baseUrl } = await getCredentials();
  console.log(`Connecting to ${baseUrl} as ${username}...`);

  const cookieJar = new Map();
  cookieJar.set('wordpress_test_cookie', 'WP%20Cookie%20check');

  function saveCookies(res) {
    const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of cookies) {
      const pair = c.split(';')[0].trim();
      const [name, ...val] = pair.split('=');
      cookieJar.set(name, val.join('='));
    }
  }

  function getCookieHeader() {
    return Array.from(cookieJar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  // 1. Initial GET to establish session
  const initialRes = await fetch(`${baseUrl}/wp-login.php`, {
    headers: { 'User-Agent': 'dustinsview-archiver/1.0' }
  });
  saveCookies(initialRes);

  // 2. Submit login form
  const bodyParams = new URLSearchParams({
    log: username,
    pwd: password,
    'wp-submit': 'Log In',
    redirect_to: `${baseUrl}/wp-admin/`,
    testcookie: '1'
  });

  const loginRes = await fetch(`${baseUrl}/wp-login.php`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      'Origin': baseUrl,
      'Referer': `${baseUrl}/wp-login.php`,
      'Cookie': getCookieHeader()
    },
    body: bodyParams.toString(),
    redirect: 'manual'
  });

  saveCookies(loginRes);

  const hasLoggedInCookie = Array.from(cookieJar.keys()).some(k => k.startsWith('wordpress_logged_in'));
  if (!hasLoggedInCookie) {
    throw new Error('WordPress login failed. Please check WP_ADMIN_USER and WP_ADMIN_PASSWORD in .env.');
  }

  console.log('Authentication successful.');

  // 3. Download full WXR export (all content)
  const exportUrl = `${baseUrl}/wp-admin/export.php?download=true&content=all`;
  console.log(`Fetching WXR export from ${exportUrl}...`);

  const exportRes = await fetch(exportUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      'Cookie': getCookieHeader()
    }
  });

  if (!exportRes.ok) {
    throw new Error(`Export request failed with HTTP ${exportRes.status} ${exportRes.statusText}`);
  }

  const xmlContent = await exportRes.text();
  if (!xmlContent.includes('<rss version="2.0"') || !xmlContent.includes('<wp:wxr_version>')) {
    throw new Error('Response did not contain valid WordPress XML (WXR) export content.');
  }

  const today = new Date().toISOString().slice(0, 10);
  const outDir = path.resolve('backup/wxr');
  await fs.mkdir(outDir, { recursive: true });

  const fileName = `dustinsview.WordPress.${today}.xml`;
  const filePath = path.join(outDir, fileName);
  await fs.writeFile(filePath, xmlContent, 'utf-8');

  const itemCount = [...xmlContent.matchAll(/<item>/g)].length;
  const commentCount = [...xmlContent.matchAll(/<wp:comment>/g)].length;
  const sizeMb = (Buffer.byteLength(xmlContent, 'utf-8') / 1024 / 1024).toFixed(2);

  console.log(`\nSuccessfully downloaded WordPress WXR export:`);
  console.log(`- Path: ${filePath}`);
  console.log(`- Size: ${sizeMb} MB`);
  console.log(`- Total items (posts/pages/attachments): ${itemCount}`);
  console.log(`- Total comments: ${commentCount}`);
}

exportWxr().catch(err => {
  console.error('Error exporting WXR:', err.message);
  process.exit(1);
});
