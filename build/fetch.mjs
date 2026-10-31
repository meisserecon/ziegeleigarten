// Crawl: read the sitemap, fetch every page into .cache/raw/<slug>.html, write a manifest.
import fs from 'node:fs';
import path from 'node:path';
import { CACHE, RAW, ensureDir, slugFromLoc, fileFromSlug, UA, mapLimit } from './lib.mjs';

ensureDir(RAW);
const xml = fs.readFileSync(path.join(CACHE, 'sitemap.xml'), 'utf8');
const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());

const seen = new Set();
const manifest = [];
for (const loc of locs) {
  const slug = slugFromLoc(loc);
  if (seen.has(slug)) continue;
  seen.add(slug);
  const isHome = slug === 'index';
  const isPost = /\/\d{4}\/\d{2}\/\d{2}\//.test(loc);
  manifest.push({ loc, slug, kind: isHome ? 'home' : isPost ? 'post' : 'page', file: fileFromSlug(slug) });
}

async function fetchPage(entry) {
  const url = entry.loc.startsWith('http') ? entry.loc : 'https://ziegeleigarten.ch' + entry.loc;
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(path.join(RAW, `${entry.slug}.html`), buf);
    entry.status = res.status; entry.bytes = buf.byteLength;
  } catch (e) { entry.status = 'ERROR'; entry.error = String(e); }
}

await mapLimit(manifest, 3, fetchPage);
fs.writeFileSync(path.join(CACHE, 'manifest.json'), JSON.stringify(manifest, null, 2));

const ok = manifest.filter((m) => m.status === 200).length;
console.log(`Fetched ${manifest.length} pages: ${ok} OK, ${manifest.length - ok} not 200`);
for (const m of manifest) console.log(`  ${String(m.status).padStart(5)} ${String(m.bytes || 0).padStart(7)}B  ${m.kind.padStart(4)}  ${m.slug}  ->  ${m.file}`);
