# Changelog

## 0.9.9 — 2026-07-15

Phase F, scoped down to what actually belongs in this repo: a
license/terms manifest slot. `manifest.license` already existed in the
type and JSON schema but was completely dormant — never settable from
`SkillSource`, never surfaced by any command, undocumented anywhere.
Wired it up end to end: `SkillSource.license`/`.license_url` ->
`compileSkillSource`/`compileRecipeToSkill` (with a `CompileOptions`
override, same pattern as `title`/`description`) -> `manifest.license`/
`.license_url` -> surfaced in `skill inspect`'s summary. New
`license_url` field alongside the existing `license` (SPDX identifier)
for terms a bare SPDX id can't capture. Self-reported like npm's
`package.json` `license` field — documented as such in
`WHAT-IS-VERIFIABLE.md`'s self-reported table, not implied to be
verified.

The other two pieces of the original "Phase F: commerce/publisher
identity foundations" sketch were already shipped by the time this was
scoped: Fulcio-based verified publisher identity is `--keyless`'s
`owner_identity` (0.9.7), and `skill score` already exists as a
quality signal. No commerce/payment/marketplace code lands in this
repo — the protocol stays payment-agnostic, per `docs/TRANSPARENCY.md`'s
"What this is not".

## 0.9.8 — 2026-07-15

Phase E2: per-claim assurance model. `docs/WHAT-IS-VERIFIABLE.md` has
always drawn a line in prose between what's cryptographically checked
and what's merely self-reported — but nothing stopped a UI or an agent
parsing TrustView's JSON from displaying a self-reported field (like
`agent.host`) next to a "verified" badge, since both kinds of claim
sat in the same flat object with no machine-readable assurance tag.

New `assessClaims()` in `@skillerr/core` fixes that structurally: every
claim goes into exactly one of two separate arrays, `verified` and
`self_reported` — never a single array with an easy-to-ignore boolean
flag. A consumer that only ever reads `.verified` cannot end up
displaying self-reported data, because it's never in that array to
begin with. Performs no new cryptography — it only organizes results
that `inspectTrustView`/`verifyRekorAnchor`/`verifyKeylessAnchor`
already computed.

Found and fixed a real bug while wiring this up: `TrustView.issuer` is
actually `attestation.agent.runtime` (which tool minted the package),
not the signer's `key_id` — a naming trap in the existing type that
would have made `assessClaims` classify the wrong field as the
trust-store-checked issuer. The real pinned key identifier is
`agent.key_id`; fixed before this shipped, caught by a test that
compared the classified value against the actual key_id used to mint.

`skill inspect --trust --claims` (offline; anchors not re-verified) and
`skill verify-trust --claims` (includes transparency/keyless anchor
verification results when present) both expose this.

## 0.9.7 — 2026-07-14

Fulcio keyless mint: `skill mint --keyless` adds a second, independent
anchor (`PermanenceAnchor { kind: "keyless_identity" }`) alongside
whatever the container's own seal already is — an ephemeral, single-use
keypair signed by a Fulcio-issued certificate bound to your OIDC
identity, then logged to Rekor exactly like `--transparency`. Never
replaces or weakens `mintSkillPackage`'s own signing path, and is
deliberately kept as a separate trust mechanism from `verified_issuer`:
a one-time key has no stable `key_id` to pre-pin in a trust store, so
`skill verify-trust` checks a `keyless_identity` anchor by verifying
the certificate chains to Fulcio's CA, not by trust-store lookup, and
always re-derives `owner_identity` from the certificate at verify
time — never from the anchor's own stored claim.

