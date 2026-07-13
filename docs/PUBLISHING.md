# Publishing to npm (GitHub Actions + Trusted Publisher)

Packages publish from **GitHub Actions** with **npm Trusted Publishing** (OIDC) and **provenance**. Do not laptop-publish unless emergency.

Public install (document this only):

```bash
npm i -g skillerr
```

Bin: `skill` (also `skillerr`). One-shot: `npx -y skillerr --help`.

## How releases work

This repo has **two** GitHub Actions workflows — nothing else:

| Workflow | Triggers | What it does |
|----------|----------|--------------|
| **CI** (`ci.yml`) | PR + push to `main` | Install, test, build, `pack:check`. **No npm publish.** |
| **Publish** (`publish.yml`) | `v*` tag push or manual dispatch | Same checks, then publish all seven packages to npm with OIDC provenance. |

Public docs and GitHub Pages live in **[dot-skill/skillerr-com](https://github.com/dot-skill/skillerr-com)** — not here. This OSS repo is protocol + packages only.

### Release steps

1. **Merge to `main`** — CI must pass (Node 20 and 22).
2. **Bump versions** in workspace `package.json` files and update `CHANGELOG.md`.
3. **Tag and push** — the tag is the release marker; publish reads each package’s `package.json` version:

```bash
git tag v0.6.3
git push origin v0.6.3
```

4. **Publish workflow runs** — checkout → install → test → publish in dependency order. Versions already on npm are skipped.
5. **Or** after configuring Trusted Publisher: **Actions → Publish → Run workflow** on the tag ref (no need to re-tag if publish failed once).

### Why tags, not “merge to main = publish”

We **do not** publish on every merge to `main`. Tag-based releases are the standard OSS pattern because they:

- Prevent accidental publishes from routine merges
- Tie npm versions to an explicit, immutable git ref
- Work cleanly with npm Trusted Publisher (OIDC) and provenance
- Let you merge docs/fixes without shipping a new npm version

`workflow_run` after CI on `main` is intentionally **not** used — it is easy to publish the wrong commit or forget a version bump.

---

## Packages (all seven)

| # | npm package | Role |
|---|-------------|------|
| 1 | `@skillerr/protocol` | SkillContract, schemas, types |
| 2 | `@skillerr/core` | Compile, pack, validate, mint |
| 3 | `@skillerr/runtime` | Inspect / dry-run / execute |
| 4 | `@skillerr/registry` | Optional local transparency log |
| 5 | `@skillerr/workspace` | Local `.skill/` working tree |
| 6 | `@skillerr/cli` | CLI implementation |
| 7 | `skillerr` | **Public install** — unscoped meta package, bins `skill` / `skillerr` |

Maintainer account: **`csinye`** (owner on all seven). Scoped `@skillerr/*` uses `"publishConfig": { "access": "public", "provenance": true }`. Unscoped `skillerr` uses `"publishConfig": { "provenance": true }`.

**Do not** document `npm i -g dot-skill` or `npm i -g skill` — those names belong to other publishers.

Each package `repository.url` must be `https://github.com/dot-skill/skillerr.git`.

Workflow: [`.github/workflows/publish.yml`](../.github/workflows/publish.yml) — `permissions.id-token: write`, publish order above, skips versions already on npm.

---

## One-time: Trusted Publisher on npmjs.com

**Why:** Without Trusted Publisher, Actions fails with **`ENEEDAUTH`** — npm rejects OIDC because no publisher is registered for this repo/workflow.

**Who:** Log in to [npmjs.com](https://www.npmjs.com) as **`csinye`**.

**How:** There is no reliable npm CLI for Trusted Publisher — use the website **once per package** (seven times total). Each package must already exist on npm.

### Exact fields (same for all seven)

Open **Package → Settings → Trusted Publisher → GitHub Actions** and enter:

| Field | Value |
|-------|-------|
| **Organization or user** | `dot-skill` |
| **Repository** | `skillerr` |
| **Workflow filename** | `publish.yml` |
| **Environment name** | _(leave empty)_ |
| **Allowed actions** | `npm publish` |

Values are case-sensitive and must match the live repo that runs Actions: **`dot-skill/skillerr`**.

### Checklist — configure all seven

1. [@skillerr/protocol](https://www.npmjs.com/package/@skillerr/protocol) → Settings → Trusted Publisher  
2. [@skillerr/core](https://www.npmjs.com/package/@skillerr/core) → Settings → Trusted Publisher  
3. [@skillerr/runtime](https://www.npmjs.com/package/@skillerr/runtime) → Settings → Trusted Publisher  
4. [@skillerr/registry](https://www.npmjs.com/package/@skillerr/registry) → Settings → Trusted Publisher  
5. [@skillerr/workspace](https://www.npmjs.com/package/@skillerr/workspace) → Settings → Trusted Publisher  
6. [@skillerr/cli](https://www.npmjs.com/package/@skillerr/cli) → Settings → Trusted Publisher  
7. [skillerr](https://www.npmjs.com/package/skillerr) → Settings → Trusted Publisher  

After all seven are saved, optionally: **Settings → Publishing access → Require two-factor authentication and disallow tokens**, then revoke old automation tokens.

Official reference: [npm Trusted publishing](https://docs.npmjs.com/trusted-publishers/)

### What NOT to do

- **Do not** create an org-profile `dot-skill/.github` repo for branding — keep About/README on the product repo only.
- **Do not** need a classic `NPM_TOKEN` in GitHub Secrets if Trusted Publisher works on all seven packages.
- **Do not** set Repository to `dot-skill` — that was the old repo name before rename. Use **`skillerr`**.
- If you previously saved Trusted Publisher with Repository `dot-skill`, edit each package and change it to `skillerr`, then re-run Publish.

---

## Publish a release (quick reference)

**Prerequisite:** Trusted Publisher saved on all seven packages (Repository = `skillerr`).

See [How releases work](#how-releases-work) for the full pipeline. Short version:

```bash
# after versions bumped and merged to main with green CI
git tag v0.6.3
git push origin v0.6.3
```

`v0.6.3` Publish failed with `ENEEDAUTH` until Trusted Publisher is configured. After TP: **Actions → Publish → Run workflow** on ref `v0.6.3` (no need to re-tag).

---

## Verify provenance

```bash
npm view skillerr version
npm view skillerr dist.attestations
npm i -g skillerr
skill --help
```

On each package page at npmjs.com you should see **provenance** / “Built and signed on GitHub Actions” when the source repo is public and TP matched the workflow run.

---

## Optional fallback: `NPM_TOKEN` secret

Only if a package is not yet on npm or TP is not configured:

1. Create a granular npm token with publish permission for `@skillerr` / `skillerr`.
2. GitHub → **Settings → Secrets and variables → Actions** → secret name `NPM_TOKEN`.
3. `publish.yml` passes it as `NODE_AUTH_TOKEN` when present.

Remove `NPM_TOKEN` once every package has working Trusted Publisher.

---

## Local dry run

```bash
npm i && npm run build
npm pack -w skillerr --dry-run
```

Emergency laptop publish (requires `npm login` / OTP; no Actions provenance):

```bash
npm publish -w @skillerr/protocol --access public --otp=123456
# … same for core, runtime, registry, workspace, cli, then skillerr
```

---

## Deprecate old `@dot-skill/*` names

After `@skillerr/*` and `skillerr` are established:

```bash
npm deprecate @dot-skill/protocol@"*" "Moved to @skillerr/protocol — npm i @skillerr/protocol"
npm deprecate @dot-skill/core@"*" "Moved to @skillerr/core — npm i @skillerr/core"
npm deprecate @dot-skill/runtime@"*" "Moved to @skillerr/runtime — npm i @skillerr/runtime"
npm deprecate @dot-skill/registry@"*" "Moved to @skillerr/registry — npm i @skillerr/registry"
npm deprecate @dot-skill/workspace@"*" "Moved to @skillerr/workspace — npm i @skillerr/workspace"
npm deprecate @dot-skill/cli@"*" "Moved to @skillerr/cli; end users: npm i -g skillerr"
```

## GitHub Actions

| File | Purpose |
|------|---------|
| `.github/workflows/ci.yml` | Test/build on PR + `main` push. No publish. |
| `.github/workflows/publish.yml` | Test/build + npm publish on `v*` tags or `workflow_dispatch`. |

There is **no** Pages / docs deploy workflow in this repo. Site deploy is `dot-skill/skillerr-com`.
