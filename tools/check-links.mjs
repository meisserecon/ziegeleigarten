// Verifies every relative href/src in docs/ points at an existing file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
let broken = 0, checked = 0;
const external = new Set();
for (const file of walk(OUT).filter((f) => f.endsWith('.html') && !f.endsWith('404.html'))) {
  const html = fs.readFileSync(file, 'utf8');
  for (const [, url] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (/^(https?:|mailto:|tel:|#)/.test(url)) { external.add(url.replace(/[?#].*/, '')); continue; }
    checked++;
    let target = path.resolve(path.dirname(file), decodeURIComponent(url.replace(/[?#].*$/, '')));
    if (url.endsWith('/') || fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
    if (!fs.existsSync(target)) { broken++; console.log(`BROKEN ${path.relative(OUT, file)} -> ${url}`); }
  }
}
console.log(`${checked} local links checked, ${broken} broken`);
if (process.argv.includes('--external')) console.log([...external].sort().join('\n'));
process.exitCode = broken ? 1 : 0;
