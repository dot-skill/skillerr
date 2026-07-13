# Publishing to npm (GitHub Actions + Trusted Publisher)

Packages publish from **GitHub Actions** with **npm Trusted Publishing** (OIDC) and **provenance**. Do not laptop-publish unless emergency.

Public install (document this only):

```bash
npm i -g skillerr
```

Bin: `skill` (also `skillerr`). One-shot: `npx -y skillerr --help`.

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

Each package `repository.url` must be `https://github.com/dot-skill/dot-skill.git` (live repo until rename to `dot-skill/skillerr`).

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
| **Repository** | `dot-skill` |
| **Workflow filename** | `publish.yml` |
| **Environment name** | _(leave empty)_ |
| **Allowed actions** | `npm publish` |

Values are case-sensitive and must match the repo that runs Actions (`dot-skill/dot-skill` today).

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
- **Do not** point Trusted Publisher at `dot-skill/skillerr` until that rename actually exists — use live `dot-skill/dot-skill`.
- If the repo is renamed later, update **every** package’s Trusted Publisher fields and **every** `package.json` `repository.url` in one commit.

---

## Publish a release

**Prerequisite:** Trusted Publisher saved on all seven packages.

1. Bump versions in workspace `package.json` files as needed (they need not all match; the workflow **skips** any `name@version` already on npm).
2. Commit and push to `main`. Confirm CI is green.
3. Tag and push (tag is a release marker; publish uses each package’s `package.json` version):

```bash
git tag v0.6.2
git push origin v0.6.2
```

4. The **Publish** workflow runs on tag `v*`: install, test, then publish in order with provenance (OIDC).
5. **Or** use **Actions → Publish → Run workflow** (`workflow_dispatch`) from the desired ref after versions are bumped — same path, useful right after configuring TP.

`v0.6.1` already exists as a tag; next publish after Shimmer assets is **`0.6.2`** on the `skillerr` meta package (scoped packages may stay at `0.6.0` until bumped — workflow skips unchanged versions).

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

## CI

- `.github/workflows/ci.yml` — tests on push/PR for Node 20 and 22.
- `.github/workflows/publish.yml` — same checks, then publish on `v*` tags or manual dispatch.
