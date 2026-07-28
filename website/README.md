# Argus documentation site

The docs at [argus.pages.dev](https://argus.pages.dev), built with
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

Cloudflare Pages, static output.

| Setting | Value |
|---|---|
| Root directory | `website` |
| Build command | `pnpm install --ignore-workspace && pnpm build` |
| Output directory | `dist` |
| Node version | 22 or later |

Or from a local machine:

```bash
cd website
pnpm build
pnpm dlx wrangler pages deploy dist --project-name argus
```
