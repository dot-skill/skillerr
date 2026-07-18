# Contributing to the Open `.skill` Protocol

Contributions are **welcome**. This protocol only becomes real if independent people implement, break, and improve it.

**Start here:** a curated list of concrete, scoped contribution targets, from quick fixes to the second-runtime call, lives in [docs/GOOD-FIRST-ISSUES.md](./docs/GOOD-FIRST-ISSUES.md). Labels: `good first issue`, `help wanted`, `second-runtime`, `rfc`, `adapter`, `documentation`, `spec`.

## Maturity

| Level | Meaning |
|-------|---------|
| Stable | Passes the reference conformance corpus; breaking changes require an RFC |
| Candidate | Feature-complete; breaking changes need RFC |
| Preview | Real, shipped, but the interface or scoring may still change without a major version bump |

The protocol is **1.0.0 (Stable)**. Reference packages are currently **1.5.2**. `@skillerr/skill-score` (`skill score`) is **Preview**; everything else in the reference packages is Stable. See [GOVERNANCE.md](./GOVERNANCE.md) for the full definition.

## DCO (required)

Every commit must be signed off (Developer Certificate of Origin):

```bash
git commit -s -m "feat: …"
```

See [DCO.md](./DCO.md). The DCO sign-off records that you may submit the
change under the MIT License.

## Branch flow

`main` only ever receives merges from a `release/*` or `hotfix/*` branch,
enforced by CI (a PR into `main` from anything else fails the
`enforce-branch-flow` check and can't merge). Everything else works
through `develop`:

- **Feature/task work**: branch off `develop`, PR back into `develop`.
- **`release/*`**: cut from `develop` when it's time to ship what's
  accumulated there. Bump versions on this branch, then PR it into `main`,
  that merge is the actual release (auto-publishes to npm, see
  [docs/PUBLISHING.md](./docs/PUBLISHING.md)).
- **`hotfix/*`**: for an urgent fix that can't wait for the next release.
  Branch off `main` directly, PR into `main` (ships immediately), then
  also merge the same fix back into `develop` so it isn't lost on the
  next release.

`develop` itself isn't published from directly; it's the integration
branch where day-to-day work accumulates between releases.

## Ways to contribute

| Kind | Examples | Difficulty |
|------|----------|------------|
| **Docs** | Fix typos, clarify FAQ, add diagrams | Easy |
| **Examples** | New golden `.skill` fixtures | Easy |
| **Tests** | Conformance cases, adversarial packages | Medium |
| **Adapters** | Host loaders, MCP bridge, `SKILL.md` export | Medium |
| **Runtime** | Additive step kinds, verify language | Medium |
| **Spec RFCs** | Additive fields, version bumps | Hard |
| **Second runtime** ⭐ | A Go/Rust/… implementation that passes the adversarial + canonicalization corpus | Hard, highest-leverage |

## Wanted: a second independent runtime

The protocol is Stable against the reference implementation's own corpus today, not gated on a second runtime. A second, independent runtime is still the single highest-leverage contribution available: it independently validates the spec against a hostile-input and canonicalization corpus no single implementation can fully self-certify, and it's what grows this from "one CLI" into an actual ecosystem. Go or Rust are natural choices. To count, it needs to reproduce, byte-for-byte:

- [`packages/cli/src/adversarial.test.ts`](./packages/cli/src/adversarial.test.ts)'s
  hostile-input corpus (path traversal, zip bombs, duplicate entries,
  tampered digests, stripped `issuer_class`, dev-HMAC-vs-untrusted). Every
  case must refuse with an equivalent distinct code, never a crash, never a
  silent accept.
- [`fixtures/canonicalization/vectors.json`](./fixtures/canonicalization/)'s
  RFC 8785 (JCS) test vectors, including the UTF-16-vs-code-point
  surrogate-pair case documented in
  [docs/CANONICALIZATION.md](./docs/CANONICALIZATION.md). This is the
  gotcha most re-implementations get wrong first.
- The determinism property: compiling the same `SkillSource` twice yields a
  byte-identical `package_digest` (see the pack/unpack tests in
  [`packages/core/src/core.test.ts`](./packages/core/src/core.test.ts)).

Ed25519 signature verification ([RFC 0001](./docs/rfcs/0001-asymmetric-signatures-trust-store.md),
now implemented, see [Key Ceremony](./docs/KEY-CEREMONY.md)) uses
standard PKCS8/SPKI PEM and raw Ed25519 signing with no protocol-specific
framing beyond the DSSE envelope shape in
[docs/PROTOCOL.md](./docs/PROTOCOL.md). Any language with an Ed25519
library and a canonical-JSON implementation can reproduce it.

Open an issue labeled `second-runtime` before starting, so effort isn't duplicated.

## Dev setup

```bash
git clone https://github.com/dot-skill/skillerr.git
cd skillerr
npm install
npm test
```

```bash
npm run skill -- --help
```

## Pull request checklist

- [ ] Commits are DCO signed (`Signed-off-by`)
- [ ] `npm test` passes
- [ ] Spec/docs updated if behavior changes
- [ ] New protocol behavior has a conformance fixture
- [ ] No secrets in examples
- [ ] Prefer **additive** changes
- [ ] If AI-assisted, say so in the PR (you remain responsible for the change)

## Spec changes (RFCs)

1. Open an issue with label `rfc` describing motivation, schema diff, migration, fixtures
2. Discuss before a maintainer adds it to [docs/rfcs/](./docs/rfcs/) as a pull request (RFCs live in-repo, versioned and PR-reviewable, not on the wiki)
3. Discuss before merging breaks


## License

- Code: [MIT](./LICENSE), [docs/LICENSING.md](./docs/LICENSING.md)
- Conduct: [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- Security: [SECURITY.md](./SECURITY.md)
