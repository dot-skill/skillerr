# RFC 0005 — Media type + magic identification (PROTO-8)

Status: **Draft — spec only, not implemented**

## Motivation

A `.skill` file is a zip. Today nothing inside it identifies it as a
`.skill` specifically until a tool reads `skill.json` and checks
`kind === "dot-skill"` (`validate.ts`) — which requires unzipping the whole
archive first. Two concrete problems follow from that:

1. **No cheap identification.** A registry, file-type sniffer, OS "open
   with" handler, or antivirus/DLP scanner that wants to say "this is a
   `.skill` package" has no way to do it without a full unzip + JSON parse.
   Every other zip-based container format that expects this kind of tooling
   support — EPUB, ODF (OpenDocument), JAR's `META-INF/MANIFEST.MF` in
   spirit — solves this the same way: a fixed, uncompressed, first-entry
   file whose bytes *are* the media type string, readable from the first
   local file header alone.
2. **Content-type confusion.** A `.skill` is, structurally, just a zip.
   Rename it to `.zip` and any archive tool extracts it happily; serve it
   over HTTP with the wrong `Content-Type`, or let a naive "is this a
   zip?" check (magic bytes `PK\x03\x04`) stand in for "is this a
   `.skill`?", and nothing today distinguishes a `.skill` from an
   arbitrary zip, or from a zip that merely *contains* a `skill.json`-
   shaped file placed there to look like one. `MEDIA_TYPE =
   "application/vnd.dot-skill+zip"` already exists as a TypeScript
   constant (`packages/protocol/src/types.ts:20`) but is not asserted
   anywhere at the container level — it's not currently a spec-level
   commitment, just an unused string.

Declaring the media type formally and requiring a magic-identification
entry is cheap (a few bytes, one more zip entry) and closes both gaps at
once: an EPUB-reader-style "peek at the first entry" check identifies a
`.skill` without parsing JSON, and it hardens the format against a
"rename and re-serve" or "naive zip sniff" confusion attack.

## Proposal

### (a) Formalize `application/vnd.dot-skill+zip` as a spec-level media type

