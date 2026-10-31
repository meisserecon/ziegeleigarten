# ziegeleigarten.ch

Static copy of ziegeleigarten.ch (formerly WordPress.com), hosted on GitHub Pages.

- `docs/` – the published site (GitHub Pages serves this folder). All original URLs are kept,
  e.g. `/kontakt/`, `/2018/02/08/luftbild/` and `/wp-content/uploads/…` for images and PDFs.
- `build/build.mjs` – the generator that produced `docs/` from the WordPress pages.
- `build/static/` – stylesheet and fonts, copied to `docs/assets/`.

## Editing

The site is plain HTML now, so small edits (rents, "vermietet", contact details) can be made
directly in `docs/**/index.html`. Re-running the build would overwrite such edits, so only use
it while the WordPress site is still online:

```sh
cd build
npm install
npm run refresh   # re-crawl ziegeleigarten.ch and rebuild docs/
npm run check     # verify all local links and images
npm run serve     # preview at http://localhost:3000
```

## GitHub Pages setup

1. Push this repository to GitHub.
2. Settings → Pages → Source: "Deploy from a branch", branch `main`, folder `/docs`.
3. Custom domain: `ziegeleigarten.ch` (already in `docs/CNAME`), then enable "Enforce HTTPS".
4. At the DNS provider, point the domain to GitHub Pages:
   - `A` records for `ziegeleigarten.ch`: 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153
   - `CNAME` for `www`: `<github-user>.github.io`
