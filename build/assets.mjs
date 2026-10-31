// Download every localized asset (images + PDFs + brand assets) to site/<target>, in parallel.
import fs from 'node:fs';
import path from 'node:path';
import { CACHE, SITE, ensureDir, UA, mapLimit } from './lib.mjs';

const assetMap = JSON.parse(fs.readFileSync(path.join(CACHE, 'content', 'assets.json'), 'utf8'));
const entries = Object.entries(assetMap);

async function one([target, src]) {
  const out = path.join(SITE, target.split('/').join(path.sep));
  ensureDir(path.dirname(out));
  const res = await fetch(src, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
  if (!res.ok) return { target, ok:false, src, status: res.status };
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(out, buf);
  return { target, ok:true, bytes: buf.byteLength };
}

const results = await mapLimit(entries, 5, one);
const ok = results.filter(r=>r.ok).length;
const fail = results.filter(r=>!r.ok);
console.log(`downloaded ${ok}/${entries.length} assets${fail.length?`: ${fail.length} failed`:''}`);
for (const r of fail) console.log(`  FAIL ${r.status} ${r.target} <- ${r.src}`);
