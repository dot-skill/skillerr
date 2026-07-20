# Scrubbing (deterministic secret detection)

Status: implemented in `@skillerr/core` (`scrub.ts`), wired into `compile`/`checkpoint`/`pack` automatically, additive only. This doc explains what the scrubber catches, how to check its work is reproducible, and — just as important — what it deliberately does not claim to catch.

**Before anything else: the boundary.** The scrubber's job is secrets, full stop: API keys, tokens, private keys, credentialed URIs, high-entropy strings that look like a secret. It never claims to catch proprietary information, PII, or anything else that's merely *sensitive* rather than *secret-shaped* — that's a human judgment call, not a pattern match, and belongs to the review step described in [ROADMAP.md](./ROADMAP.md), not to this deterministic layer. Don't rely on `skill scrub` (or the automatic pass inside `compile`) as your only check before sharing a package widely; it's a floor, not a substitute for reading what you're about to hand off.

## Why deterministic, not a model call

An LLM asked "does this contain a secret?" is a plausible-sounding classifier with no reproducibility guarantee: the same input can get a different answer on a different day, a different model version, or a different temperature, and there's no way to audit *why* it made a call after the fact. Secrets detection needs the opposite property — the same bytes must always produce the same verdict, checkable by anyone re-running the same rule table, with zero network calls and zero risk of a prompt-injected document talking its way past the classifier. So `scrub()` is a pure function: regex rules plus Shannon entropy plus exact-value comparison, nothing else, nowhere in the call path. There is no LLM anywhere in this module, deliberately.

## The four layers, in confidence order

`scrub()` runs (up to) four detection layers per unit of text, in this priority order — a layer earlier in the list claims its matched span first, so a later layer can't re-flag text a higher-confidence layer already redacted:

1. **Env-value exact match** (`source: "env-match"`, opt-in via `secretsFrom`). Loads real secret *values* from files you point it at (`.env`, `~/.aws/credentials`, `~/.ssh/id_*`, etc.) plus matching `process.env` entries, purely to compare against the text — exact and trimmed matches are redacted. This is the highest-confidence layer because it's comparing against a value you've told the tool is actually secret, not guessing from shape. **The matched VALUE is never stored or reported anywhere** — only the environment variable / file key NAME that matched (`matched_key` on the finding). This layer never runs unless you explicitly opt in with `--secrets-from`; nothing is loaded from your environment by default.
2. **Known-format pattern rules** (`source: "pattern"`, `confidence: "high"`, always on). A versioned table in `scrub-rules.json` — OpenAI/Anthropic keys, GitHub tokens, AWS access key IDs, GCP/Slack/Stripe keys, PEM private-key blocks, JWTs, bearer tokens, credentialed DB/service URIs, and `.env`-style `KEY=VALUE` lines where the key name looks secret-shaped. Every rule in the table is precise to that vendor's real format (e.g. `sk-ant-` vs. bare `sk-`), not a generic 6-character catch-all, so it doesn't fire on ordinary-looking identifiers that merely start with a common prefix.
3. **Custom rules** (`source: "custom"`, `confidence: "high"`). Project-supplied literal strings or regexes via `--custom rules.json`, for anything specific to your own org (an internal codename, a known-format internal token) that the built-in table can't anticipate. Same confidence and same auto-redaction behavior as the built-in rules.
4. **High-entropy detection** (`source: "entropy"`, `confidence: "needs_review"`, always on, runs last). Scans for long base64/hex-shaped tokens with Shannon entropy above a threshold (default 3.5 bits/char). This layer **never redacts anything** — it only flags a span for a human to look at. It deliberately skips spans already claimed by layers 1–3 (so it can't double-report a key layer 2 already caught) and skips tokens that are recognizably *not* secrets even though they're high-entropy: pure hex digest strings, UUIDs, `skl_`-prefixed skill ids, and anything immediately preceded by a `sha256:`/`sha1:`/`sha512:` label. Without that skip-list, every content digest and skill id in a `.skill` package would falsely trip this layer — a `.skill` file is *full* of legitimately high-entropy, non-secret strings.

## Reproducibility: `rules_version` + `rules_digest`

Every `RedactionReport` carries `rules_version` (the rule table's own version string) and `rules_digest` (a SHA-256 over the RFC 8785-canonicalized rule table, the same canonicalization used everywhere else in this repo — see [CANONICALIZATION.md](./CANONICALIZATION.md)). The contract: **identical (content, `rules_digest`, `secretsFrom` values) always produces an identical report** — same findings, same placeholders, same summary, byte for byte. No timestamps live inside the hashed/reported body. This is what makes a `RedactionReport` independently checkable rather than "trust me, I redacted it": anyone can re-run `skill scrub` against the same content and the same rule table and confirm they get the exact same output. `fixtures/scrub/vectors.json` pins a set of these input → output pairs as a regression test; any change to `scrub-rules.json` that isn't purely cosmetic changes `rules_digest`, and the vectors test catches that on purpose — it means the fixture needs a deliberate update, not that something silently drifted.

## Redaction placeholders

A redacted span becomes `{{redacted:<rule_id>#<n>}}` — e.g. `{{redacted:openai_key#1}}`. The same matched value always gets the same placeholder within one `scrub()` call (numbered by first-occurrence order), so if a secret appears three times in one document, all three occurrences collapse to the same token instead of three different-looking placeholders that might read as three different secrets. This guarantee holds *within* a single `scrub()` call; `compile`'s per-field calls are merged afterward by `mergeRedactionReports()`, and that merge does not re-unify placeholder numbering across fields — see the code comment on `mergeRedactionReports` if you're relying on cross-field placeholder identity, which Phase 1 does not provide.

## `skill scrub` CLI reference

```
skill scrub <path|-> [--secrets-from <file...>] [--custom <rules.json>]
            [--mode auto|report-only] [--report <out.json>]
            [--entropy <n>] [--strict]
```

- `<path|->` — a file to scrub, `-` for stdin, or a workspace directory (scrubs every staged section plus the journey summary as one document and always runs in `report-only` mode — it never rewrites your working tree; staged content only changes through the normal `compile`/`checkpoint` path, which seals its own `provenance/redaction.json`).
- `--secrets-from <file>` (repeatable) — opt into layer 1 (env-value exact match) against real secret values loaded from these files.
- `--custom <rules.json>` — a JSON array (or `{"rules": [...]}`) of `{id, label, pattern|literal, flags?}` objects, layer 3.
- `--mode report-only` — find without rewriting; the printed result omits `scrubbed` entirely.
- `--report <out.json>` — additionally write the `RedactionReport` to a file.
- `--entropy <n>` — override the default 3.5 bits/char threshold for layer 4.
- `--strict` — exit code 2 if `summary.needs_review > 0` (useful in CI to force a human look before proceeding, without the tool ever pretending it can make that call itself).

Prints `{ ok: true, report, scrubbed }` as JSON on success (`scrubbed` omitted in `report-only` mode); exit 0 normally, exit 2 on `--strict` with unresolved `needs_review` findings or on a malformed `--custom` file.

## Automatic scrubbing in `compile` / `checkpoint` / `pack`

`compile` already ran a cruder secret redaction pass before Phase 1; that logic now delegates entirely to `scrub()` (the old `redactSecrets(text, onRedact?)` signature still works, unchanged, for any existing caller). Every text field compile touches — knowledge section bodies, the journey summary, open questions, decisions, the agent endpoint — is scrubbed in `auto` mode, and each field's individual `RedactionReport` is merged into one document-level report via `mergeRedactionReports()`. That merged report is sealed into the package as `provenance/redaction.json`, covered by `package_digest` exactly like any other container file (`compilation_report`, `benchmark`, `score`) — tampering with it after the fact breaks the package's integrity hash the same way tampering with any other provenance file would.

This is purely additive: existing `.skill` packages, existing fixtures, and existing `redactSecrets()` call sites are unaffected. `needs_review` findings are recorded in the sealed report but are **not** auto-removed from the content — Phase 1 only ever removes what it's highly confident is a secret; it surfaces everything else for a human to decide, rather than silently deleting content that might not actually be a secret.

## What this does and doesn't prove

- **Proves**: the exact rule table (`rules_digest`) that ran, and that re-running it against the same content yields the same verdict. A sealed `provenance/redaction.json` is auditable evidence of *what a deterministic scrubber found*, independently reproducible by anyone with the package and the same rule table.
- **Does not prove**: that the content is free of secrets (a novel key format, or a secret with unremarkable entropy, can still slip through — this is detection, not a guarantee), and does not attempt to judge whether content is proprietary, personally identifying, or otherwise sensitive but not secret-shaped. `needs_review` findings are exactly that: flagged, not resolved. Closing that gap with an accountable human sign-off (binding a specific reviewer's attestation to the exact reviewed bytes) is tracked as follow-on work, not part of Phase 1 — see [ROADMAP.md](./ROADMAP.md).

See also: [PRIVACY.md](./PRIVACY.md) for the broader "never in the package" rules this scrubber enforces one layer of, and [CANONICALIZATION.md](./CANONICALIZATION.md) for how `rules_digest` is computed.
