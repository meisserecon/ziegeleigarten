// Extract clean content from every raw page (cheerio): title, date, cleaned body HTML,
// plus the list of downloadable assets (images + linked PDFs) and brand assets.
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { CACHE, RAW, CONTENT, ensureDir, slugFromPath, fileFromSlug, normalizeURL } from './lib.mjs';

const BASE = 'https://ziegeleigarten.ch';
const manifest = JSON.parse(fs.readFileSync(path.join(CACHE, 'manifest.json'), 'utf8'));
const slugSet = new Set(manifest.map((m) => m.slug));
ensureDir(CONTENT);

// WordPress / Jetpack chrome that appears inside post content but is not real site content.
const CHROME = [
  '#jp-post-flair', '.sharedaddy', '.share-*', '.sd-block', '.sd-social',
  '.jetpack-likes-widget-wrapper', '.like-post-wrapper', '.wpl-like',
  '.comment-respond', '#respond', '.comment-form', '.comment-form-*',
  '.post-navigation', '.post-likes', '.jp-relatedposts', '.jetpack-follow',
  'form', '.wpcf7', '.gform_wrapper', '.follow', '.infinite-wrap',
  '.screen-reader-text', '.sd-text-color', '[hidden].sd-button',
].join(',');

function assetFor(url) {
  if (!url || url.startsWith('data:')) return null;
  try {
    const u = new URL(url, BASE);
    if (u.host === 'ziegeleigarten.ch' && /\/wp-content\/uploads\//i.test(u.pathname)) {
      const rel = u.pathname.replace(/^\/wp-content\/uploads\//i, '').replace(/^\//, '');
      return { target: 'assets/' + rel, src: `${u.origin}${u.pathname}` };
    }
    const ext = (u.pathname.split('.').pop() || 'bin').toLowerCase();
    if (!/^(png|jpe?g|gif|svg|webp|ico|pdf|mp4)$/i.test(ext)) return null;
    const safe = (u.host + u.pathname).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(-80);
    return { target: `assets/ext/${safe}.${ext}`, src: u.toString() };
  } catch { return null; }
}

function cleanContent($, rootSel) {
  const $root = $(rootSel).first();
  if (!$root.length) return { bodyHtml: '', assets: [] };
  const assets = new Set();

  // 1) Strip chrome + all forms (a CF7/wp.com form can't work on static hosting).
  const $chrome = $root.find(CHROME); $chrome.remove();
  $root.find('form').remove();
  $root.find('[hidden]').remove();

  // 2) Normalize embedded iframes (YouTube videos, Google Maps).
  $root.find('iframe').each((_, el) => {
    const $if = $(el);
    const src = decodeURIComponent($if.attr('src') || '');
    const yt = src.match(/(?:youtube(?:-nocookie)?\.com\/embed\/|youtu\.be\/)([A-Za-z0-9_-]+)/);
    if (yt) {
      const html = `<div class="video-embed"><iframe src="${BASE.replace(/^https?:/, 'https')}www.youtube.com/embed/${yt[1]}?rel=0" ` +
        `title="YouTube-Video" loading="lazy" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen ` +
        `style="aspect-ratio:16/9;width:100%;min-height:240px;border:0;display:block;"></iframe></div>`;
      const wrap = $if.closest('.jetpack-video-wrapper, .embed-youtube, figure, div, p, li').first();
      (wrap.length ? wrap : $if).replaceWith(html);
    } else {
      $if.attr('loading', 'lazy')
        .attr('style', ($if.attr('style') || '') + 'width:100%;min-height:300px;border:0;')
        .removeAttr('sandbox');
      $if.wrap('<div class="map-embed"></div>');
    }
  });

  // 3) Localize images; strip size/data-* cruft, keep alt.
  $root.find('img').each((_, el) => {
    const $im = $(el);
    const src = $im.attr('src');
    if (!src) { $im.remove(); return; }
    const a = assetFor(src);
    if (a && a.target) { $im.attr('src', a.target); assets.add(a); }
    ['data-attachment-id','data-permalink','data-orig-file','data-orig-size','data-comments-opened',
     'data-image-title','data-image-description','data-image-caption','data-large-file','data-size',
     'class','style','decoding','itemprop'].forEach((n) => $im.removeAttr(n));
    $im.attr('loading', 'lazy').attr('decoding', 'async');
  });

  // 4) Rewrite links: internal pages -> local files; uploads (pdf/img) -> local assets; else external.
  $root.find('a[href]').each((_, el) => {
    const $a = $(el);
    let href = ($a.attr('href') || '').trim();
    if (!href || href.startsWith('#') || /^mailto:/i.test(href) || /^tel:/i.test(href)) return;
    if (/^https?:\/\/(www\.)?ziegeleigarten\.ch/i.test(href) || href.startsWith('/')) {
      const norm = normalizeURL(href);
      const slug = slugFromPath(norm);
      if (/\/wp-content\/uploads\//i.test(norm)) {
        const a = assetFor(href); if (a) { $a.attr('href', a.target); assets.add(a); }
        $a.removeAttr('target').removeAttr('rel'); return;
      }
      if (slugSet.has(slug)) { $a.attr('href', fileFromSlug(slug)); $a.removeAttr('target').removeAttr('rel'); return; }
      $a.attr('href', BASE + norm); // same-domain link we don't mirror — keep absolute
      return;
    }
    $a.attr('target', '_blank').attr('rel', 'noopener noreferrer');
  });

  // 5) Promote multi-image figures to a responsive gallery.
  $root.find('figure, .wp-block-gallery').each((_, el) => {
    const $f = $(el);
    if ($f.find('img').length >= 2) $f.addClass('gallery');
    $f.removeAttr('style').removeAttr('class').addClass('gallery-figure');
    if ($f.find('img').length >= 2) $f.addClass('gallery');
  });

  // 6) Drop empty paragraphs & headings.
  $root.find('p:empty, h2:empty, h3:empty').remove();

  return { bodyHtml: $.html($root.contents()).trim(), assets: [...assets] };
}

function extract(raw) {
  const $ = cheerio.load(raw);
  const title = ($('h1.entry-title').first().text() || $('title').first().text() || '').trim();
  const $time = $('time[datetime]').first();
  const date = $time.attr('datetime') || '';
  const { bodyHtml, assets } = cleanContent($, '.entry-content') || {};
  return { title, date, bodyHtml: bodyHtml || '', assets: assets || [] };
}

const pages = {};
for (const m of manifest) {
  const raw = fs.readFileSync(path.join(RAW, `${m.slug}.html`), 'utf8');
  const { title, date, bodyHtml, assets } = extract(raw);
  pages[m.slug] = { ...m, title, date, bodyHtml, assets };
}

// Brand assets we always want local (site logo + favicon) — stable, taken from the homepage.
const brand = {
  'assets/ziegeleigarten-web.png': 'https://ziegeleigarten.ch/wp-content/uploads/2012/07/ziegeleigarten-web.png',
  'assets/siteicon.jpg': 'https://ziegeleigarten.ch/wp-content/uploads/2017/09/siteicon.jpg',
};

const assetMap = Object.create(null);
for (const slug of Object.keys(pages)) for (const a of pages[slug].assets) assetMap[a.target] = a.src;
Object.assign(assetMap, brand);

fs.writeFileSync(path.join(CONTENT, 'content.json'), JSON.stringify(pages, null, 2));
fs.writeFileSync(path.join(CONTENT, 'assets.json'), JSON.stringify(assetMap, null, 2));

let nImg = 0, nLink = 0;
for (const p of Object.values(pages)) { nImg += (p.bodyHtml.match(/<img/g) || []).length; }
console.log(`extracted ${Object.keys(pages).length} pages; ${Object.keys(assetMap).length} assets to download; ${nImg} images in content`);