Ships the CI-ambient OIDC path only (zero setup inside GitHub Actions'
`id-token: write`, reusing the same mechanism this repo's own `npm
publish --provenance` already depends on; fails closed outside such an
environment). An interactive/browser-login path for local use is not
yet implemented — tracked in `docs/ROADMAP.md`.

New `mintKeylessAnchor`/`verifyKeylessAnchor` in `@skillerr/core`;
`rekorSearchUrl` now also recognizes `keyless_identity` anchors on the
public Rekor instance. Tested against a synthetic, checked-in test-only
CA (`fixtures/transparency/keyless-test-pki.json`, generated once with
openssl) covering `mintKeylessAnchor`'s certificate-parsing logic and
`verifyKeylessAnchor`'s pre-crypto checks (digest match, anchor kind,
certificate presence) — the full crypto positive path (real Fulcio
cert chaining to the real trusted root, real Rekor inclusion proof)
isn't fixture-tested here, the same way `verifyRekorAnchor`'s positive
path needed a real captured bundle rather than a synthetic one; it
would need an actual GitHub Actions run with `id-token: write` to
capture, which is a separate live-infrastructure decision.

Also fixed a design mismatch in `docs/rfcs/0001-asymmetric-signatures-
trust-store.md`: the original RFC sketched keyless signing as a future
`issuer_class` value on the container's own seal. What shipped is
different (and more conservative) — a separate, additive anchor, never
a change to `issuer_class` — documented as a superseded-by-what-shipped
delta, matching this RFC's existing convention for PROTO-2.

## 0.9.6 — 2026-07-14

Independent Rekor verification, everywhere a trust verdict is shown.
Neither the CLI nor `www.skillerr.com`'s verify page should be able to
tell you "this is verified" without also handing you a way to check
that for yourself. New `rekorSearchUrl()` in `@skillerr/core` builds a
`search.sigstore.dev` link for a verified `transparency_log` anchor —
deliberately `undefined` (not a guessed/broken link) unless the anchor
is on the public `rekor.sigstore.dev` instance, since a self-hosted
Rekor has no public search UI.

- `skill mint --transparency` now prints the link the moment an anchor
  is created; `skill verify-trust` prints it every time it re-verifies
  one (the more common moment, since verification happens far more
  often than minting).
- `anchorToRekor()` now returns `log_index` directly (it already had
  the data internally) instead of callers needing to re-parse the
  receipt bundle.
- Also fixed two stale claims in `docs/TRANSPARENCY.md` found while
  editing it: it named `MessageSignatureBundleBuilder` (the actual
  implementation uses `DSSEBundleBuilder`, changed earlier for
  Ed25519/Rekor compatibility — see the `## Verification` section),
  and described `--keyless`/Fulcio in the present tense as if already
  shipped, when it isn't (`docs/ROADMAP.md` and
  `docs/WHAT-IS-VERIFIABLE.md` already correctly tracked it as
  planned — this doc alone was out of sync).

## 0.9.5 — 2026-07-14

`@skillerr/protocol`'s `loadSchema()` read its JSON Schema files via
`new URL(relativePath, import.meta.url)` where `relativePath` came out
of a lookup object — a variable, not a literal, at the call site. That
defeats static file-tracing bundlers (e.g. Vercel's `@vercel/nft`, used
to decide which files ship with a serverless function): they recognize
`new URL('./literal.json', import.meta.url)` as an asset reference only
when the path is an inline literal. Any bundled consumer of
`@skillerr/protocol` doing schema validation was silently missing these
files in production. Rewrote each schema path as its own literal
`new URL(...)` call site; the JSON files themselves haven't moved.

## 0.9.4 — 2026-07-14

`www.skillerr.com` is now live (Vercel) — docs served at `/docs/`, the
bare root reserved for a future product built on top of this protocol
(decided now, while backlinks are minimal, rather than migrating URLs
later). Every reference to the old `dot-skill.github.io/skillerr-com`
URL updated, including one genuine user-facing bug: `skill --help`'s
own footer was printing the stale docs URL to every CLI user. Also
updated every package's `package.json` `homepage` field (shown on
their npmjs.com pages) and all 3 GitHub repos' website metadata.

## 0.9.3 — 2026-07-14

README content pass: the orange "0.5.0 draft" badge and a
limitation-first sentence about the default signing key were reading
as "this project looks unfinished" even though the underlying facts
(protocol is a draft spec, default mint key is dev-only) are accurate
and necessary disclosures, not things to hide. Reframed rather than
removed:

- Badge recolored (no more alarm-orange) and a "148 tests passing"
  badge added alongside it — the spec evolving in the open and the
  reference implementation being solidly tested are both true at once.
- The signing-key bullet under "What good looks like" now leads with
  the capability ("real cryptographic identity in production") instead
  of the limitation ("default is dev-only") — same fact, told straight
  instead of as a disclaimer.
