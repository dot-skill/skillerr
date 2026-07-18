# Changelog

## 1.5.2 (2026-07-18)

Process change, no functional code change: adopted a git-flow branching model. `main` now only accepts merges from `release/*`/`hotfix/*` branches (enforced by a required `enforce-branch-flow` CI check plus branch protection); day-to-day work now goes through `develop`. See `CONTRIBUTING.md`'s new "Branch flow" section.

## 1.5.1 (2026-07-18)

Doc fix: several docs (`docs/PROTOCOL.md`'s opening status line, `docs/FAQ.md`, `README.md`, `GOVERNANCE.md`, `CONTRIBUTING.md`) mentioned the protocol spec version ("1.0.0 (Stable)", correct and intentionally static) with no package/CLI version anywhere nearby, reading as if the whole project were stuck at 1.0.0 even though the reference CLI ships releases regularly. Every one now states the current package version alongside it. `scripts/check-doc-versions.mjs` now fails CI if a doc mentions the protocol version without also mentioning the current package version somewhere in the same file, so this can't silently recur.

## 1.5.0 (2026-07-18)

**External-agent bug sweep: fixed real bugs found by a real AI agent testing the CLI end to end, not just documentation nits.**

- Fixed a real gap in [RFC 0007](./docs/rfcs/0007-subject-bearing-transparency-anchor.md#errata-found-in-skillerr150-the-payload-wasnt-actually-retrievable):
  `anchorToRekor`/`mintKeylessAnchor` submitted through Rekor's hash-only
  `dsse` entry kind, so the subject-bearing statement (`skill_id` etc.) was
  signed correctly but never actually retrievable from the public log, only
  its hash was. Now uses `entryType: "intoto"`. Verified against a real
  throwaway-key submission to the public Rekor log: the old kind has no
  `attestation` field under any endpoint; the new kind's `attestation.data`
  decodes straight to the statement.
- `skill publish`/`skill mint --transparency` help text and runtime
  messages now lead with exactly what goes public (`skill_id`,
  `skill_version`, `issuer_class`, two SHA-256 digests, nothing else) and
  what never does (the `.skill` file, its title, intent, knowledge,
  journey, assets). A real agent had refused to run `skill publish` out of
  an inaccurate fear that it would expose skill content.
- `inspectTrustView`/`TrustView` now surface `manifest.anchors`. A package
  that was `skill publish`ed but still carries the default dev seal used to
  read as flatly "DEVELOPMENT seal, not production trust" with zero mention
  that a public, independently-checkable anchor also exists on it.
- Fixed a real crash + silent-validation-skip bug: `assessSkillContract`'s
  item validator silently accepted a plain string wherever a structured
  object was required (`permissions`, `inputs`, `branches`,
  `human_decisions`, `capabilities`, `outputs`, `steps`, etc.), so
  `contract-check` reported a contract "complete" when it actually crashed
  the compiler downstream (`undefined.localeCompare` sorting by a `.name`
  that didn't exist). Now flags the type mismatch directly, at the earliest
  possible point.
- `skill contract-check` never ran real JSON Schema validation on the
  contract at all, only the hand-rolled completeness check above, so a bad
  enum (e.g. a garbage `skill_kind`) or wrong type also passed silently
  until mint time. New `validateContractSchema` (`@skillerr/core`), wired
  into `contract-check`'s output as a separate `schema_issues` array.
- `skill compile --mint` now runs the same schema/workflow-integrity check
  `verify-trust` runs before signing. Previously it only checked the
  contract-level completeness report, which never inspected the compiled
  workflow graph, so a package with a dangling step reference could be
  minted, signed, and (via `skill publish`) permanently anchored to the
  public log before `verify-trust` ever caught it.
- Trust labels (`inspectTrustView`, `inspectSkill`, `assessClaims`) are
  shorter and no longer read as machine-generated filler ("VERIFIED ISSUER
  seal, host claims bound by configured issuer" → "Verified issuer");
  supplementary detail moved into the existing `warnings` array instead of
  being crammed into the headline label.
- Simplified the copy-paste "Talk to your AI" prompts in `README.md`: they
  no longer spell out install/`SKILL_HOST` setup or the `{{refs}}` secrets
  mechanic. A competent agent reads skillerr's own `--help`/docs and asks
  for whatever it needs; walking through that in every prompt was noise.

## 1.4.0 (2026-07-18)

**Consistency sweep: docs, wiki, and agent guidance.**

- Fixed a real bug: `skill agent-guide`'s header printed the bare protocol
  spec version ("v1.0.0") with no qualifier, reading exactly like "the tool
  is on 1.0.0" even though the CLI itself was already well past that. Now
  labeled clearly ("spec vX.Y.Z, skillerr CLI vA.B.C"), and the JSON output
  (`--json`) carries `skillerr_cli_version` alongside `protocol_version`.
  Fixed two stale "Protocol v0.5" header comments in `@skillerr/protocol`
  (the spec has been 1.0.0 for a while).
- `skill agent-guide`'s guidance content was written before the
  ingest-to-release bridge and `skill publish` shipped, it never mentioned
  either. Added a full "convert an existing SKILL.md to a signed release +
  public provenance URL" section, and an explicit reminder to prefer
  `skill <command> --help` over memorized examples (exact flags drift
  across releases, `--help` output can't). `docs/AGENT.md` updated to
  match.
- New [docs/CLI-FLOW.md](./docs/CLI-FLOW.md): the complete current
  lifecycle in one page, entry points, sealing a release, publishing a
  provenance URL, inspecting a package you received, with the same
  prefer-`--help` guidance throughout.
- New `scripts/check-doc-versions.mjs`, wired into CI: fails the build if
  a hardcoded "reference packages X.Y.Z" mention drifts from
  `packages/skillerr/package.json`, or if the test-count badge and prose
  in README.md disagree. (The npm-README sync check already existed in
  CI, verified still working, not duplicated.)
- Wiki cleanup: removed `Key-Ceremony.md`, `RFCs.md`, and `RFC-0001`
  through `RFC-0006`, all superseded duplicates left behind when this
  content moved back into `docs/rfcs/` and `docs/KEY-CEREMONY.md` in an
  earlier release. The wiki's own RFC index was stale (missing RFC 0007
  and 0008, both already shipped). `Home.md` and `Threat-Model.md` now
  point at the real, current repo locations. `Naming.md` kept (real
  contributor value), its rebrand-history narrative removed.
- Fixed a real staleness bug this sweep exists to prevent: `docs/ROADMAP.md`
  still said "seven RFCs... RFC 0007... have since shipped", missing that
  there are now eight RFCs and RFC 0008 has also shipped.

## 1.3.0 (2026-07-17)

**Frictionless lifecycle: ingest to signed release to a public provenance URL.**
Closes the two flow gaps a fresh-context agent hit walking the protocol end to
end.

- **Ingest to release bridge.** `skill load <file.skill> --into <dir>` (or plain
  `skill load` inside a workspace) now materializes a package into an editable
  workspace, staging its knowledge as sections and writing `.skill/contract.json`,
  so an ingested continuity package can actually be taken forward to a release.
  It never fabricates `provenance.human_review` (a human still records that in
  the contract). With no workspace and no `--into`, `skill load` stays a
  read-only handoff preview, now labeled honestly via a `mode` field.
- **Zero-setup public provenance URL.** New `skill publish <file.skill>` seals a
  release and anchors its digest to the public Sigstore Rekor transparency log,
  printing an independently-verifiable `search.sigstore.dev` URL. The public log
  needs a signing key but no login, so a per-user Ed25519 issuer key is
  auto-provisioned on first use (`~/.skillerr/issuer-key.pem`, pinned in your own
  trust store) and reused after. `skill mint --transparency` gets the same
  auto-key, removing the old "requires --signer-key" dead end.
- **Honest trust, not a shortcut.** The transparency anchor is decoupled from the
  `verified_issuer` evidence gate: a signer without real agent-runtime evidence
  now binds `self_reported` instead of throwing, so the public anchor works while
  the seal stays honest. Auto-provisioning a key never fabricates evidence or
  inflates trust_state.
- `skill keygen` (no `-o`) provisions/pins the default per-user issuer key; `-o
  <dir>` keeps the named production key-ceremony path. Only `--keyless` (Fulcio
  OIDC) still requires an identity provider, and only in CI.
- Fixed subcommand `--help` (was opening `--help` as a file / hitting
  requireWorkspace).

Docs across the repo and site were swept for consistency with the corrected
flow. 198 tests (was 189).

## 1.2.0 (2026-07-16)

**Agent Skills ecosystem compatibility (RFC 0008).** `skill ingest` now maps the
full [Agent Skills](https://agentskills.io/specification) frontmatter, not just
name/description: `license`, `compatibility`, nested/dotted `metadata`, and
`allowed-tools` (recorded as proposed permissions requiring explicit human
consent, never auto-authorized, the same deny-by-default posture as bundled
scripts). Multi-skill folders are recognized via the same plugin-manifest and
`skills/<name>/` catalog conventions `vercel-labs/skills` itself uses.

- New `skill export-skill <file.skill> -o <dir> [--agent claude|cursor|<host>]`
  reverses a sealed `.skill` back into a spec-valid, installable Agent Skills
  folder, restoring license/compatibility/metadata/allowed-tools and
  materializing `scripts/`/`references/`/`assets/`. `--agent` computes the
  standard install directory automatically.
- New `skill verify-skill <dir> [--attestation <file.skill>]` checks a plain,
  never-ingested Agent Skills folder honestly: content digest and executable
  surface always, and (if a sealed sidecar exists) that attestation's own
  signing integrity, never implying more was checked than actually was.
- Fixed a real bug: a `-m` compile message could silently override a
  workspace's already-configured title.
- New `docs/AGENT-SKILLS.md` compatibility matrix; see
  [RFC 0008](./docs/rfcs/0008-agent-skills-ecosystem-compatibility.md).

**Positioned as the cryptographic trust standard for AI skills.** README and the
npm listing now lead with identity (content-addressed digests), authorship
(Ed25519 + Sigstore Fulcio keyless, DSSE), and provenance (Rekor transparency
log, offline verification, independently-checkable `search.sigstore.dev`
links), with the trust ladder (Development -> Verified issuer -> Publicly
anchored) now documented in-repo, not just on the marketing site. New
[docs/CRYPTO-FOUNDATION.md](./docs/CRYPTO-FOUNDATION.md) also describes,
with an explicit non-overclaim disclaimer, how these same primitives are a
foundation a future optional ownership layer could build on: no shipped
blockchain/token/NFT feature, always optional, never required, not investment
advice.

**Publish workflow now also triggers on every push to `main`**, not just tag
pushes, so a merged lockstep version bump ships to npm without a separate
manual tag-push step. Safe on every merge: publishing skips any package
whose exact version is already on the registry.

## 1.1.0 (2026-07-15)

**Subject-bearing transparency anchors (RFC 0007).** `skill mint --transparency`/`--keyless`
now sign a minimal in-toto `Statement` naming the skill (`skill_id` and
`package_digest`), instead of a bare digest. The resulting public Rekor
entry is self-describing and cross-linkable: a stranger can see which
skill an entry belongs to without already holding the package, while the
predicate still carries only stable, opaque identifiers, never title,
intent, contract, journey, or any other free text.

- New `PermanenceAnchor.statement_version`/`.predicate_type` fields
  (both optional, additive).
- `skill verify-trust` re-derives `skill_id`/`package_digest` from the
  package being checked and compares them against the anchored subject.
  A mismatch refuses with the new `anchor_subject_mismatch` code, never a
  silent accept, the same way `--keyless` re-derives `owner_identity`
  from the certificate.
- `skill verify-trust --claims`/`skill inspect --trust --claims` surface a
  new `transparency_log.anchor_subject`/`keyless_identity.anchor_subject`
  verified claim once the subject checks out.
- New `skill-anchor-statement.schema.json`, checked before an anchor's
  payload is trusted.
- Fully backward compatible: anchors minted before this release have no
  `statement_version` and keep verifying exactly as they always have, via
  the same bare-digest comparison, forever. `checkAnchorPayload` in
  `@skillerr/core`'s `transparency.ts` decides the path solely on the
  absence or presence of `statement_version`.
- Verified against the real public Rekor log end to end (both mint and
  verify), not just unit tests: https://search.sigstore.dev/?logIndex=2173022811

See [RFC 0007](./docs/rfcs/0007-subject-bearing-transparency-anchor.md) for
the full design.

## 1.0.3 — 2026-07-15

Key Ceremony, Naming, Threat Model, and all six RFCs moved from `docs/` to
the [wiki](https://github.com/dot-skill/skillerr/wiki), so `docs/` stays
focused on task-oriented guides. This release updates the three shipped
`skill mint`/`skill keygen` `--help` strings that pointed at
`docs/KEY-CEREMONY.md`, a path that no longer exists as of this move, to
point at the wiki instead.

## 1.0.2 — 2026-07-15

Fixes leftover `"0.5"` strings that 1.0.1's protocol-version bump missed —
found by testing the published CLI end-to-end rather than only grepping docs:

- `skill agent-guide`'s printed onboarding steps (the guide agents actually
  read to learn the create/mint protocol) referenced "SkillContract 0.5"
  five times; now "SkillContract 1.0".
- `skill --help`'s `contract-template` line said "0.5 authoring contract
  scaffold"; now "1.0".
- The five protocol JSON Schema files (`skill-contract`, `knowledge-item`,
  `workflow`, `creation-attestation`, `skill-manifest`) still had `$id`s
  and `title`s under `/schema/0.5/`; now `/schema/1.0/`. These `$id`s are
  identifiers, not live-fetched URLs, so this is not a breaking change.
- `skill validate`'s `release_contract_missing` error message said "native
  0.5 authoring contract"; now "1.0".
- `skill keygen`'s printed trust-store setup snippet was missing the
  required `{"version": 1, "keys": [...]}` wrapper, so following it
  verbatim produced a trust store `skill verify-trust` rejects as invalid.
  Fixed to match the actual schema (`packages/core/src/trust-store.ts`).

Also adds automatic GitHub Release creation on tag push, so the repo's
Releases page reflects what's actually published to npm instead of staying
empty.

## 1.0.1 — 2026-07-15

**Protocol specification is now versioned 1.0.0 and marked Stable.**
Previously the spec was versioned separately from the reference
packages (Draft 0.5.0), with Stable status gated on independent
conforming runtimes existing beyond this reference implementation.
That gate is removed: a single, thoroughly-tested reference
implementation (165 tests, an adversarial security corpus, multi-OS/
Node CI) is considered sufficient evidence of stability. Community
implementations remain welcome and encouraged, but are ecosystem
growth, not a prerequisite for the spec's own stability claim.

**Breaking change:** `PROTOCOL_VERSION` (embedded in every sealed
package's `skill.json` as `protocol_version`, and checked by `skill
validate`/`skill inspect` with **exact** string equality, never a
semver range) changes from `"0.5.0"` to `"1.0.0"`. Packages minted
with any CLI version ≤ 0.9.x embed `protocol_version: "0.5.0"` and will
fail validation against this CLI version or later — re-mint with the
current CLI for compatibility. This is intentional, not an oversight:
the whole point of exact-match `protocol_version` checking (see
`docs/PROTOCOL.md`'s compatibility table) is to make a real protocol
version bump an explicit, loud, unmissable event instead of a package
silently being read leniently against a spec version the CLI wasn't
built for.

Also bumped `contract_version` (the `SkillContract` type's own
schema-dialect marker, JSON-schema-enforced via `const`) from `"0.5"`
to `"1.0"` for consistency — a separate constant from
`protocol_version`, also checked exactly, also embedded in every
authored contract and local workspace `.skill/contract.json` file.

v1.0.0 (published minutes before this release, in the same session)
does not include this change — its `PROTOCOL_VERSION`/`contract_version`
remained at the pre-1.0 values despite the package version already
reading 1.0.0. Upgrade to 1.0.1 or later.

## 1.0.0 — 2026-07-15

First stable release of the reference implementation. The public API
across all seven `@skillerr/*` packages (and the `skillerr` CLI) is now
considered stable: breaking changes to exported functions, types, CLI
flags, or the `.skill` container format will land as a new major
version, not silently inside a minor/patch release.

This covers the **reference implementation's API**, not the protocol
specification itself — the spec stays versioned separately (Draft
0.5.0, evolving in the open via RFCs) and reaches Candidate/Stable
only once independent conforming runtimes exist and pass the same
adversarial/conformance corpus this repo already runs on every push.
See `docs/ROADMAP.md`.

What's shipped as of this release: the sealed `.skill` container with
content-addressed digests; mint + creation attestation with both
development (HMAC) and production (Ed25519 + trust store) signing
paths; a deny-by-default runtime capability gate covering network,
filesystem, destructive, and exec side effects; structured permission
grammar; JSON Schema validation for every container file; an
adversarial security corpus (zip bombs, path traversal, hash tampering,
and more) running in CI on every push across mac/Linux/Windows × Node
22/24; optional public transparency-log anchoring via Rekor
(`--transparency`) and Fulcio keyless identity (`--keyless`), both with
independently-checkable verification links back to sigstore's own
infrastructure; a per-claim assurance model (`--claims`) that
structurally separates cryptographically verified claims from
self-reported ones; an eval/benchmark loop and quality-score
integration; and a license/terms manifest field. 165 tests passing.

## 0.9.10 — 2026-07-15

Found while doing end-to-end verification of 0.9.9's license field
against a fresh npm install: `license`/`license_url` reached
`manifest`/`skill inspect`'s plain summary correctly, but never made
it into `TrustView` — meaning `skill inspect --trust`, `skill
verify-trust`, `assessClaims`'s self-reported list, and by extension
`www.skillerr.com`'s verify page never showed it at all. Added
`license`/`license_url` to `TrustView`, populated in
`inspectTrustView`, and added both to `assessClaims`'s self-reported
list (never verified — same reasoning as every other self-reported
field: nothing in this protocol checks a declared license matches
reality).

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
