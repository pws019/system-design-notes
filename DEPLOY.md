# Documentation site

The English and Chinese Markdown files in this repository are the source of truth.
`scripts/prepare-site.mjs` generates the VitePress pages under `docs/` and copies
chapter images into `docs/public/images/`. Generated files are ignored by Git.

## Local development

Requires Node.js 22 or newer.

```sh
npm ci
npm run docs:dev
```

Open the local URL printed by VitePress. English pages are under `/`, and Chinese
pages are under `/zh/`.

To check the production build:

```sh
npm run docs:build
npm run docs:preview
```

## Cloudflare Pages

Connect this repository to a Cloudflare Pages project with these build settings:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Root directory | `/` |
| Build command | `npm run docs:build` |
| Build output directory | `docs/.vitepress/dist` |

Cloudflare Pages installs the dependencies from `package-lock.json`, builds the
site, and publishes the static output. No Pages Functions or secrets are needed.
