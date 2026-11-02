# ziegeleigarten.ch

Static website of ziegeleigarten.ch, hosted on GitHub Pages. It was migrated from WordPress.com
in October 2026; all original URLs are kept, e.g. `/kontakt/`, `/2018/02/08/luftbild/` and
`/wp-content/uploads/…` for images and PDFs.

- `docs/` – the website (GitHub Pages serves this folder). Each page is `<path>/index.html`.
- `docs/assets/` – stylesheet, fonts and a few externally sourced images.
- `tools/check-links.mjs` – checks that all local links and images in `docs/` resolve.

## Editing

Edit the HTML files in `docs/` directly. The page header, menu and footer are repeated in every
file, so menu changes have to be made in all pages. Then preview and check:

```sh
npx serve docs                 # preview at http://localhost:3000
node tools/check-links.mjs     # verify all local links and images
```

## GitHub Pages setup

1. Push this repository to GitHub.
2. Settings → Pages → Source: "Deploy from a branch", branch `main`, folder `/docs`.
3. Custom domain: `ziegeleigarten.ch` (already in `docs/CNAME`), then enable "Enforce HTTPS".
4. At the DNS provider, point the domain to GitHub Pages:
   - `A` records for `ziegeleigarten.ch`: 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153
   - `CNAME` for `www`: `<github-user>.github.io`
