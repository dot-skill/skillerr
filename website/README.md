# Skillerr docs site (VitePress)

Agent-first documentation for [skillerr.com](https://skillerr.com). Source lives in `website/docs/` in this repo.

## Run locally

```bash
# From repo root — build reference CLI first
npm run build

cd website
npm install
DOT_SKILL_ROOT=.. npm run fixtures:build
npm run dev              # http://localhost:5173
```

## Build

```bash
npm run build            # fixtures + vitepress build → docs/.vitepress/dist
npm run preview          # serve production build
npm run fixtures:test    # validate / inspect / dry-run all fixtures
```

## Deploy (GitHub Pages)

The live deploy workflow is [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) in this repo. After push to `main`, Pages serves `skillerr.com` from the built artifact.

See [DEPLOY.md](./DEPLOY.md) for DNS and custom-domain steps.
