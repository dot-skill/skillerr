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
import type { PermanenceAnchor } from "@skillerr/protocol";
import type { IssuerSigner } from "./signer.js";

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
 */
export async function anchorToRekor(
  sealedManifestDigest: string,
  issuerSigner: IssuerSigner,
  publicKeyPem: string,
  opts: TransparencyOptions = {},
): Promise<TransparencyAnchorResult> {
  const rekorUrl = opts.rekorUrl ?? DEFAULT_REKOR_URL;
  const witness = opts.witness ?? new RekorWitness({ rekorBaseURL: rekorUrl });
  const builder = new DSSEBundleBuilder({
    signer: toSigstoreSigner(issuerSigner, publicKeyPem),
    witnesses: [witness],
  });
  const bundle = await builder.create({
    data: Buffer.from(sealedManifestDigest, "utf8"),
    type: DIGEST_PAYLOAD_TYPE,
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
  const bundle = await builder.create({
    data: Buffer.from(sealedManifestDigest, "utf8"),
    type: DIGEST_PAYLOAD_TYPE,
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

export interface AnchorVerification {
  ok: boolean;
  log_index?: string;
  integrated_time?: string;
  log_id?: string;
  error?: string;
}

/**
 * Verifies a `transparency_log` PermanenceAnchor's Rekor inclusion proof and
 * signature against the pinned public key that (per our own trust store —
 * see trust-store.ts) is supposed to have produced it. This is the "offline"
 * check: it needs the sigstore trusted root (fetched once, cached locally by
 * @sigstore/tuf — not a live query against this specific log entry) but
 * never calls Rekor itself. `verify-trust --online` layers a live requery on
 * top of this, separately.
 */
export async function verifyRekorAnchor(
  anchor: PermanenceAnchor,
  sealedManifestDigest: string,
  publicKeyPem: string,
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
    const actualPayload = bundle.content.dsseEnvelope.payload.toString("utf8");
    if (actualPayload !== sealedManifestDigest) {
      return { ok: false, error: "Anchor payload does not match the digest being verified" };
    }
    const signedEntity = toSignedEntity(bundle, Buffer.from(sealedManifestDigest, "utf8"));
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
    const actualPayload = bundle.content.dsseEnvelope.payload.toString("utf8");
    if (actualPayload !== sealedManifestDigest) {
      return { ok: false, error: "Anchor payload does not match the digest being verified" };
    }
    if (bundle.verificationMaterial.content.$case !== "certificate" && bundle.verificationMaterial.content.$case !== "x509CertificateChain") {
      return { ok: false, error: "Anchor's bundle has no certificate to verify" };
    }
    const signedEntity = toSignedEntity(bundle, Buffer.from(sealedManifestDigest, "utf8"));
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
