// Compact page profiler so content never floods context: `node build/inspect.mjs <slug>[ <slug> ...] [--body slug]`
import fs from 'node:fs';
import path from 'node:path';
import { RAW } from './lib.mjs';

const args = process.argv.slice(2);
const slugs = args.filter((a) => a !== '--body');
const body = args[args.indexOf('--body') + 1];

function entryContent(html) {
  const open = html.indexOf('<div class="entry-content"');
  if (open === -1) return null;
  const end = html.indexOf('>', open) + 1;
  const re = /<div\b|<\/div>/g; re.lastIndex = end; let depth = 1, m;
  while ((m = re.exec(html))) { if (m[0] === '</div>') depth--; else depth++; if (depth === 0) return html.slice(end, m.index); }
  return null;
}

for (const slug of slugs) {
  const html = fs.readFileSync(path.join(RAW, slug + '.html'), 'utf8');
  const c = (re) => (html.match(re) || []).length;
  const ec = entryContent(html);
  console.log(`\n=== ${slug} ===`);
  console.log('title   :', (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]?.trim());
  console.log('h1      :', (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]?.replace(/\s+/g, ' ').replace(/<[^>]+>/g, '').trim());
  console.log('h2      :', (html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/gi) || []).slice(0, 4).map((s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()).join(' | '));
  console.log('time    :', (html.match(/<time[^>]*>[\s\S]*?<\/time>/i) || [])[0]?.replace(/\s+/g, ' ').slice(0, 140));
  console.log('counts  :', `img=${c(/<img\b/gi)} figure=${c(/<figure\b/gi)} gallery=${c(/wp-block-gallery/gi)} table=${c(/<table\b/gi)} iframe=${c(/<iframe\b/gi)} form=${c(/<form\b/gi)} video=${c(/<video\b/gi)}`);
  const ec2 = ec ?? '';
  const imgs = [...ec2.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)].map((m) => m[1]);
  const links = [...ec2.matchAll(/<a\b[^>]*\bhref="([^"]+)"/gi)].map((m) => m[1]);
  const internal = links.filter((h) => /ziegeleigarten\.ch/i.test(h));
  console.log(`entry-content: ${ec2.length}B  (${c(/<p\b/gi) < 999 ? '' : ''}imgs=${imgs.length} links=${links.length} internal=${internal.length})`);
  console.log('  img srcs:', imgs.slice(0, 4));
  console.log('  int links:', internal.slice(0, 5));
  if (slug === body) console.log('\n--- BODY (first 1200 chars, tags stripped markers kept) ---\n' + ec2.slice(0, 1200));
}