`MEDIA_TYPE = "application/vnd.dot-skill+zip"` already exists
(`packages/protocol/src/types.ts:20`) and is already referenced in
`docs/PROTOCOL.md`'s header (`**Media type:**
application/vnd.dot-skill+zip`, line 5). This RFC's job is not to invent
a new value — it's to promote that string from "a constant the reference
implementation happens to export" to a documented, stable, spec-level
commitment: any implementation of this protocol MUST use this exact media
type string, and it does not change across protocol minor versions
without an explicit RFC. IANA registration of a `vnd.dot-skill+zip` media
type (per RFC 6838's vendor tree) is a reasonable stretch goal once the
protocol is Candidate/Stable (see `docs/ROADMAP.md`), but it is not a
blocker for this RFC — self-declaration inside the container and in
`docs/PROTOCOL.md` is sufficient for tooling to depend on today, the same
way EPUB shipped its `mimetype` convention well before wide MIME-registry
recognition mattered in practice.

### (b) A `mimetype` entry at the archive root

Add a top-level `mimetype` file to every packed `.skill`, matching the
EPUB/ODF convention exactly:

- **Contents**: the raw ASCII bytes of `application/vnd.dot-skill+zip`
  only — no trailing newline, no BOM, no JSON wrapping.
- **Compression**: stored, not deflated (zip "store" method, i.e.
  `level: 0`) — a reader doesn't need to run an inflate step to check it.
- **Position**: the *first* entry in the zip's central directory / local
  file headers.

With those three properties, a tool identifies a `.skill` by reading only
the first local file header (fixed 30-byte structure + filename) and the
handful of bytes that follow — no central directory walk, no inflate, no
JSON parse. This is strictly cheaper than today's "unpack and check
`skill.json`'s `kind` field" approach and works even on a truncated or
partially-transferred file.

### (c) Reconciling `mimetype`-first with SEC-J's alphabetical sort

`packSkill()` (`packages/core/src/pack.ts:238`) builds the deterministic
archive by sorting every entry path alphabetically before calling
`zipSync` (SEC-J, `pack.ts:251-259`: *"deterministic zip. Sorted entry
order (buildFileMap's own insertion order isn't a promised contract) and
a fixed per-entry mtime"*, using the `EPOCH` constant
`new Date("1980-01-01T00:00:00Z")` at `pack.ts:25` because zip's DOS-date
format can't represent the Unix epoch). A literal file named `mimetype`
sorts *after* `artifacts/`, `knowledge/`, and everything else starting
with a lowercase letter earlier in the alphabet than `m` — pure
alphabetical order does not put it first.

This RFC resolves the tension by treating "the `mimetype` entry is
always the first zip entry" as an **explicit, named exception** to the
general sort rule, not a naming trick:

- `buildFileMap` (`pack.ts:151`) gains a `files["mimetype"] = mimetypeBytes`
  entry alongside `workflow.json` and the rest.
- The determinism loop in `packSkill` (`pack.ts:257-259`, currently
  `for (const path of Object.keys(files).sort())`) changes to sort all
  *other* entries alphabetically as today, then prepend `mimetype`
  unconditionally, with a comment documenting why: `mimetype` is excluded
  from the general SEC-J sort and forced first, matching the EPUB/ODF
  convention, and stored (`level: 0`) rather than the uniform `level: 6`
  every other entry uses.
- This keeps determinism (the entry order is still 100% a pure function
  of the file set — "mimetype first, then everything else sorted" is
  just as reproducible as "everything sorted") while satisfying the
  actual requirement, which is about **byte position in the archive**,
  not about naming `mimetype` something like `0-mimetype` that would sort
  correctly but pollute the container's file list with a synthetic name
  no other zip-based format uses. A renamed-to-sort-first file would also
  break the EPUB/ODF-derived reader convention, which looks for the
  literal name `mimetype`, not a numerically-prefixed variant.
- Rejected alternative: relying on "a reader always checks a well-known
  entry name directly rather than whatever's first." That's true and is
  in fact the *fallback* every reader should use anyway (see Fixtures,
  below, on absent-vs-present handling) — but it forfeits the entire
  point of (b), which is identifying the package from the first local
  file header alone, before any directory walk. First-entry position is
  what makes the check O(1) instead of O(entries); if a reader has to
  scan for the name anyway, `mimetype` provides no advantage over just
  reading `skill.json`'s `kind` field, and this RFC would have nothing
  to propose.

### (d) `MANIFEST_MEDIA_TYPE` is out of scope here

`MANIFEST_MEDIA_TYPE = "application/vnd.dot-skill-manifest+json"`
(`packages/protocol/src/types.ts:22`) identifies the *JSON media type* of
`skill.json`'s content when referenced standalone (e.g. in an
`Accept`/`Content-Type` header serving `skill.json` alone from a
registry API, or in a DSSE `payloadType` field) — it has nothing to do
with zip-container magic identification. This RFC does not change its
meaning or add it to the container. The two constants stay conceptually
separate: `MEDIA_TYPE` identifies "this byte stream is a `.skill` zip
container" (what `mimetype` asserts), `MANIFEST_MEDIA_TYPE` identifies
"this byte stream is `.skill`'s manifest JSON" (unrelated to archive
framing, used only where `skill.json`'s bytes are handled outside the
zip, e.g. attestation payloads).

## Schema diff

- `buildFileMap` (`packages/core/src/pack.ts:151`): add a `mimetype`
  entry containing `strToU8(MEDIA_TYPE)` (no trailing newline — deviates
  from the existing `textEncode()` helper at `pack.ts:143-145`, which
  appends `"\n"` after `JSON.stringify`; `mimetype` is not JSON and must
  not go through `textEncode`).
- `packSkill` (`pack.ts:238-261`): the SEC-J sort loop gains the
  mimetype-first exception described in (c); the per-entry options map
  (currently uniform `{ level: 6; mtime: Date }` for every path) needs a
  per-path compression level so `mimetype` can be stored (`level: 0`)
  while everything else stays `level: 6`.
- `finalizeManifest` (`pack.ts:213-236`): `mimetype` is excluded from
  `manifest.content` the same way `skill.json` and `signatures/**`
  already are (`pack.ts:219`, `.filter((p) => p !== "skill.json" &&
  !p.startsWith("signatures/"))` gains `&& p !== "mimetype"`) — its bytes
  are fixed and self-describing, so digesting it into the content index
  adds no integrity value and would force every package's
  `package_digest` to embed a redundant, protocol-version-derived
  constant.
- `validate.ts`: new checks, each a distinct issue code consistent with
  the existing style (`digest_mismatch`, `package_digest`,
  `missing_content_entry`, `missing_file` at `validate.ts:343-372`):
  - `mimetype_missing` — no `mimetype` entry present (severity depends on
    protocol version; see Migration).
  - `mimetype_mismatch` — `mimetype` entry present but its bytes don't
    exactly equal `MEDIA_TYPE` (catches both the content-type-confusion
    attack case and accidental corruption/trailing-newline bugs).
  - `mimetype_not_first` — `mimetype` present with correct content but
    not the first entry in the zip's physical layout (a package that
    passes both content checks but was assembled by a tool that didn't
    respect entry ordering — still parseable, but breaks the "peek at
    the first header" fast path this RFC exists to enable). This is a
    structural/layout check, not something `unpackSkill`'s streaming
    reader currently has a hook for — likely needs the raw entry order
    captured during unzip rather than derived after the fact from the
    (order-losing) `Record<string, Uint8Array>` files map.

## Migration

This is a **breaking container-format change** for any check that starts
*requiring* `mimetype`: every `.skill` packed before this RFC ships has
no such entry, so a hard `mimetype_missing` refusal on day one would
invalidate the entire existing corpus, including fixtures under
`fixtures/` and any already-distributed packages.

Proposed rollout, matching this repo's existing additive-then-required
pattern (e.g. how `manifest_digest` was added as a check that runs "on
*every* package, minted or not" per `docs/PROTOCOL.md`'s Integrity &
trust section, and how PROTO-7's schema checks were introduced package-
by-package rather than as one atomic hard cutover):

1. **Phase 1 (this protocol version, additive)**: `packSkill` always
   writes `mimetype` for every newly packed archive. `skill validate`
   checks it when present (`mimetype_mismatch` is always an error — an
   incorrect value is never acceptable once the entry exists) but treats
   *absence* as a `warning`-severity issue, not an error — old packages
   validate cleanly, just with a visible warning nudging toward
   repacking.
2. **Phase 2 (future protocol version bump)**: once `protocol_version`
   moves past whatever value ships Phase 1, `mimetype_missing` is
   promoted to `severity: "error"` for packages declaring the new
   version — consistent with the existing hard-refusal policy in
   `docs/PROTOCOL.md`'s "Protocol/CLI compatibility" section (*"A
   mismatch is a hard, explicit `protocol_version` validation error; a
   package is never read leniently against a protocol version the
   running CLI wasn't built for"*): a package that declares the new
   version but omits `mimetype` is asserting compliance with a container
   contract it doesn't meet, exactly the same failure shape
   `protocol_version` mismatches already refuse on. Packages that
   declare an *older* `protocol_version` keep validating under Phase 1's
   warning-only rule indefinitely — this RFC does not retroactively
   invalidate old packages, only gates what a *new*-version package is
   allowed to omit.

The tradeoff: Phase 1 alone gives real-world tooling (registries, file
sniffers, antivirus allowlisting) something to depend on immediately
without breaking anyone, at the cost of the guarantee being
best-effort/advisory until Phase 2 lands. Skipping straight to a hard
requirement would be simpler to specify but breaks every package packed
before the change goes in, with no transition window — inconsistent with
how every other breaking-adjacent change in this protocol (schema
checks, `manifest_digest`) shipped as "checked on everything, but only
new packages have to have it right."

## Fixtures

Once implemented, add to the adversarial corpus
(`packages/cli/src/adversarial.test.ts`, alongside the existing zip-bomb
/ path-trick / duplicate-entry cases) and to `fixtures/`:

- **Content-type confusion simulation**: a package with a `mimetype`
  entry present, first, and stored, but containing the wrong string
  (e.g. `application/epub+zip`, or `application/vnd.dot-skill+zip` with
  a trailing newline, or truncated) — must refuse with
  `mimetype_mismatch`.
- **Wrong position**: a package with byte-correct `mimetype` content but
  placed after other entries (e.g. appended last) — must refuse (or warn,
  depending on how strict `mimetype_not_first` ends up, see Open
  questions) distinctly from `mimetype_mismatch`.
- **Wrong compression**: a `mimetype` entry with correct content and
  position but deflated instead of stored — decide whether this is a
  distinct code (`mimetype_not_stored`) or folded into
  `mimetype_not_first`'s "layout is wrong" bucket; needs a decision
  before implementation (see Open questions).
- **Absent, old-version package**: no `mimetype` entry, `protocol_version`
  at or below the Phase-1 value — validates with a `mimetype_missing`
  warning, not an error.
- **Absent, new-version package**: no `mimetype` entry,
  `protocol_version` at the Phase-2 value — refuses with a
  `mimetype_missing` error.
- **Renamed-to-.zip round trip**: pack a skill, rename `.skill` to `.zip`,
  extract with a generic zip tool, re-zip without preserving entry
  order/compression method (simulating a careless "rename and
  re-archive" workflow) — demonstrates the resulting archive fails
  `mimetype_not_first` (or equivalent) even though its content is
  otherwise byte-identical, which is the intended hardening behavior:
  this class of mishandling becomes detectable, not silently accepted.
- **Determinism regression**: two packs of the same `SkillSource` still
  produce byte-identical output (extends the existing SEC-J determinism
  test) with `mimetype` included as the forced-first exception — verifies
  (c)'s resolution doesn't reintroduce non-determinism.

## Open questions

- Should `mimetype_not_first` (wrong position, right content) be an
  error or a warning? Argue for error: it defeats the entire "peek at
  first header" purpose of this RFC, so a package that gets the *string*
  right but the *layout* wrong is arguably worse than one that omits
  `mimetype` altogether, since it creates false confidence for a naive
  reader that only checks content, not position. Argue for warning: the
  package is still fully valid and readable by any tool that falls back
  to `skill.json`'s `kind` field, so treating it as a hard refusal
  punishes a cosmetic packaging defect as harshly as real content-type
  confusion. Leaning error, for symmetry with `mimetype_mismatch`, but
  not resolved here.
- Does `unpackSkill`'s streaming reader (`docs/PROTOCOL.md`'s "reads the
  archive through a streaming unzip so unsafe input is refused *during*
  decompression" behavior) need to special-case `mimetype` to short-
  circuit identification before the rest of the archive is even opened
  — i.e. does `skill inspect`/`skill validate` gain a fast-path "is this
  even a `.skill`" pre-check distinct from full unpacking, or does this
  RFC only specify the on-disk format and leave the fast-path reader
  optimization to a later, implementation-focused change?
