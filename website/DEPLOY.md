# Deploy skillerr.com (GitHub Pages)

Free static hosting from **dot-skill/dot-skill** — no paid host, no org `.github` profile repo.

## What ships

- VitePress docs at `website/` (agent-first pages, Shimmer mark, Mermaid workflows)
- Tested `.skill` fixtures in `website/docs/public/fixtures/`
- `llms.txt` at site root for agents
- CNAME: `skillerr.com`

## One-time GitHub setup

1. **dot-skill/dot-skill** → Settings → Pages  
   - Source: **GitHub Actions**
2. Settings → Pages → Custom domain: `skillerr.com`  
   - Enforce HTTPS after DNS propagates

Workflow: `.github/workflows/pages.yml` (runs on push to `main` when `website/**` changes).

## DNS (registrar)

Apex `skillerr.com`:

| Type | Host | Value |
|------|------|-------|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |

Optional `www` → CNAME `dot-skill.github.io`

Verify: `dig skillerr.com +short` should return the four A records.

## Local build

```bash
cd website
npm ci
npm run build          # builds fixtures + static site
npm run fixtures:test  # validate / inspect / dry-run
npm run preview        # http://localhost:4173
```

Requires reference CLI built at repo root (`npm run build`).

## Pages (13 routes)

| Path | Content |
|------|---------|
| `/` | Overview + hero (Shimmer mark) |
| `/getting-started` | Copy-paste agent prompts |
| `/workflows` | Mermaid create / ingest / extract diagrams |
| `/create-a-skill` | Create path |
| `/ingest-a-skill` | Ingest path |
| `/agents` | Agent authoring rules |
| `/protocol` | Protocol spec overview |
| `/cli` | CLI reference |
| `/trust-and-security` | TrustView / SKILL_HOST honesty |
| `/fixtures` | Downloadable `.skill` + manifest |
| `/faq` | FAQ |
| `/roadmap` | Public roadmap |
| `/llms.txt` | Agent index |

## Fixtures

Built from `examples/` via `website/scripts/build-fixtures.mjs`:

- `knowledge-only.skill` (continuity)
- `parameterized-integration.skill` (continuity)
- `code-changing.skill` (continuity)
- `contract-foundation.skill` (release)

Manifest: `/fixtures/manifest.json`
