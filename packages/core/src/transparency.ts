/**
 * Phase E: optional public transparency-log anchoring (Rekor), built on the
 * official sigstore-js client libraries — not a hand-rolled Merkle-proof
 * implementation. See docs/TRANSPARENCY.md for what this does and does not
 * prove.
 *
 * Anchoring witnesses an *already-signed* claim (the same
 * `sealed_manifest_digest` mintSkillPackage always signs) into a public log;
 * it never replaces or weakens the existing signing path. A mint with no
 * network access succeeds exactly as before, just without an anchor.
 */
import { createPublicKey } from "node:crypto";
import type { ValidateFunction } from "ajv";
// The base "ajv" export only understands draft-07; our schema declares
// $schema: draft/2020-12, which needs the dedicated 2020-12 build, same
// reason validate.ts uses it, see the comment there.
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  DSSEBundleBuilder,
  RekorWitness,
  DEFAULT_REKOR_URL,
  DEFAULT_FULCIO_URL,
  FulcioSigner,
  CIContextProvider,
  type Signer as SigstoreSigner,
  type Signature as SigstoreSignature,
  type Witness,
  type IdentityProvider,
} from "@sigstore/sign";
import { bundleToJSON, bundleFromJSON, type Bundle } from "@sigstore/bundle";
import { toSignedEntity, Verifier, toTrustMaterial, type TrustMaterial } from "@sigstore/verify";
import { getTrustedRoot } from "@sigstore/tuf";
import { X509Certificate } from "@sigstore/core";
import { PublicKeyDetails, type PublicKey as ProtoPublicKey } from "@sigstore/protobuf-specs";
import { loadSchema, type PermanenceAnchor } from "@skillerr/protocol";
import type { IssuerSigner } from "./signer.js";
import { canonicalize } from "./hash.js";

export interface TransparencyOptions {
  rekorUrl?: string;
  /** Injectable for tests — bypasses the real network call. */
  witness?: Witness;
}

export interface TransparencyAnchorResult {
  anchor: Omit<PermanenceAnchor, "package_digest">;
  /** Rekor's log index for the entry just created — callers use this with `rekorSearchUrl` to hand back an independently-checkable link. */
  log_index: string;
}

/** Adapts our existing `IssuerSigner` (signs a digest *string*) to sigstore-js's `Signer` (signs artifact *bytes*). */
function toSigstoreSigner(issuerSigner: IssuerSigner, publicKeyPem: string): SigstoreSigner {
  return {
    async sign(data: Buffer): Promise<SigstoreSignature> {
      const sigBase64 = issuerSigner.sign(data.toString("utf8"));
      return {
        signature: Buffer.from(sigBase64, "base64"),
        key: { $case: "publicKey", publicKey: publicKeyPem, hint: issuerSigner.key_id },
      };
    },
  };
}

const DIGEST_PAYLOAD_TYPE = "application/vnd.skillerr.sealed-manifest-digest+text";

/**
 * Subject-bearing anchor statement (RFC 0007): instead of anchoring a bare
 * `sealed_manifest_digest` string, mint signs a minimal in-toto Statement
 * whose subject names the skill, so a public Rekor entry is self-describing
 * and cross-linkable without already having the package. See
 * docs/TRANSPARENCY.md "What gets logged".
 */
export const ANCHOR_STATEMENT_TYPE = "https://in-toto.io/Statement/v1";
export const ANCHOR_PREDICATE_TYPE = "https://skillerr.com/attestations/skill/v1";
export const ANCHOR_STATEMENT_VERSION = "1";
const ANCHOR_PAYLOAD_TYPE = "application/vnd.in-toto+json";

/**
 * Every field a caller must supply to identify the skill being anchored.
 * Deliberately narrow: this is exactly the set of fields that may end up
 * in the public statement (see `ANCHOR_PREDICATE_ALLOWED_KEYS`), so adding
 * a field here is a privacy decision, not just a type change.
 */