- Status section now states the RFC process explicitly ("evolving in
  the open... not frozen and not abandoned") and cites the actual test
  count / CI matrix / adversarial corpus, so "draft" reads as "active
  spec process" rather than "abandoned/incomplete."
- Left every "continuity draft" mention untouched — that's real
  protocol vocabulary (the non-mintable handoff-object profile), not
  project-maturity signaling, and conflating the two would have made
  the README less accurate, not more confident.

## 0.9.2 — 2026-07-14

Removed the banner image from the README (both GitHub and, via the sync
script, npm) — a single mark image is the intended header, not a banner
plus a mark.

## 0.9.1 — 2026-07-14

Fixes the actual root cause behind repeated "npm README doesn't match
GitHub" reports: `packages/skillerr/README.md` (npm) and root `README.md`
(GitHub) were two independently hand-edited files with nothing forcing
them to stay in sync — every prior "fix" (0.7.1, 0.8.0) patched the
symptom for one release and then the files drifted apart again the next
time either one was edited alone.

- New `scripts/sync-npm-readme.mjs` generates `packages/skillerr/README.md`
  from the root `README.md` (relative links/images rewritten to absolute
  GitHub URLs, since the npm copy has no repo checkout backing it). Wired
  into `packages/skillerr`'s `prepack` script, so it runs automatically
  before every `npm publish`. `packages/skillerr/README.md` must never be
  hand-edited again — edit `README.md` and re-run the sync.
- New CI step (`Verify npm README is in sync`) fails the build if someone
  edits one without the other — unlike the `brand` job's PNG check, this
  is pure text transformation, fully deterministic across OS, so a strict
  diff is safe here.
- Fixed remaining brand-as-subject phrasing this pass's earlier sweeps
  missed (`docs/WHY.md`): "Skillerr is not a competing format" reads as
  a company pitching against a competitor; the actual claim is about the
  `.skill` format, not a company.

## 0.9.0 — 2026-07-14

Launch Readiness Phase E (partial) — optional public transparency-log
anchoring via Rekor, built on the official `@sigstore/*` client libraries
rather than a hand-rolled Merkle-proof implementation. See
docs/TRANSPARENCY.md for what this proves and doesn't.

- `skill mint --transparency [--rekor-url <url>]` — after signing (requires
  `--signer-key`; the public-dev HMAC path is never anchored), submits the
  sealed manifest digest to a Rekor transparency log and attaches the
  result as a `transparency_log` PermanenceAnchor. A mint with no network
  access still succeeds exactly as before, just without an anchor —
  anchoring is additive, never a new failure mode for minting itself.
- `skill verify-trust` now checks any `transparency_log` anchor's Rekor
  inclusion proof offline (cached sigstore trusted root, no live query)
  against the pinned issuer key. `--online` additionally re-fetches the
  entry live from Rekor as an extra check.
- Real architecture finding, not just a config knob: Rekor's hashedrekord
  entry type requires Ed25519 signatures to be Ed25519ph (SHA-512
  prehash) — confirmed against the live public instance — but
  `@sigstore/sign`'s message-signature bundler hardcodes SHA-256 with no
  override. Fixed by using a DSSE-envelope bundle instead, which Rekor
  verifies directly without a hash-algorithm mismatch, and works with our
  existing pure-Ed25519 signer unchanged.
- Caught and fixed a real verification bug during testing: `@sigstore/verify`'s
  DSSE signature content never compares the envelope's payload against the
  digest being checked — only the signature's internal consistency.
  Without an explicit payload comparison (now added), a validly-signed,
  validly-logged anchor for a *different* digest would have incorrectly
  verified as valid for any digest.
- Tested against the real public Rekor end to end (`keygen` → `pack` →
  `mint --transparency` → `verify-trust --online`), not just unit tests.
  The automated suite itself runs fully offline: `anchorToRekor`'s tests
  inject a stub witness, and `verifyRekorAnchor`'s positive-path test uses
  a real bundle captured from a genuine (disposable-key) Rekor submission
  — fixtures/transparency/rekor-anchor.json — not a synthetic mock of the
  verification math.
- Not yet done (tracked, not silently skipped): Fulcio keyless signing
  (`--keyless`), the public verify API + website utility, and Phase E2's
  per-claim assurance model. See ROADMAP.md.

## 0.8.1 — 2026-07-14

Launch Readiness Phase D — plain-language trust/threat/verifiability docs.
No behavior changes except one additive field.

- New `docs/TRUST-MODEL.md` — plain-language explanation of the four
  `trust_state` values, explicit that `development`/`self_reported` are
  not safe to run blindly, why `SKILL_HOST` alone is `self_reported`, why
  the bundled key is dev-only, and exactly when `execute` refuses.
- New `docs/WHAT-IS-VERIFIABLE.md` — attribute-by-attribute breakdown of
  what's cryptographically proven vs. key-bound-but-not-publicly-verifiable
  vs. purely self-reported. Linked prominently from README, FAQ, and
  `skill verify-trust`'s own JSON output (new `docs` field).
- New `docs/FROM-SKILL-CREATOR.md` — the exact `skill ingest` mapping
  table and what's always left for a human to complete before release.
- `docs/RUNTIME.md` gained a step-kind support matrix: all 12
  `WorkflowStepKind`s, executed vs. dry-run-only vs. always-refuses, with
  exact refusal messages for `delegate`/`subskill`/unsupported `tool`/
  `transform` cases.
- Fixed two more stale "reference mint is unconditionally dev-only HMAC"
  claims in `docs/FAQ.md` that earlier passes missed (same class of fix
  as 0.7.1/0.8.0, just a different file).

## 0.8.0 — 2026-07-14

Every package back to lockstep versioning (all 7 at the same number, all
internal `@skillerr/*` ranges matching) — fixes real version drift where
`core`/`runtime`/`skillerr` had quietly diverged from the rest. Bundles
Launch Readiness Phases A and B:

**Phase A — launch blockers:**
- `skill ingest` printed a stale `package_digest` — computed before
  resources/assets were merged into the compiled package, so it never
  matched what was actually written to disk. Now re-finalizes the
  manifest after the merge, before packing.
- `skill score` returned `ok:false` when the optional `@skillerr/skill-score`
  peer isn't installed, even though the mapped `assessment.json` was
  written successfully — not an error. Now `ok:true, scored:false` with
  a `notice` field.

**Phase B — first-run polish:**
- Registered `ajv-formats` so `validate`/`inspect --trust`/`score` stop
  printing `unknown format "date-time" ignored` noise.
- `skill score --emit` without `-o` silently overwrote the *original*
  input file — contradicting the CLI's own usage text, which promises
  "a sealed copy." Now defaults to a `<name>.scored.skill` sibling
  instead of touching the input.
- `skill_id` was already a content digest (stable across re-ingests of
  identical source) but this wasn't verified by a test or documented;
  `package_digest` is *not* stable across real-world re-ingests, because
  each run's `created_at` is a genuine distinct timestamp — that's
  correct provenance, not a bug. Both now locked in by a regression test
  and documented in docs/FAQ.md.

## 0.7.1 — 2026-07-14

`skillerr`, `@skillerr/core`, `@skillerr/runtime` only — README fixes.

- READMEs led with "Skillerr" as a brand title; `skillerr` is the package/CLI
  name, not the project identity — protocol-first framing to match the site.
- Fixed READMEs (`skillerr`, `core`, `runtime`) that still claimed reference
  mint is unconditionally dev-only HMAC; a configured Ed25519 signer key
  mints as `verified_issuer` (shipped in 0.7.0, docs hadn't caught up).

## 0.7.0 — 2026-07-14

First real publish of `@skillerr/protocol`, `@skillerr/core`, `@skillerr/runtime`,
`@skillerr/registry`, `@skillerr/workspace`, and `@skillerr/cli` since their
initial `0.6.0` release — that version was published on day one and never
updated, so every fix and feature below existed only on `main` until now.
`npm i -g skillerr` previously resolved `@skillerr/cli@^0.6.0`, which was
the pre-hardening skeleton; it now resolves `0.7.0`.

- Security hardening (Tier 0-4): closed network/filesystem allowlist
  bypasses, real HMAC-SHA256 seal envelope, manifest self-digest, streamed
  zip unpacking (duplicate-entry / zip-bomb resistant), adversarial
  package corpus run on every `npm test`, RFC 8785 canonicalization with
  cross-implementation vectors, content-addressed `skill_id`
- Pluggable Ed25519 issuer signer + local trust store
  (`issuer_class: configured_ed25519` → `trust_state: verified_issuer`),
  replacing dev-HMAC-only trust — see `docs/KEY-CEREMONY.md`
- `skill ingest`: forward `SKILL.md` → `.skill` conversion, distinct from
  the existing lossy `to-skill-md` export
- Native eval/benchmark loop (`skill eval`) with a sealed
  `provenance/benchmark.json`
- `@skillerr/skill-score` wired in as an optional dependency of the CLI
  (`skill score`) — gracefully degrades to a mapped `assessment.json`
  when not installed, never fabricates a number
- Structured permission grammar for `permission.hosts`/`.paths`, validated
  at both authoring and manifest-validation time
- JSON Schemas (draft 2020-12) for every container file, checked by
  `skill validate`
- Bundled-script / progressive-disclosure semantics
  (`resources/scripts/*`, `resources/references/*`); found and fixed a
  real gap where `exec`-class capabilities had no deny-by-default gate
- Public RFC folder (`docs/rfcs/`) — six RFCs
- Fixed `skill mint <file>` requiring a workspace even with an explicit
  file argument, unlike every other file-taking CLI command

## 0.6.4 — 2026-07-13

- New transparent `.skill` mark — coffee-wave scroll motif replaces stacked diamonds; teal accent on waves.
- Public homepage and doc links point at live GitHub Pages (`https://dot-skill.github.io/skillerr-com/`) until `skillerr.com` DNS is set.

## 0.6.3 — 2026-07-13

- Replace Arcane Shimmer banner with a plain diagrammatic `.skill` insides README banner (identity, instructions, capabilities, seal, assets).
- Update square mark to a clean `.skill` glyph; remove Shimmer from README hero copy.

## 0.6.2 — 2026-07-13

- Ship Arcane Shimmer brand identity (cinematic banner + pixel skill-core mark) for Skillerr / `.skill`.
- Supersedes provisional mark assets in README and the `skillerr` npm package.

## 0.6.1 — 2026-07-13

- Ship brand mark assets in the public `skillerr` npm package.
- Keep repository links on `dot-skill/skillerr` (renamed from `dot-skill`).

## 0.6.0 — 2026-07-13

- Renamed npm scope from `@dot-skill/*` to `@skillerr/*` (protocol, core, runtime, registry, workspace, cli).
- Public install remains `npm i -g skillerr` (bins: `skill`, `skillerr`).
- Homepage and docs point to [skillerr.com](https://dot-skill.github.io/skillerr-com/); repository URLs track `dot-skill/skillerr`.
- Local registry default path is `~/.skillerr/registry/log.jsonl` (reads legacy `~/.dot-skill/…` if present).
- Preserved `.skill` artifact extension and wire identifiers (`kind: "dot-skill"`, `application/vnd.dot-skill+zip`).

## 0.5.0 — 2026-07-13

- Added the product-neutral `SkillContract` as the release compilation source of truth.
- Added explicit declarations for triggers, typed inputs/outputs, preconditions,
  ordered steps, branches, human decisions, capabilities, permissions/consent,
  forbidden actions, recovery, verification, corrections, and provenance.
- Added contract scaffold, assessment, explanation APIs, CLI commands, and JSON Schema.
- Preserved structured contract fields in manifests and workflows.
- Made 0.4 text-only sources explicitly lossy and continuity-only.
- Added runtime refusal for unsupported assertions/branches and authenticated
  human-decision callbacks that cannot be spoofed with input values.
- Added approved npm-publishing gold-model conformance coverage.
- Added per-package READMEs and included them in npm tarballs.
- Public install package is `skillerr` (depends on `@skillerr/cli`, exposes the `skill` bin).
- Hardened public docs and CLI help for create vs ingest paths.
- Added agent multi-skill identify path: `skill agent-guide`, `skill extract` / `skill segment`,
  protocol `extractSkillCandidates` / `agentCreateGuide`, and incomplete SkillContract scaffolds
  with completeness reports (one workspace per candidate; release still refuses if incomplete).

## 0.4.3 — 2026-07-13

- Derived CLI, runtime, and attestation package versions from shipped package metadata.
- Added conformance coverage for package version reporting.

## 0.4.1 — 2026-07-12

- Added local and offline agent provenance fields.
- Enforced release completeness and approval checks before minting.
- Added runtime trust-profile checks and mandatory minted signatures.
- Added privacy scrubbing for journey, prompt, and endpoint provenance.
- Added MIT licensing, DCO sign-off, and npm release documentation.

## 0.4.0 — 2026-07-12

- Added continuity and release compile profiles.
- Added completeness gates and `CompileRefusalError`.
- Added agent host provenance and optional generation usage.
- Added workspace checkpoint, load, compile, and journey commands.
- Added public npm package configuration.

## 0.3.0

- Added the protocol, core, runtime, registry, workspace, and CLI packages.
