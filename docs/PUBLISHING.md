# Publishing to npm

Packages are published from GitHub Actions with **npm Trusted Publishing** (OIDC) and **provenance**. Prefer Actions over laptop publishes.

Based on [Trusted publishing](https://docs.npmjs.com/trusted-publishers/) and [npm-publish](https://docs.npmjs.com/cli/v8/commands/npm-publish).

## Public install (document this only)

```bash
npm i -g skillerr
```

Bin: `skill` (also `skillerr`). One-shot: `npx -y skillerr --help`.

### npm ownership

| Package | Maintainer | Notes |
|---------|------------|-------|
| `skillerr` | `csinye` | **Public install** — unscoped meta package, bins `skill` / `skillerr` |
| `@skillerr/*` | `csinye` (via `@skillerr` org) | Protocol libraries + CLI implementation |
| `dot-skill` (unscoped) | `titanwings` | **Not ours** — different product; do not install |
| `skill` (unscoped) | `tonglei100` | **Taken** — do not use |

Do **not** document `npm i -g dot-skill`, `npm i -g skill`, or scoped `@skillerr/…` as the public end-user install. Users install **`skillerr`** only. App authors may depend on `@skillerr/protocol`, `@skillerr/core`, and `@skillerr/runtime`.

Re-check anytime:

```bash
npm view skillerr name version repository maintainers
npm view @skillerr/cli name version
npm view skill name version maintainers
npm view dot-skill name version repository maintainers
```

## What gets published

Root is `"private": true`. Publish order (also used by `.github/workflows/publish.yml`):

| Order | Package |
|------|---------|
| 1 | `@skillerr/protocol` |
| 2 | `@skillerr/core` |
| 3 | `@skillerr/runtime` |
| 4 | `@skillerr/registry` |
| 5 | `@skillerr/workspace` |
| 6 | `@skillerr/cli` |
| 7 | `skillerr` |

Skip unscoped `dot-skill` and `skill` (owned by others). Scoped `@skillerr/*` packages use `"publishConfig": { "access": "public", "provenance": true }`. Unscoped `skillerr` uses `"publishConfig": { "provenance": true }`.

Each package `repository.url` must match the GitHub repository that runs the workflow (currently `https://github.com/dot-skill/dot-skill.git`). Provenance and trusted publishing require an exact match.

## One-time: npm org and login

```bash
npm login
npm whoami
```

Create the `@skillerr` npm organization (https://www.npmjs.com/org/create) if it does not exist, then ensure `csinye` is an owner.

## One-time: Trusted Publishing (OIDC) on npmjs.com

Do this **once per package** (each package has its own Trusted Publisher). Packages must already exist on npm (create via a first token publish if needed — see fallback below).

There is **no reliable npm CLI** to configure or audit Trusted Publishers today — use the npmjs.com UI while logged in as `csinye` (maintainer on all seven packages).

### Copy-paste checklist (live repo = `dot-skill/dot-skill`)

For **each** package below, open **Settings → Trusted Publisher → GitHub Actions** and enter **exactly**:

| Field | Value |
|-------|-------|
| Organization or user | `dot-skill` |
| Repository | `dot-skill` |
| Workflow filename | `publish.yml` |
| Environment name | _(leave empty)_ |
| Allowed actions | `npm publish` |

Do all seven (same fields every time):

1. https://www.npmjs.com/package/@skillerr/protocol → Settings → Trusted Publisher
2. https://www.npmjs.com/package/@skillerr/core → Settings → Trusted Publisher
3. https://www.npmjs.com/package/@skillerr/runtime → Settings → Trusted Publisher
4. https://www.npmjs.com/package/@skillerr/registry → Settings → Trusted Publisher
5. https://www.npmjs.com/package/@skillerr/workspace → Settings → Trusted Publisher
6. https://www.npmjs.com/package/@skillerr/cli → Settings → Trusted Publisher
7. https://www.npmjs.com/package/skillerr → Settings → Trusted Publisher

Notes:

- Values are case-sensitive and must match the repo that runs Actions (`dot-skill/dot-skill` today).
- Desired public name is `dot-skill/skillerr`. Until that rename lands, Trusted Publisher + `repository.url` must match live `dot-skill/dot-skill`.
- If the GitHub repo is renamed later, update every package’s Trusted Publisher fields and every `package.json` `repository.url` in the same change.
- After Trusted Publishing works, optionally go to **Settings → Publishing access** and select **Require two-factor authentication and disallow tokens**, then revoke old automation tokens.
- Do **not** create an org-profile `dot-skill/.github` repo for branding; keep About/README on the product repo only.

Official reference: https://docs.npmjs.com/trusted-publishers/

## Optional fallback: `NPM_TOKEN` GitHub secret

Preferred path is Trusted Publishing (no long-lived token). If a package is not yet configured for OIDC, or for the **first** publish of a brand-new package name:

1. On npmjs.com, create a granular access token with **publish** permission for the `@skillerr` org / `skillerr` package (or a classic automation token if you still use those).
2. In GitHub: **Settings → Secrets and variables → Actions → New repository secret**
3. Name: `NPM_TOKEN`
4. Value: the npm token

`.github/workflows/publish.yml` passes `NODE_AUTH_TOKEN` from this secret when present. With Trusted Publishing configured, modern npm prefers OIDC and still emits provenance; the secret is only a fallback.

Remove `NPM_TOKEN` once every package has a working Trusted Publisher.

## Cut a release (GitHub Actions)

**Prerequisite:** Trusted Publisher configured on all seven packages (checklist above). Prefer that over `NPM_TOKEN`.

1. Bump versions in workspace `package.json` files as needed (they do not all have to match; the workflow **skips** any `name@version` already on npm).
2. Commit and push to `main`. Confirm CI is green.
3. After TP is saved on npmjs, tag and push (tag is a release marker; publish uses each package’s `package.json` version):

```bash
git tag v0.6.1
git push origin v0.6.1
```

4. The **Publish** workflow runs on tag `v*`: installs, tests, then publishes in the order above with provenance (OIDC). Unchanged versions are skipped.
5. Or run **Actions → Publish → Run workflow** (`workflow_dispatch`) from the desired ref after versions are bumped — same publish path, useful once TP is configured.

Verify after publish:

```bash
npm view skillerr version
npm view skillerr dist.attestations
npm i -g skillerr
skill --help
```

On the npm package page you should see provenance / “Built and signed on GitHub Actions” when the source repo is public.

## Local dry run / emergency publish

Prefer Actions. For local verification only:

```bash
npm i && npm run build
npm pack -w skillerr --dry-run
```

Emergency laptop publish (requires `npm login` / OTP; no Actions provenance unless you use other attestation tooling):

```bash
npm publish -w @skillerr/protocol --access public --otp=123456
npm publish -w @skillerr/core --access public --otp=123456
npm publish -w @skillerr/runtime --access public --otp=123456
npm publish -w @skillerr/registry --access public --otp=123456
npm publish -w @skillerr/workspace --access public --otp=123456
npm publish -w @skillerr/cli --access public --otp=123456
npm publish -w skillerr --otp=123456
```

## Deprecate old `@dot-skill/*` names

After `@skillerr/*` and `skillerr` are on npm:

```bash
npm deprecate @dot-skill/protocol@"*" "Moved to @skillerr/protocol — npm i @skillerr/protocol"
npm deprecate @dot-skill/core@"*" "Moved to @skillerr/core — npm i @skillerr/core"
npm deprecate @dot-skill/runtime@"*" "Moved to @skillerr/runtime — npm i @skillerr/runtime"
npm deprecate @dot-skill/registry@"*" "Moved to @skillerr/registry — npm i @skillerr/registry"
npm deprecate @dot-skill/workspace@"*" "Moved to @skillerr/workspace — npm i @skillerr/workspace"
npm deprecate @dot-skill/cli@"*" "Moved to @skillerr/cli; end users: npm i -g skillerr"
```

## CI

- `.github/workflows/ci.yml` — tests on push/PR (`npm test`, `test:examples`, `pack:check`) for Node 20 and 22.
- `.github/workflows/publish.yml` — same checks, then publish on `v*` tags or manual dispatch.