export interface AnchorSubject {
  skill_id: string;
  skill_version: string;
  /** `sha256:...` form, matching `SkillManifest.package_digest`. */
  package_digest: string;
  issuer_class: string;
}

export interface SkillAnchorStatement {
  _type: string;
  subject: Array<{ name: string; digest: { sha256: string } }>;
  predicateType: string;
  predicate: {
    skill_id: string;
    skill_version: string;
    sealed_manifest_digest: string;
    package_digest: string;
    issuer_class: string;
  };
}

/**
 * Hard privacy boundary: the public Rekor log is permanent and
 * world-readable (see docs/TRANSPARENCY.md), so the predicate may only ever
 * carry stable, opaque identifiers, never title, intent, contract,
 * journey, section bodies, endpoints, or any other free text. Enforced
 * twice, deliberately redundantly: here at construction time (so a future
 * accidental field addition fails loudly, immediately, in every caller,
 * mint or verify), and again at the JSON Schema level
 * (`skill-anchor-statement.schema.json`'s `additionalProperties: false` on
 * `predicate`), so a bug in one guard doesn't silently rely on the other.
 */
const ANCHOR_PREDICATE_ALLOWED_KEYS = [
  "skill_id",
  "skill_version",
  "sealed_manifest_digest",
  "package_digest",
  "issuer_class",
] as const;

export function assertAnchorStatementPrivacy(statement: SkillAnchorStatement): void {
  const disallowed = Object.keys(statement.predicate).filter(
    (key) => !(ANCHOR_PREDICATE_ALLOWED_KEYS as readonly string[]).includes(key),
  );
  if (disallowed.length > 0) {
    throw new Error(
      `Anchor statement predicate contains disallowed key(s): ${disallowed.join(", ")}, ` +
        `only ${ANCHOR_PREDICATE_ALLOWED_KEYS.join(", ")} may ever appear in a publicly anchored statement`,
    );
  }
}

/** Strips a leading "sha256:" prefix, if present, for the bare-hex form in.toto's subject.digest expects. */
function bareHex(digest: string): string {
  return digest.startsWith("sha256:") ? digest.slice("sha256:".length) : digest;
}

/**
 * Builds the exact statement `anchorToRekor`/`mintKeylessAnchor` sign,
 * exported so tests (and a future second runtime, per docs/ROADMAP.md) can
 * construct and canonicalize it independently of the network-calling mint
 * path.
 */
export function buildAnchorStatement(
  sealedManifestDigest: string,
  subject: AnchorSubject,
): SkillAnchorStatement {
  const statement: SkillAnchorStatement = {
    _type: ANCHOR_STATEMENT_TYPE,
    subject: [{ name: subject.skill_id, digest: { sha256: bareHex(subject.package_digest) } }],
    predicateType: ANCHOR_PREDICATE_TYPE,
    predicate: {
      skill_id: subject.skill_id,
      skill_version: subject.skill_version,
      sealed_manifest_digest: sealedManifestDigest,
      package_digest: subject.package_digest,
      issuer_class: subject.issuer_class,
    },
  };
  assertAnchorStatementPrivacy(statement);
  return statement;
}

let anchorStatementValidator: ValidateFunction | undefined;
function getAnchorStatementValidator(): ValidateFunction {
  if (!anchorStatementValidator) {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    anchorStatementValidator = ajv.compile(loadSchema("anchor-statement"));
  }
  return anchorStatementValidator;
}

