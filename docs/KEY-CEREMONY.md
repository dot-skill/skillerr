# Key ceremony (PROTO-2 / RFC 0001 — production signing)

How a real issuer generates, stores, rotates, and revokes an Ed25519
signing key, and how a verifier pins one. This document is about
**production** trust — every command here is optional; the zero-config
local default (public-dev HMAC, `issuer_class=public_dev_hmac`) needs none
of this and always stays `trust_state=development`, never production trust.
See [SECURITY.md](./SECURITY.md) and [THREAT-MODEL.md](https://github.com/dot-skill/skillerr/wiki/Threat-Model)
for why that distinction is load-bearing.

## The two roles

- **Issuer**: holds the Ed25519 **private** key. Mints packages with
  `skill mint --signer-key <path>`. The private key must never leave the
  issuer's control — not in the repo, not in CI logs, not in a `.skill`
  package.
- **Verifier** (any consumer): holds a **trust store** — a local file
  pinning the issuer's **public** key by `key_id`. Verifies with
  `skill verify-trust <file> --trust-store <path>` or
  `skill inspect --trust --trust-store <path>`.

These are asymmetric by design: an issuer key compromise lets an attacker
forge new seals, but a verifier's trust store leaking teaches an attacker
nothing usable (a public key is, definitionally, public).

## Two keygen modes: default per-user key vs named production key

`skill keygen` has two modes:

- **`skill keygen` (no `-o`)** provisions your **default per-user issuer key**
  at `~/.skillerr/issuer-key.pem` and pins its public half in your own trust
  store. This is the key `skill publish` / `skill mint --transparency`
  auto-use, so a public provenance URL works with zero setup (you don't even
  have to run this first: the publish path provisions it on demand). It's a
  real Ed25519 key and your own identity, but self-generated: others earn
  `verified_issuer` for your packages only once they pin its `key_id`.
- **`skill keygen -o <dir> --key-id <id>`** (below) writes a **named production
  keypair** you manage yourself: for an org identity, an offline/rotated key,
  or a key with a meaningful public `key_id` you publish for verifiers. It does
  not touch the default key or your trust store.

The rest of this page is the named production path.

## 1. Generate a key

```bash
skill keygen -o ./keys --key-id dot-skill-org-2026
```

This writes `./keys/dot-skill-org-2026.pem` (PKCS8 private key, mode
`0600`) and `./keys/dot-skill-org-2026.pub.pem` (SPKI public key), and
prints the trust-store JSON snippet to hand to verifiers.

Equivalent with `openssl` (useful if generating on an air-gapped machine or
integrating with existing key-management tooling that doesn't shell out to
this CLI):

```bash
openssl genpkey -algorithm ed25519 -out issuer.pem
openssl pkey -in issuer.pem -pubout -out issuer.pub.pem
```

Both produce standard PEM (PKCS8 private / SPKI public) — `@skillerr/core`'s
signer (`createEd25519Signer`, `packages/core/src/signer.ts`) uses Node's
built-in `node:crypto`, which accepts either source interchangeably. There
is nothing skillerr-specific about the key material itself; any Ed25519
keypair in standard PEM form works.

**Key ids are a naming convention, not a protocol mechanism.** Pick
something that encodes the issuer and rotation period (`dot-skill-org-2026`,
`ci-signer-2026-q3`) — the trust store keys off this string exactly, and it
becomes a permanent, visible field (`CreationAttestation.agent.key_id`) in
every package that key mints.

## 2. Store the private key

This document does not mandate a specific KMS/HSM — that choice depends on
the issuer's existing infrastructure. What's required, regardless of
mechanism:

- Never commit the private key file to any git repository (check `.gitignore`
  covers your key output directory before running `skill keygen` inside a repo).
- Never pass it as a CI environment variable that lands in build logs;
  inject it as a CI secret file mount instead.
- Rotate on a schedule (a `not_after` in the trust store, see §4, is the
  verifier-side half of this — the issuer-side half is "generate a new key
  before the old one's `not_after` and start minting with the new
  `key_id`").
- If a key is ever suspected compromised: stop minting with it immediately,
  and see §5 (there is currently no revocation channel — this is the
  sharpest edge of shipping RFC 0001 without RFC 0003 yet; read §5 before
  relying on this in a real adversarial setting).

## 3. Mint with the key

```bash
export SKILL_HOST=cursor
export SKILL_SESSION_ID=ses_...     # or SKILL_AGENT_INVOCATION=1 — see below
skill mint --host cursor --signer-key ./keys/dot-skill-org-2026.pem --key-id dot-skill-org-2026
```

`--signer-key` takes priority over the public-dev HMAC entirely — the
resulting attestation gets `issuer_class=configured_ed25519` and
`sig_alg=ed25519-v1`.

**`verified_issuer` additionally requires agent-runtime evidence.** A
configured signer alone is not enough to claim `host_claim_binding
=verified_issuer` — mint also needs evidence this wasn't invoked from a
bare human shell (`SKILL_SESSION_ID`, or an agent-runtime marker such as
`SKILL_AGENT_INVOCATION`). Without it, `skill mint --signer-key` fails
loudly with a clear error rather than silently minting as `self_reported`
— see `resolveHostClaimBinding` in `packages/core/src/mint.ts`. This is the
same anti-spoof rule the public-dev HMAC path has always had
([SECURITY.md](./SECURITY.md) "SKILL_HOST / anti-spoof"); a configured key
does not exempt you from it.

## 4. Pin the public key (verifier side)

Verifiers maintain `~/.skillerr/trust-store.json` (or any path passed via
`--trust-store`):

```json
{
  "version": 1,
  "keys": [
    {
      "key_id": "dot-skill-org-2026",
      "public_key_pem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
      "algorithm": "ed25519",
      "allowed_hosts": ["cursor", "claude-code"],
      "not_before": "2026-01-01T00:00:00Z",
      "not_after": "2027-01-01T00:00:00Z",
      "comment": "dot-skill org production signing key"
    }
  ]
}
```

This file is hand-edited — there is no `skill trust-store add-key` command
yet (RFC 0001's open question on this leans "hand-editing is fine for v1";
a command is a plausible follow-up contribution). A missing file is a valid
empty trust store, not an error (no keys pinned yet, so every
`configured_ed25519` attestation reports `trust_store_key_not_found` until
you add one).

**Every field matters and fails closed:**

- `key_id` must match `attestation.agent.key_id` exactly.
- `allowed_hosts`, if present and non-empty, restricts which `host` values
  this key is trusted to sign for — a key stolen and used to sign for a
  different `SKILL_HOST` than intended is caught here.
- `not_before`/`not_after` are checked against the attestation's
  `minted_at`, not "now" — a key used outside its intended validity window
  refuses even if verified long after the fact.
- No matching entry (wrong `key_id`, expired, or wrong host) is a hard
  refusal (`trust_store_key_not_found` / `trust_store_key_expired` /
  `trust_store_host_not_allowed`), never a silent downgrade to a
  lesser-but-still-passing trust level — see
  [THREAT-MODEL.md](https://github.com/dot-skill/skillerr/wiki/Threat-Model) T3 for why that matters.

## 5. Revocation (the current gap)

**There is no revocation channel yet.** If a key is compromised, every
package already minted with it stays verifiable against the trust store
until you physically remove that `key_id` from every verifier's trust
store — which, once packages are distributed, you cannot force. This is
tracked as [RFC 0003](./rfcs/0003-revocation-expiry.md) (revocation
records + `expires_at`), not yet implemented. Until it ships:

- Treat `not_after` as your only mitigation — keep rotation periods short
  enough that a compromise's blast radius is bounded by how soon the key
  would have expired anyway.
- If a key is compromised, remove it from your own trust store immediately
  and communicate the compromise out-of-band (there is no in-protocol
  broadcast mechanism); packages you already verified and trusted before
  the compromise was known are not retroactively invalidated by anything
  in this repo today.

## 6. The dev key stays what it always was

None of the above changes the zero-config default. `skill mint` with no
`--signer-key` still uses the public-dev HMAC
(`packages/core/src/hash.ts`'s `PUBLIC_DEV_MINT_KEY` — literally checked
into this repo, intentionally world-known) and always reports
`issuer_class=public_dev_hmac` → `trust_state=development`. `execute`
refuses development-trust packages without `--allow-untrusted`
([SECURITY.md](./SECURITY.md)). This document exists so a real deployment
*can* move past that default — not to make the default any less safe for
everyone who doesn't.
