// Static rebuild of ziegeleigarten.ch (formerly WordPress.com, theme Twenty Sixteen).
//
//   node build/build.mjs            build docs/ from the cached crawl (downloads missing assets)
//   node build/build.mjs --refresh  re-crawl every page from the live site first
//
// Output goes to docs/ (served by GitHub Pages). Every original URL is preserved:
// pages and posts as <path>/index.html, uploads under wp-content/uploads/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache');
const RAW = path.join(CACHE, 'raw');
const OUT = path.join(ROOT, 'docs');
const STATIC = path.join(ROOT, 'build', 'static');
const ORIGIN = 'https://ziegeleigarten.ch';
const UA = 'Mozilla/5.0 (compatible; ziegeleigarten-static/1.0)';
const SITE_NAME = 'Ziegeleigarten';
const PER_PAGE = 10;
const REFRESH = process.argv.includes('--refresh');

const MENU = [
  ['', 'Einfamilienhäuser'],
  ['wohnungen-2018/', 'Wohnungen 2018'],
  ['wohnungen-2015/', '2015'],
  ['wohnungen/', '2013'],
  ['neuigkeiten/', 'Neuigkeiten'],
  ['kontakt/', 'Kontakt'],
];

const mkdir = (d) => fs.mkdirSync(d, { recursive: true });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function mapLimit(items, n, fn) {
  let i = 0;
  const worker = async () => { while (i < items.length) { const idx = i++; await fn(items[idx], idx); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

async function get(url, attempts = 3) {
  for (let a = 1; ; a++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (a >= attempts) throw new Error(`${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1000 * a));
    }
  }
}

// "https://ziegeleigarten.ch/2018/02/08/luftbild/" -> "2018/02/08/luftbild/" ; home -> ""
function sitePath(url) {
  let p = url.replace(/^https?:\/\/(www\.)?ziegeleigarten\.ch/i, '').replace(/[?#].*$/, '');
  p = p.replace(/^\/+/, '');
  if (p && !p.endsWith('/') && !/\.[a-z0-9]{2,4}$/i.test(p)) p += '/';
  return p;
}
const slugOf = (p) => (p ? p.replace(/\/$/, '').split('/').join('-') : 'index');

// Relative URL from the page at `from` (a site path like "kontakt/") to site path `to`.
function rel(from, to) {
  const depth = from.split('/').filter(Boolean).length;
  const r = '../'.repeat(depth) + to;
  return r || './';
}

// ---------------------------------------------------------------- 1. crawl
mkdir(RAW);
if (REFRESH || !fs.existsSync(path.join(CACHE, 'sitemap.xml'))) {
  fs.writeFileSync(path.join(CACHE, 'sitemap.xml'), await get(`${ORIGIN}/sitemap.xml`));
}
const locs = [...fs.readFileSync(path.join(CACHE, 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map((m) => m[1].trim()).filter((u) => !/\.(jpe?g|png|gif|pdf)$/i.test(u));
const entries = [...new Map(locs.map((loc) => { const p = sitePath(loc); return [p, { loc, path: p, slug: slugOf(p) }]; })).values()];

await mapLimit(entries, 4, async (e) => {
  const file = path.join(RAW, `${e.slug}.html`);
  if (!REFRESH && fs.existsSync(file)) return;
  fs.writeFileSync(file, await get(`${ORIGIN}/${e.path}`));
  console.log('fetched', e.path || '/');
});
const knownPaths = new Set(entries.map((e) => e.path));

// ---------------------------------------------------------------- 2. extract
const assets = new Map(); // local site path -> remote URL

function uploadAsset(url) {
  const u = new URL(url, ORIGIN);
  const local = decodeURIComponent(u.pathname).replace(/^\/+/, '');
  assets.set(local, `${ORIGIN}${u.pathname}`);
  return local;
}
// External images whose original source no longer works.
const SOURCE_OVERRIDES = {
  'https://i0.wp.com/upload.wikimedia.org/wikipedia/commons/thumb/e/e9/Rafz-blazon.svg/212px-Rafz-blazon.svg.png':
    'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cc/CHE_Rafz_COA.svg/250px-CHE_Rafz_COA.svg.png',
};
function externalAsset(url) {
  const u = new URL(url);
  const name = (u.host + u.pathname).replace(/^i\d\.wp\.com\//, '').replace(/[^a-z0-9.]+/gi, '-').replace(/^-+|-+$/g, '');
  const local = `assets/ext/${name}`;
  assets.set(local, SOURCE_OVERRIDES[u.toString()] || u.toString());
  return local;
}
const isUpload = (url) => /^(https?:)?\/\/(www\.)?ziegeleigarten\.ch\/wp-content\/uploads\//i.test(url) || /^\/wp-content\/uploads\//.test(url);
const isInternal = (url) => /^(https?:)?\/\/(www\.)?ziegeleigarten\.ch(\/|$)/i.test(url) || url.startsWith('/');

// Cleans an .entry-content element. Links are stored as "@@/<site path>" placeholders
// and resolved per output page later (the same post appears at several depths).
function cleanContent($, $c) {
  $c.find('#jp-post-flair, .sharedaddy, #jp-relatedposts, script, style, noscript, form, .screen-reader-text').remove();

  $c.find('iframe').each((_, el) => {
    const src = $(el).attr('src') || '';
    const yt = src.match(/youtube(?:-nocookie)?\.com\/embed\/([\w-]+)/);
    const $wrap = $(el).closest('.jetpack-video-wrapper');
    const html = yt
      ? `<div class="video-embed"><iframe src="https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0" title="YouTube-Video" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`
      : `<div class="video-embed"><iframe src="${esc(src)}" loading="lazy"></iframe></div>`;
    ($wrap.length ? $wrap : $(el)).replaceWith(html);
  });

  $c.find('img').each((_, el) => {
    const $im = $(el);
    const src = $im.attr('src') || '';
    const local = isUpload(src) ? uploadAsset(src) : /^https?:/.test(src) ? externalAsset(src) : null;
    const align = ($im.attr('class') || '').split(/\s+/).filter((c) => /^align/.test(c)).join(' ');
    const alt = $im.attr('alt') || '';
    for (const a of Object.keys(el.attribs)) $im.removeAttr(a);
    $im.attr('src', local ? `@@/${local}` : src).attr('alt', alt).attr('loading', 'lazy').attr('decoding', 'async');
    if (align && align !== 'alignnone') $im.attr('class', align);
    // Without the Jetpack lightbox, make content images open full size.
    if (local && isUpload(src) && !$im.closest('a').length) $im.wrap(`<a href="@@/${local}"></a>`);
  });

  $c.find('.wp-caption').each((_, el) => {
    const $d = $(el);
    const align = ($d.attr('class') || '').split(/\s+/).filter((c) => /^align/.test(c)).join(' ');
    const caption = $d.find('.wp-caption-text').html() || '';
    $d.find('.wp-caption-text').remove();
    $d.replaceWith(`<figure class="wp-caption ${align}">${$d.html().trim()}<figcaption>${caption}</figcaption></figure>`);
  });

  $c.find('a[href]').each((_, el) => {
    const $a = $(el);
    const href = ($a.attr('href') || '').trim();
    if (/\s/.test(href)) { // junk placeholder href (e.g. "Photo Click-through Link") — link the image instead
      const img = $a.find('img').attr('src');
      if (img) $a.attr('href', img); else $a.replaceWith($a.html());
    } else if (isUpload(href)) $a.attr('href', `@@/${uploadAsset(href)}`);
    else if (isInternal(href)) {
      const hash = (href.match(/#.*/) || [''])[0];
      const p = sitePath(href);
      $a.attr('href', knownPaths.has(p) ? `@@/${p}${hash}` : `${ORIGIN}/${p}${hash}`);
    }
  });

  $c.find('[data-shared], [data-src]').removeAttr('data-shared').removeAttr('data-src');
  $c.find('p').each((_, el) => { if (!$(el).text().trim() && !$(el).find('img, iframe').length) $(el).remove(); });
  return $c.html().trim();
}

const docs = [];
for (const e of entries) {
  const $ = cheerio.load(fs.readFileSync(path.join(RAW, `${e.slug}.html`), 'utf8'));
  const isPost = /^\d{4}\/\d{2}\/\d{2}\//.test(e.path);
  const doc = {
    ...e,
    type: e.path === '' ? 'home' : isPost ? 'post' : 'page',
    title: $('h1.entry-title').first().text().trim() || $('title').text().trim(),
    date: isPost ? $('time.entry-date').first().attr('datetime') : null,
    description: $('meta[name="description"]').attr('content') || '',
  };
  if (e.path !== 'neuigkeiten/') doc.html = cleanContent($, $('.entry-content').first());
  docs.push(doc);
}
const posts = docs.filter((d) => d.type === 'post').sort((a, b) => b.date.localeCompare(a.date));

// Site chrome assets.
uploadAsset(`${ORIGIN}/wp-content/uploads/2012/07/ziegeleigarten-web.png`);
uploadAsset(`${ORIGIN}/wp-content/uploads/2017/09/siteicon.jpg`);

// ---------------------------------------------------------------- 3. assets
let downloaded = 0;
const failed = [];
await mapLimit([...assets], 6, async ([local, url]) => {
  const out = path.join(OUT, ...local.split('/'));
  if (fs.existsSync(out)) return;
  try {
    const buf = await get(url);
    mkdir(path.dirname(out));
    fs.writeFileSync(out, buf);
    downloaded++;
  } catch (err) { failed.push(err.message); }
});

// ---------------------------------------------------------------- 4. render
const dateFmt = new Intl.DateTimeFormat('de-CH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); // WordPress displayed dates in UTC
const fmtDate = (iso) => dateFmt.format(new Date(iso));
const resolve = (html, from) => html.replace(/@@\/([^"'\s)]*)/g, (_, p) => rel(from, p));

function layout({ from, title, description = '', active, body }) {
  const r = (p) => rel(from, p);
  const menu = (id) => `<ul${id ? ` id="${id}"` : ''} class="primary-menu">${MENU.map(([p, label]) =>
    `<li${p === active ? ' class="current-menu-item"' : ''}><a href="${r(p)}"${p === active ? ' aria-current="page"' : ''}>${esc(label)}</a></li>`).join('')}</ul>`;
  const fullTitle = title && title !== SITE_NAME ? `${title} – ${SITE_NAME}` : SITE_NAME;
  return `<!DOCTYPE html>
<html lang="de-CH">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
${description ? `<meta name="description" content="${esc(cheerio.load(description).text())}">\n` : ''}<link rel="canonical" href="${ORIGIN}/${from}">
<link rel="icon" href="${r('wp-content/uploads/2017/09/siteicon.jpg')}">
<link rel="stylesheet" href="${r('assets/style.css')}">
</head>
<body>
<div class="site">
<header class="site-header">
<div class="site-branding"><a href="${r('')}" rel="home"><img src="${r('wp-content/uploads/2012/07/ziegeleigarten-web.png')}" width="303" height="151" alt="${SITE_NAME}"></a></div>
<button class="menu-toggle" aria-controls="site-navigation" aria-expanded="false">Menü</button>
<nav id="site-navigation" class="main-navigation" aria-label="Primäres Menü">${menu()}</nav>
</header>
<main class="site-main">
${body}
</main>
<footer class="site-footer">
<nav class="main-navigation" aria-label="Footer-Hauptmenü">${menu()}</nav>
<div class="site-info">© ${SITE_NAME}, Ziegeleiwäg, 8197 Rafz</div>
</footer>
</div>
<script>
document.querySelector('.menu-toggle').addEventListener('click', function () {
  var open = document.body.classList.toggle('menu-open');
  this.setAttribute('aria-expanded', open);
});
</script>
</body>
</html>
`;
}

function article(d, from, { linkTitle = false, heading = 'h1' } = {}) {
  const title = linkTitle ? `<a href="${rel(from, d.path)}" rel="bookmark">${esc(d.title)}</a>` : esc(d.title);
  const meta = d.date ? `<div class="entry-meta"><time datetime="${d.date}">${fmtDate(d.date)}</time></div>` : '';
  return `<article class="entry entry-${d.type}">
<header class="entry-header"><${heading} class="entry-title">${title}</${heading}></header>
<div class="entry-content">
${resolve(d.html, from)}
</div>
${meta}
</article>`;
}

function write(p, html) {
  const out = path.join(OUT, ...p.split('/').filter(Boolean), 'index.html');
  mkdir(path.dirname(out));
  fs.writeFileSync(out, html);
}

// Plain pages + home.
for (const d of docs.filter((x) => x.type !== 'post' && x.path !== 'neuigkeiten/')) {
  write(d.path, layout({ from: d.path, title: d.type === 'home' ? '' : d.title, description: d.description, active: d.path, body: article(d, d.path) }));
}

// Posts, with previous/next navigation (older = previous, as in WordPress).
posts.forEach((d, i) => {
  const newer = posts[i - 1], older = posts[i + 1];
  const nav = `<nav class="post-navigation" aria-label="Beiträge">
${older ? `<div class="nav-previous"><a href="${rel(d.path, older.path)}" rel="prev"><span class="meta-nav">Vorheriger Beitrag</span> <span class="post-title">${esc(older.title)}</span></a></div>` : ''}
${newer ? `<div class="nav-next"><a href="${rel(d.path, newer.path)}" rel="next"><span class="meta-nav">Nächster Beitrag</span> <span class="post-title">${esc(newer.title)}</span></a></div>` : ''}
</nav>`;
  write(d.path, layout({ from: d.path, title: d.title, description: d.description, active: 'neuigkeiten/', body: article(d, d.path) + nav }));
});

// News listing: /neuigkeiten/, /neuigkeiten/page/2/, ...
const pages = Math.ceil(posts.length / PER_PAGE);
const pagePath = (n) => (n === 1 ? 'neuigkeiten/' : `neuigkeiten/page/${n}/`);
for (let n = 1; n <= pages; n++) {
  const from = pagePath(n);
  const list = posts.slice((n - 1) * PER_PAGE, n * PER_PAGE).map((d) => article(d, from, { linkTitle: true, heading: 'h2' })).join('\n');
  const links = [];
  if (n > 1) links.push(`<a class="prev" href="${rel(from, pagePath(n - 1))}">Neuere Beiträge</a>`);
  for (let k = 1; k <= pages; k++) links.push(k === n ? `<span class="current" aria-current="page">${k}</span>` : `<a href="${rel(from, pagePath(k))}">${k}</a>`);
  if (n < pages) links.push(`<a class="next" href="${rel(from, pagePath(n + 1))}">Ältere Beiträge</a>`);
  const body = `<h1 class="page-title screen-reader-text">Neuigkeiten</h1>\n${list}\n<nav class="pagination" aria-label="Seiten">${links.join(' ')}</nav>`;
  write(from, layout({ from, title: n === 1 ? 'Neuigkeiten' : `Neuigkeiten – Seite ${n}`, active: 'neuigkeiten/', body }));
}

// 404 page (GitHub Pages serves /404.html for unknown URLs; links must be absolute there).
const notFound = layout({ from: '', title: 'Seite nicht gefunden', active: null, body: `<article class="entry"><header class="entry-header"><h1 class="entry-title">Seite nicht gefunden</h1></header><div class="entry-content"><p>Die gesuchte Seite existiert leider nicht. Zurück zur <a href="/">Startseite</a>.</p></div></article>` })
  .replace(/(href|src)="(?!https?:|\/|#)([^"]*)"/g, '$1="/$2"').replace(/="\/\.\/"/g, '="/"');
fs.writeFileSync(path.join(OUT, '404.html'), notFound);

// Static files, sitemap, GitHub Pages config.
mkdir(path.join(OUT, 'assets'));
fs.cpSync(STATIC, path.join(OUT, 'assets'), { recursive: true });
const urls = [...docs.map((d) => d.path), ...Array.from({ length: pages - 1 }, (_, i) => pagePath(i + 2))];
fs.writeFileSync(path.join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${ORIGIN}/${u}</loc></url>`).join('\n')}\n</urlset>\n`);
fs.writeFileSync(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`);
fs.writeFileSync(path.join(OUT, 'CNAME'), 'ziegeleigarten.ch\n');
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

console.log(`${docs.length} pages/posts, ${pages} news pages, ${assets.size} assets (${downloaded} downloaded now)`);
if (failed.length) { console.log(`${failed.length} asset downloads FAILED:`); failed.forEach((f) => console.log('  ' + f)); process.exitCode = 1; }