/**
 * Submits `sealedManifestDigest` (the exact string mintSkillPackage already
 * signs) to a Rekor transparency log using the issuer's own key — no Fulcio,
 * no new identity claim, just a public, timestamped, tamper-evident record
 * that this signature over this digest was logged at this time.
 *
 * Uses a DSSE-envelope bundle, not a bare message-signature bundle:
 * @sigstore/sign's message-signature path hardcodes the hashedrekord
 * entry's declared hash algorithm to SHA-256, but Rekor's hashedrekord
 * verifier requires Ed25519 signatures to be Ed25519ph (SHA-512 prehash)
 * specifically — a mismatch confirmed against the real public instance.
 * DSSE-kind entries carry no such hardcoded hash-algorithm field; Rekor
 * verifies the embedded signature directly, which works with our existing
 * pure-Ed25519 signer unchanged. See docs/TRANSPARENCY.md.
 *
 * Never throws on network failure without the caller opting in to that
 * behavior being fatal — mint's caller decides whether an anchor failure
 * blocks the mint or is merely reported (see mint.ts wiring). This function
 * itself always throws on failure; the caller chooses how to handle it.
 *
 * The signed DSSE payload is a subject-bearing in-toto Statement naming
 * `subject`, not the bare digest (see `buildAnchorStatement`); the
 * resulting Rekor entry is self-describing, not just a naked hash.
 */
export async function anchorToRekor(
  sealedManifestDigest: string,
  issuerSigner: IssuerSigner,
  publicKeyPem: string,
  subject: AnchorSubject,
  opts: TransparencyOptions = {},
): Promise<TransparencyAnchorResult> {
  const rekorUrl = opts.rekorUrl ?? DEFAULT_REKOR_URL;
  const witness = opts.witness ?? new RekorWitness({ rekorBaseURL: rekorUrl });
  const builder = new DSSEBundleBuilder({
    signer: toSigstoreSigner(issuerSigner, publicKeyPem),
    witnesses: [witness],
  });
  const statement = buildAnchorStatement(sealedManifestDigest, subject);
  const bundle = await builder.create({
    data: Buffer.from(canonicalize(statement), "utf8"),
    type: ANCHOR_PAYLOAD_TYPE,
  });
  const tlogEntry = bundle.verificationMaterial.tlogEntries[0];
  if (!tlogEntry) {
    throw new Error("Rekor witness returned no transparency log entry — anchoring failed silently, refusing to report success");
  }
  return {
    anchor: {
      kind: "transparency_log",
      located_at: rekorUrl,
      anchored_at: new Date(Number(tlogEntry.integratedTime) * 1000).toISOString(),
      issuer: issuerSigner.key_id,
      receipt: bundleToJSON(bundle),
      statement_version: ANCHOR_STATEMENT_VERSION,
      predicate_type: ANCHOR_PREDICATE_TYPE,
    },
    log_index: String(tlogEntry.logIndex),
  };
}

export interface KeylessIdentityOptions {
  fulcioUrl?: string;
  rekorUrl?: string;
  /**
   * Defaults to `CIContextProvider`, which only finds an ambient OIDC token
   * in a CI environment that provides one (e.g. GitHub Actions' built-in
   * `id-token: write` — the same mechanism npm's trusted publishing uses;
   * no interactive setup needed there). Run outside such an environment, it
   * fails closed with a clear error rather than silently doing nothing.
   * There is no interactive/browser-login provider yet — see
   * docs/TRANSPARENCY.md.
   */
  identityProvider?: IdentityProvider;
  /** OIDC audience to request the token for — see `CIContextProvider`'s default. */
  audience?: string;
  /** Injectable for tests — bypasses the real Fulcio network call (and the identity provider entirely). */
  signer?: SigstoreSigner;
  /** Injectable for tests — bypasses the real Rekor network call. */
  witness?: Witness;
}

export interface KeylessAnchorResult {
  anchor: Omit<PermanenceAnchor, "package_digest">;
  log_index: string;
  /**
   * Read directly off the Fulcio-issued certificate at mint time, for
   * immediate feedback — not independently re-verified yet (that only
   * happens once, cryptographically, in `verifyKeylessAnchor`). Treat this
   * as "here's who Fulcio says you are," not as a trust claim in itself.
   */
  owner_identity?: string;
}

