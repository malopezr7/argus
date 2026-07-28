# Argus documentation site

The docs at [argus-hermes.pages.dev](https://argus-hermes.pages.dev), built with
[Astro](https://astro.build) + [Starlight](https://starlight.astro.build).

This directory is **outside** the pnpm workspace (`pnpm-workspace.yaml` only covers
`packages/*`), so it installs and builds on its own and never affects the runner's
dependency graph.

## Local development

```bash
cd website
pnpm install --ignore-workspace
pnpm dev        # http://localhost:4321
pnpm build      # static output in ./dist
pnpm preview    # serve the built output
```

## Content

Pages live in `src/content/docs/` as Markdown or MDX. The sidebar is declared explicitly in
`astro.config.mjs` — adding a page means adding a file **and** a sidebar entry.

Theme lives in `src/styles/global.css`: a cool slate scale with a muted amber accent,
layered on `@astrojs/starlight-tailwind`.

## Deployment

Cloudflare Pages project `argus-hermes`, static output.

Every push to `main` that touches `website/` runs
[`.github/workflows/docs-deploy.yml`](../.github/workflows/docs-deploy.yml), which builds
and deploys. It needs two repository secrets and skips itself with a notice when they are
absent:

| Secret | Where to get it |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens, with **Cloudflare Pages: Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → Account ID |

From a local machine:

```bash
cd website
pnpm build
wrangler pages deploy dist --project-name argus-hermes
```
