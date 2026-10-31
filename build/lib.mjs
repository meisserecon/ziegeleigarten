// Shared helpers + constants for the ziegeleigarten static-site build.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const CACHE = path.join(ROOT, '.cache');
export const RAW = path.join(CACHE, 'raw');
export const CONTENT = path.join(CACHE, 'content');
export const SITE = path.join(ROOT, 'site');

export const BASE = 'https://ziegeleigarten.ch';
export const UA = 'Mozilla/5.0 (compatible; ziegeleigarten-static/1.0)';

export function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }

// "/wohnungen/" -> "wohnungen" ; "" -> "index" ; "/2018-02-08/luftbild/" -> "2018-02-08-luftbild"
export function slugFromPath(p) {
  const segs = (p || '').split('/').filter(Boolean);
  if (!segs.length) return 'index';
  try { return segs.map(decodeURIComponent).join('-'); } catch { return segs.join('-'); }
}

export function slugFromLoc(loc) {
  if (!loc) return 'index';
  let p = String(loc).replace(/^https?:\/\//i, '');
  p = p.replace(/^[^/]+/i, '');              // strip host (and any :port)
  if (!p.startsWith('/')) p = '/' + p;
  return slugFromPath(p);
}

export function fileFromSlug(slug) { return slug === 'index' ? 'index.html' : `${slug}.html`; }

// Map an internal URL to its local file if it is a known page; keep external links absolute.
export function localHref(href, slugSet) {
  if (!href) return href;
  const h = href.trim();
  if (h.startsWith('#') || /^mailto:/i.test(h) || /^tel:/i.test(h)) return h;
  const isInternal = /ziegeleigarten\.ch/i.test(h) || h.startsWith('/');
  if (!isInternal) return h;
  let p = h.startsWith('http') ? h.replace(/^https?:\/\/[^/]+/i, '') : h;
  p = p.replace(/[?#].*$/, '');
  if (!p.startsWith('/')) p = '/' + p;
  if (slugSet.has(slugFromPath(p))) return fileFromSlug(slugFromPath(p));
  return h; // same-domain link we don't mirror (e.g. an upload permalink) — keep absolute
}

// "https://…/wp-content/uploads/2012/07/foo.jpg?w=300" -> "assets/img/2012/07/foo.jpg"
export function imgToAsset(src) {
  const u = (src || '').replace(/[?#].*$/, '');
  const i = u.indexOf('/wp-content/uploads/');
  if (i === -1) return src;
  return 'assets/img/' + u.slice(i + '/wp-content/uploads/'.length);
}

// Concurrency-limited async map.
export async function mapLimit(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  async function worker() { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); } }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