/**
 * Fulcio counterpart to `anchorToRekor`: instead of signing with our own
 * long-lived configured key, generates a fresh, single-use keypair and asks
 * Fulcio to bind it to the caller's OIDC identity with a short-lived
 * certificate, then anchors the same `sealedManifestDigest` to Rekor using
 * that certificate. Additive, exactly like `anchorToRekor` — this never
 * replaces the container's own seal (public-dev HMAC or `configured_ed25519`
 * — see mint.ts); it's an independent, orthogonal claim: "a human/CI job
 * with this OIDC identity attested to this digest at this time," verifiable
 * against Fulcio's and Rekor's public infrastructure, not against anything
 * this project controls.
 *
 * A one-time ephemeral key has no stable key_id to pre-pin in a trust
 * store, so this is a fundamentally different trust mechanism from
 * `verified_issuer` — never conflate the two (see the `PermanenceAnchor`
 * doc comment in @skillerr/protocol).
 */
export async function mintKeylessAnchor(
  sealedManifestDigest: string,
  subject: AnchorSubject,
  opts: KeylessIdentityOptions = {},
): Promise<KeylessAnchorResult> {
  const rekorUrl = opts.rekorUrl ?? DEFAULT_REKOR_URL;
  const fulcioUrl = opts.fulcioUrl ?? DEFAULT_FULCIO_URL;
  const witness = opts.witness ?? new RekorWitness({ rekorBaseURL: rekorUrl });
  const signer =
    opts.signer ??
    new FulcioSigner({
      identityProvider: opts.identityProvider ?? new CIContextProvider(opts.audience),
      fulcioBaseURL: fulcioUrl,
    });
  const builder = new DSSEBundleBuilder({ signer, witnesses: [witness] });
  const statement = buildAnchorStatement(sealedManifestDigest, subject);
  const bundle = await builder.create({
    data: Buffer.from(canonicalize(statement), "utf8"),
    type: ANCHOR_PAYLOAD_TYPE,
  });
  const tlogEntry = bundle.verificationMaterial.tlogEntries[0];
  if (!tlogEntry) {
    throw new Error("Rekor witness returned no transparency log entry — anchoring failed silently, refusing to report success");
  }
  if (bundle.verificationMaterial.content.$case !== "certificate") {
    throw new Error("Fulcio did not return a signing certificate — cannot complete a keyless anchor");
  }
  const leafCertDer = bundle.verificationMaterial.content.certificate.rawBytes;
  const ownerIdentity = leafCertDer
    ? X509Certificate.parse(leafCertDer as unknown as Buffer<ArrayBuffer>).subjectAltName
    : undefined;
  return {
    anchor: {
      kind: "keyless_identity",
      located_at: rekorUrl,
      anchored_at: new Date(Number(tlogEntry.integratedTime) * 1000).toISOString(),
      issuer: fulcioUrl,
      receipt: bundleToJSON(bundle),
      statement_version: ANCHOR_STATEMENT_VERSION,
      predicate_type: ANCHOR_PREDICATE_TYPE,
      ...(ownerIdentity ? { extensions: { owner_identity: ownerIdentity } } : {}),
    },
    log_index: String(tlogEntry.logIndex),
    owner_identity: ownerIdentity,
  };
}

export interface VerifyAnchorOptions {
  /** Skip fetching/caching the current sigstore trusted root (offline/test use). */
  trustedRoot?: Awaited<ReturnType<typeof getTrustedRoot>>;
}

/** What the caller expects the anchor to be about, used to check `subject`, see `checkAnchorPayload`. */
export interface ExpectedAnchorSubject {
  skill_id: string;
  package_digest: string;
}

export interface AnchorVerification {
  ok: boolean;
  log_index?: string;
  integrated_time?: string;
  log_id?: string;
  error?: string;
  /** Distinct machine-readable failure code, currently only set for `anchor_subject_mismatch`. */
  code?: string;
  /** Present (and equal to the caller's `expectedSubject`) only when a statement_version anchor's subject was checked and matched. Absent for legacy bare-digest anchors, which have no subject to check. */
  subject?: ExpectedAnchorSubject;
}

