# Canonical JSON (RFC 8785 / JCS)

Every digest in this protocol (`package_digest`, `manifest_digest`,
`sealed_manifest_digest`, `attestation` payload digests) is computed over
**canonical JSON**, produced by `canonicalize()` in
`packages/core/src/hash.ts`. Two semantically-identical objects with
different key order, spacing, or number formatting must serialize to the
exact same bytes, or digests couldn't be compared meaningfully.

`canonicalize()` implements [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785)
(JSON Canonicalization Scheme, JCS) for the value space this protocol
actually uses (I-JSON: no non-finite numbers, no raw `undefined` on the
wire). The exact rules, by JSON value type:

## Rules

- **Objects**: member names sorted by **UTF-16 code unit** order (not
  Unicode code point order — see the surrogate-pair gotcha below), each
  member serialized as `"key":value`, members joined by `,`, wrapped in `{}`.
  A member whose value is `undefined` is dropped entirely (a TypeScript/JS
  ergonomic addition for optional fields — valid I-JSON never contains
  `undefined`, so this only matters for how this codebase's objects, which
  may have optional properties, get passed into `canonicalize()`).
- **Arrays**: elements serialized in their original order (never sorted),
  joined by `,`, wrapped in `[]`.
- **Strings**: serialized via `JSON.stringify()`, which implements the same
  quoting/escaping ECMAScript defines for `JSON.stringify` — matching what
  RFC 8785 §3.2.2 requires.
- **Numbers**: must be finite (`canonicalize()` throws otherwise — JCS has
  no representation for `NaN`/`Infinity`). Serialized via `JSON.stringify()`,
  which uses the ECMAScript Number::toString algorithm — the exact
  algorithm RFC 8785 §3.2.2.3 mandates. This also means `-0` serializes as
  `0` (JS's `JSON.stringify(-0) === "0"`), matching the RFC.
- **`true` / `false` / `null`**: literal, unquoted.
- **No insignificant whitespace** anywhere, ever.

## The UTF-16 sort order gotcha

RFC 8785 requires member names to sort by UTF-16 **code unit**, not code
point. This matters for any key containing a character outside the Basic
Multilingual Plane (BMP) — those are encoded as a surrogate *pair* (two
16-bit code units), and a naive code-point-aware sort can order them
differently than a code-unit sort would.

Example: the key `"😀"` (U+1F600, encoded as the surrogate pair
`😀`) and the key `"דּ"` (a single BMP code unit, U+FB33).

- By **code point**: U+1F600 (128512) > U+FB33 (64307) → `דּ` sorts first.
- By **UTF-16 code unit** (RFC 8785, mandatory): the emoji's first code unit
  is `0xD83D` (55357); `דּ` is `0xFB33` (64307). `55357 < 64307` → the
  emoji key sorts **first** — the opposite order.

`canonicalize()` sorts with `a < b` on raw JS strings, which ECMA-262
defines as UTF-16 code unit comparison — so this is correct without any
special-casing. See the `utf16_surrogate_sort` vector below for a working
example.

## Cross-implementation test vectors

`fixtures/canonicalization/vectors.json` holds `{name, input, canonical,
sha256}` entries — canonicalize `input`, and the result must equal
`canonical` exactly; `sha256Digest(canonical)` must equal `sha256`. These
are checked by this repo's own test suite and are meant to be portable: any
independent implementation (see the community-runtime invite in
[ROADMAP.md](./ROADMAP.md)) claiming RFC 8785 conformance for this protocol
should reproduce every vector byte-for-byte.

Vectors cover: empty object/array, key sorting (flat and nested), number
edge cases (negative, float, `-0`, a large safe integer), string escaping,
non-ASCII BMP text, the UTF-16 surrogate-pair sort order, mixed-type
arrays, and a realistic nested claims-shaped object.