interface PayloadCheckResult {
  ok: boolean;
  error?: string;
  code?: string;
  subject?: ExpectedAnchorSubject;
}

/**
 * Shared by `verifyRekorAnchor`/`verifyKeylessAnchor`: decides legacy
 * (bare-digest) vs. subject-bearing (in-toto statement) verification based
 * on `anchor.statement_version` alone: its absence is the sole legacy
 * signal, so an anchor minted before this feature existed takes exactly the
 * code path it always has, forever. See `PermanenceAnchor.statement_version`
 * in @skillerr/protocol.
 */
function checkAnchorPayload(
  anchor: PermanenceAnchor,
  payload: Buffer,
  sealedManifestDigest: string,
  expectedSubject?: ExpectedAnchorSubject,
): PayloadCheckResult {
  const payloadStr = payload.toString("utf8");
  if (!anchor.statement_version) {
    // Legacy path, unchanged from before subject-bearing statements existed.
    if (payloadStr !== sealedManifestDigest) {
      return { ok: false, error: "Anchor payload does not match the digest being verified" };
    }
    return { ok: true };
  }
  let statement: SkillAnchorStatement;
  try {
    statement = JSON.parse(payloadStr) as SkillAnchorStatement;
  } catch {
    return { ok: false, error: "Anchor payload is not valid JSON for a statement_version anchor" };
  }
  const validate = getAnchorStatementValidator();
  if (!validate(statement)) {
    const detail = (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`).join("; ");
    return { ok: false, error: `Anchor statement failed schema validation: ${detail}` };
  }
  if (statement.predicate.sealed_manifest_digest !== sealedManifestDigest) {
    return { ok: false, error: "Anchor payload does not match the digest being verified" };
  }
  if (!expectedSubject) {
    return { ok: true };
  }
  // The subject is a checked claim, exactly like --keyless re-derives
  // owner_identity from the cert, never trusted from the package's own
  // words. A validly-signed, correctly-logged anchor for a DIFFERENT
  // package must not verify as if it were about this one.
  const subjectEntry = statement.subject[0];
  const expectedHex = bareHex(expectedSubject.package_digest);
  const matches =
    subjectEntry?.name === expectedSubject.skill_id &&
    subjectEntry?.digest.sha256 === expectedHex &&
    statement.predicate.package_digest === expectedSubject.package_digest;
  if (!matches) {
    return {
      ok: false,
      code: "anchor_subject_mismatch",
      error: "Anchored subject does not match the package being verified",
    };
  }
  return { ok: true, subject: expectedSubject };
}

/**
 * Verifies a `transparency_log` PermanenceAnchor's Rekor inclusion proof and
 * signature against the pinned public key that (per our own trust store —
 * see trust-store.ts) is supposed to have produced it. This is the "offline"
 * check: it needs the sigstore trusted root (fetched once, cached locally by
 * @sigstore/tuf — not a live query against this specific log entry) but
 * never calls Rekor itself. `verify-trust --online` layers a live requery on
 * top of this, separately.
 *
 * `expectedSubject` is optional so legacy (pre-statement) call sites keep
 * compiling unchanged; when omitted, only the digest match above is
 * checked, same as before this feature existed.
 */
export async function verifyRekorAnchor(
  anchor: PermanenceAnchor,
  sealedManifestDigest: string,
  publicKeyPem: string,
  expectedSubject?: ExpectedAnchorSubject,
  opts: VerifyAnchorOptions = {},
): Promise<AnchorVerification> {
  if (anchor.kind !== "transparency_log" || !anchor.receipt) {
    return { ok: false, error: "Not a transparency_log anchor with a receipt" };
  }
  try {
    const bundle = bundleFromJSON(anchor.receipt) as Bundle;
    // CRITICAL: @sigstore/verify's DSSESignatureContent never compares the
    // envelope's payload against the `artifact` argument passed to
    // toSignedEntity — it only verifies the signature against the
    // envelope's own embedded payload (confirmed by reading
    // @sigstore/verify's dsse.js: verifySignature() uses this.preAuthEncoding
    // derived from this.env.payload, not the artifact param at all). Without
    // this explicit check, ANY validly-signed-and-logged anchor for a
    // DIFFERENT digest would incorrectly verify as valid for this one.
    if (bundle.content.$case !== "dsseEnvelope") {
      return { ok: false, error: "Expected a DSSE-envelope bundle" };
    }
    const payload = bundle.content.dsseEnvelope.payload;
    const payloadCheck = checkAnchorPayload(anchor, payload, sealedManifestDigest, expectedSubject);
    if (!payloadCheck.ok) {
      return { ok: false, error: payloadCheck.error, code: payloadCheck.code };
    }
    const signedEntity = toSignedEntity(bundle, payload);
    const trustedRoot = opts.trustedRoot ?? (await getTrustedRoot());
    const derKey = createPublicKey(publicKeyPem).export({ format: "der", type: "spki" });
    const protoKey: ProtoPublicKey = {
      rawBytes: derKey as Buffer,
      keyDetails: PublicKeyDetails.PKIX_ED25519,
    };
    const trustMaterial: TrustMaterial = toTrustMaterial(trustedRoot, { [anchor.issuer]: protoKey });
    const verifier = new Verifier(trustMaterial, { tlogThreshold: 1 });
    verifier.verify(signedEntity);
    const tlogEntry = bundle.verificationMaterial.tlogEntries[0];
    return {
      ok: true,
      log_index: tlogEntry?.logIndex !== undefined ? String(tlogEntry.logIndex) : undefined,
      integrated_time: tlogEntry?.integratedTime !== undefined ? String(tlogEntry.integratedTime) : undefined,
      log_id: tlogEntry?.logId?.keyId ? Buffer.from(tlogEntry.logId.keyId).toString("hex") : undefined,
      subject: payloadCheck.subject,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface KeylessVerification {
  ok: boolean;
  log_index?: string;
  integrated_time?: string;
  log_id?: string;
  /** Re-derived from the certificate during this verification, not read from the anchor's stored `extensions` — never trust a claim we didn't just crypto-check. */
  owner_identity?: string;
  owner_issuer?: string;
  error?: string;
  /** Distinct machine-readable failure code, currently only set for `anchor_subject_mismatch`. */
  code?: string;
  /** Present (and equal to the caller's `expectedSubject`) only when a statement_version anchor's subject was checked and matched. */
  subject?: ExpectedAnchorSubject;
}

/**
 * Verifies a `keyless_identity` anchor: same digest-match and Rekor
 * inclusion checks as `verifyRekorAnchor`, but instead of looking up a
 * pinned key in our own trust store, verifies the embedded certificate
 * chain against Fulcio's CA (part of the sigstore trusted root) and
 * extracts the bound OIDC identity from the now-verified certificate —
 * never from the anchor's own `extensions.owner_identity`, which is only
 * ever mint-time convenience, not a checked claim.
 */
export async function verifyKeylessAnchor(
  anchor: PermanenceAnchor,
  sealedManifestDigest: string,
  expectedSubject?: ExpectedAnchorSubject,
  opts: VerifyAnchorOptions = {},
): Promise<KeylessVerification> {
  if (anchor.kind !== "keyless_identity" || !anchor.receipt) {
    return { ok: false, error: "Not a keyless_identity anchor with a receipt" };
  }
  try {
    const bundle = bundleFromJSON(anchor.receipt) as Bundle;
    if (bundle.content.$case !== "dsseEnvelope") {
      return { ok: false, error: "Expected a DSSE-envelope bundle" };
    }
    const payload = bundle.content.dsseEnvelope.payload;
    const payloadCheck = checkAnchorPayload(anchor, payload, sealedManifestDigest, expectedSubject);
    if (!payloadCheck.ok) {
      return { ok: false, error: payloadCheck.error, code: payloadCheck.code };
    }
    if (bundle.verificationMaterial.content.$case !== "certificate" && bundle.verificationMaterial.content.$case !== "x509CertificateChain") {
      return { ok: false, error: "Anchor's bundle has no certificate to verify" };
    }
    const signedEntity = toSignedEntity(bundle, payload);
    const trustedRoot = opts.trustedRoot ?? (await getTrustedRoot());
    // No pinned key map — a keyless anchor's trust comes from the cert
    // chaining to Fulcio's CA (already part of the trusted root), not from
    // any key this project pins.
    const trustMaterial: TrustMaterial = toTrustMaterial(trustedRoot);
    const verifier = new Verifier(trustMaterial, { tlogThreshold: 1 });
    const signer = verifier.verify(signedEntity);
    const tlogEntry = bundle.verificationMaterial.tlogEntries[0];
    return {
      ok: true,
      log_index: tlogEntry?.logIndex !== undefined ? String(tlogEntry.logIndex) : undefined,
      integrated_time: tlogEntry?.integratedTime !== undefined ? String(tlogEntry.integratedTime) : undefined,
      log_id: tlogEntry?.logId?.keyId ? Buffer.from(tlogEntry.logId.keyId).toString("hex") : undefined,
      owner_identity: signer.identity?.subjectAlternativeName,
      owner_issuer: signer.identity?.extensions?.issuer,
      subject: payloadCheck.subject,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The only Rekor instance `search.sigstore.dev` actually indexes. */
const PUBLIC_REKOR_URL = "https://rekor.sigstore.dev";

/**
 * Builds a link to Rekor's public search UI for a verified anchor, so a
 * user doesn't have to take our word for a trust verdict — they can look
 * the same log entry up on sigstore's own site.
 *
 * Deliberately returns `undefined` (not a guessed/best-effort link) when
 * the anchor was logged to anything other than the public good instance:
 * `search.sigstore.dev` only indexes `rekor.sigstore.dev`, so a link built
 * for a self-hosted Rekor would point at an index that doesn't contain the
 * entry — a broken link is worse than no link, since it implies a check
 * that can't actually happen.
 */
export function rekorSearchUrl(
  anchor: Pick<PermanenceAnchor, "kind" | "located_at">,
  logIndex: string | undefined,
): string | undefined {
  const isRekorAnchor = anchor.kind === "transparency_log" || anchor.kind === "keyless_identity";
  if (!isRekorAnchor || anchor.located_at !== PUBLIC_REKOR_URL || !logIndex) {
    return undefined;
  }
  return `https://search.sigstore.dev/?logIndex=${encodeURIComponent(logIndex)}`;
}

/**
 * The live-network extra `verify-trust --online` layers on top of
 * verifyRekorAnchor's offline bundle check: re-fetch the entry directly
 * from Rekor by log index and confirm it's still retrievable there. This
 * is deliberately minimal — a real HTTP GET against a real endpoint, not a
 * simulated/stubbed success — because a comment or flag that claims to do
 * a live check while silently no-op-ing would be exactly the kind of
 * dishonest-by-omission bug this whole launch pass has been fixing.
 */
export async function checkRekorOnline(
  logIndex: string,
  rekorUrl: string = DEFAULT_REKOR_URL,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${rekorUrl}/api/v1/log/entries?logIndex=${encodeURIComponent(logIndex)}`);
    if (!res.ok) {
      return { ok: false, error: `Rekor returned ${res.status} for logIndex ${logIndex}` };
    }
    const body = (await res.json()) as Record<string, unknown>;
    if (Object.keys(body).length === 0) {
      return { ok: false, error: `No entry found at logIndex ${logIndex}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
