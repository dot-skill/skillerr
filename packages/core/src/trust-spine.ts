/**
 * Adapter layer: thin, real wrappers over this package's existing pack /
 * sign / anchor / gate primitives, shaped to match spec/CONTRACT.md's
 * frozen `@skillerr/core` API exactly. Nothing here is new cryptography or
 * new gate logic — see each function's doc comment for what it wraps.
 * `verify()` is the one composite: it doesn't wrap a single existing
 * primitive, it composes `verifySignature`/`verifyInclusion` (this
 * module/merkle-log.ts) plus caller-supplied pre-checked anchor/revocation
 * results into one pass/fail verdict — see its own doc comment for why
 * anchor/revocation aren't re-derived here.
 * Where the frozen shape genuinely doesn't exist yet (generateSBOM,
 * evaluatePolicy, scoreSignals, runSandboxed's declared-vs-actual diff,
 * fromFormat/toFormat's generic bridge), it's tracked in spec/CONTRACT.md's
 * status table instead of stubbed here.
 */
import type {
  SkillPackageFiles,
  SkillManifest,
  SkillCompileProfile,
  SkillPermission,
  SideEffectClass,
  PermanenceAnchor,
} from "@skillerr/protocol";
import { isValidAgentHost } from "@skillerr/protocol";
import { packSkill, unpackSkill } from "./pack.js";
import { createEd25519Signer, verifyEd25519Signature, type IssuerSigner } from "./signer.js";
import {
  anchorToRekor,
  verifyRekorAnchor,
  type AnchorSubject,
  type TransparencyOptions,
  type VerifyAnchorOptions,
} from "./transparency.js";
import { verifyInclusion as verifyMerkleInclusion, type Leaf, type InclusionProof, type SignedTreeHead } from "./merkle-log.js";

// ---------------------------------------------------------------------------
// seal / openSealed
// ---------------------------------------------------------------------------

/** The frozen contract's `SealInput` — this package's existing pre-pack shape. */
export type SealInput = SkillPackageFiles;

export interface SealResult {
  zip: Buffer;
  digest: string;
  manifest: SkillManifest;
}

/**
 * Adapts `packSkill` (sync, `Uint8Array`) to the frozen `seal()` shape
 * (async, `Buffer`, also returns the manifest and its digest directly
 * instead of making the caller unpack to get them). Round-trips through
 * `unpackSkill` rather than recomputing the manifest separately, so the
 * returned `manifest` is guaranteed byte-identical to what's actually
 * embedded in `zip` — never two independently-computed manifests that could
 * drift apart.
 */
export async function seal(input: SealInput): Promise<SealResult> {
  const zipBytes = packSkill(input);
  const { manifest } = unpackSkill(zipBytes);
  return { zip: Buffer.from(zipBytes), digest: manifest.package_digest, manifest };
}

export interface OpenSealedResult {
  manifest: SkillManifest;
  digest: string;
  files: Record<string, Uint8Array>;
}

/** Adapts `unpackSkill` to the frozen `openSealed()` shape (async, `Buffer` input, top-level `digest`). */
export async function openSealed(zip: Buffer): Promise<OpenSealedResult> {
  const { manifest, files } = unpackSkill(new Uint8Array(zip));
  return { manifest, digest: manifest.package_digest, files };
}

// ---------------------------------------------------------------------------
// sign / verifySignature
// ---------------------------------------------------------------------------

/**
 * The frozen contract's `Signature` is an opaque type; this repo defines it
 * to include `public_key_pem` so `verifySignature(digest, sig)` needs no
 * separate key lookup, matching the frozen 2-argument shape exactly. Every
 * `sign()` call in this package returns a `Signature` with this field set,
 * so the design is self-consistent even though the frozen shape doesn't
 * name it.
 */
export interface Signature {
  sig_alg: "ed25519-v1";
  key_id: string;
  sig: string;
  public_key_pem: string;
}

export interface SignOpts {
  privateKeyPem: string;
  keyId: string;
  publicKeyPem: string;
}

/**
 * Published-key signing only (Ed25519, wraps `createEd25519Signer`).
 * Known gap, tracked in spec/CONTRACT.md: this package's existing keyless
 * (Fulcio) path — `mintKeylessAnchor` in transparency.ts — signs *and*
 * anchors in one atomic call; it doesn't expose a pure "just sign" step
 * separable from anchoring. Splitting that apart is real refactoring work,
 * not a thin wrap, so keyless `sign()` isn't implemented in this pass —
 * callers that need it should use `mintKeylessAnchor` directly for now.
 */
export async function sign(digest: string, opts: SignOpts): Promise<Signature> {
  const signer: IssuerSigner = createEd25519Signer(opts.privateKeyPem, opts.keyId);
  return {
    sig_alg: signer.sig_alg,
    key_id: signer.key_id,
    sig: signer.sign(digest),
    public_key_pem: opts.publicKeyPem,
  };
}

/** Wraps `verifyEd25519Signature`; never throws, matches the existing function's false-on-any-failure contract. */
export async function verifySignature(digest: string, sig: Signature): Promise<boolean> {
  return verifyEd25519Signature(sig.public_key_pem, digest, sig.sig);
}

// ---------------------------------------------------------------------------
// Anchor interface + RekorAnchor
// ---------------------------------------------------------------------------

export interface Commitment {
  anchor: Omit<PermanenceAnchor, "package_digest">;
  log_index: string;
}

export interface Anchor {
  anchor(digest: string): Promise<Commitment>;
  verify(digest: string, commitment: Commitment): Promise<boolean>;
}

export interface RekorAnchorConfig {
  issuerSigner: IssuerSigner;
  publicKeyPem: string;
  /**
   * Subject-bearing anchors (RFC 0007) need skill_id/skill_version/
   * issuer_class alongside the digest being anchored. The frozen `Anchor`
   * interface's `anchor(digest)` only takes a digest, so the subject is
   * captured here at construction time instead — `RekorAnchor(config)` is
   * scoped to one package, `.anchor(digest)` anchors digests for it. This
   * mirrors how a real caller (compile/mint) already knows its own subject
   * before it has a digest to anchor.
   */
  subject: AnchorSubject;
  options?: TransparencyOptions;
  verifyOptions?: VerifyAnchorOptions;
}

/**
 * Adapts the already-real, already-tested `anchorToRekor`/`verifyRekorAnchor`
 * (transparency.ts, genuine `@sigstore/*` network calls, not stubbed) to the
 * frozen `Anchor` interface, so an on-chain anchor could later implement the
 * same interface as a drop-in alternative — no code here talks to Rekor
 * directly, it's a pure delegation.
 */
export function RekorAnchor(config: RekorAnchorConfig): Anchor {
  return {
    async anchor(digest: string): Promise<Commitment> {
      const result = await anchorToRekor(
        digest,
        config.issuerSigner,
        config.publicKeyPem,
        config.subject,
        config.options,
      );
      return { anchor: result.anchor, log_index: result.log_index };
    },
    async verify(digest: string, commitment: Commitment): Promise<boolean> {
      const fullAnchor: PermanenceAnchor = {
        ...commitment.anchor,
        package_digest: config.subject.package_digest,
      };
      const result = await verifyRekorAnchor(
        fullAnchor,
        digest,
        config.publicKeyPem,
        { skill_id: config.subject.skill_id, package_digest: config.subject.package_digest },
        config.verifyOptions,
      );
      return result.ok;
    },
  };
}

// ---------------------------------------------------------------------------
// CapabilitySchema
// ---------------------------------------------------------------------------

export type CapabilityKind = "fs" | "net" | "shell";

export interface Capability {
  kind: CapabilityKind;
  /** fs: path prefixes. net: host patterns. shell: always empty today, see the note below. */
  scope: string[];
}

/**
 * Normalizes this package's existing `SideEffectClass` + `SkillPermission`
 * (protocol/src/types.ts) into the frozen contract's fs|net|shell shape.
 * `read`/`write`/`destructive` all map to `fs` (the protocol doesn't split
 * those into separate capability kinds); `network` maps to `net`;
 * `exec` maps to `shell`, but with an always-empty scope — `SkillPermission`
 * has no `commands` field to scope shell access by, only `paths`/`hosts`.
 * Repurposing `paths` as command scoping would silently misrepresent what's
 * actually declared, so this is left honestly empty; adding real `commands`
 * scoping needs a `@skillerr/protocol` schema change, out of scope here.
 */
export function capabilitiesFromPermission(permission: SkillPermission): Capability[] {
  const caps: Capability[] = [];
  const fsClasses: SideEffectClass[] = ["read", "write", "destructive"];
  if (fsClasses.includes(permission.side_effect_class) && permission.paths?.length) {
    caps.push({ kind: "fs", scope: permission.paths });
  }
  if (permission.side_effect_class === "network" && permission.hosts?.length) {
    caps.push({ kind: "net", scope: permission.hosts });
  }
  if (permission.side_effect_class === "exec") {
    caps.push({ kind: "shell", scope: [] });
  }
  return caps;
}

// ---------------------------------------------------------------------------
// evaluateReleaseProfile
// ---------------------------------------------------------------------------

export interface GateResult {
  pass: boolean;
  reasons: string[];
}

/**
 * Pure equivalent of the release-mint gate `mintSkillPackage` (mint.ts)
 * currently runs as inline throws. Mirrors those checks exactly: host
 * validity, `needs_human_review`, `compile_profile`, an approved release
 * compilation report, no unapproved required inputs, and the already-
 * computed `manifest.completeness.complete` (same field mint.ts itself
 * reads — this does not re-run `assessCompleteness`, which needs
 * compile-time-only inputs this package's post-pack shape no longer has).
 * Deliberately duplicated rather than having mint.ts call this yet —
 * refactoring mint.ts's tested throw-based gate to delegate here is real,
 * separate follow-up work (tracked in spec/CONTRACT.md), not a thin wrap;
 * this function's job right now is to give the registry (or any caller) a
 * pass/fail preflight without needing to attempt a mint.
 */
export function evaluateReleaseProfile(pkg: SkillPackageFiles, profile: SkillCompileProfile): GateResult {
  const reasons: string[] = [];

  if (profile === "release") {
    // mint.ts checks isValidAgentHost(opts.host) — a separate parameter the
    // mint call receives directly. evaluateReleaseProfile's frozen shape
    // only takes `pkg`, so this reads the same host value back out of
    // provenance.source.agent.host instead (real data: compile.ts stores
    // the full source.agent object there, see compile.ts's `provenance:`
    // literal). Absent under provenance_mode "proof_only", where host
    // can't be verified from pkg alone — correctly fails this check rather
    // than silently skipping it.
    if (!isValidAgentHost((pkg.provenance?.source as { agent?: { host?: string } } | undefined)?.agent?.host)) {
      reasons.push("host is not a valid AI agent host (denylisted human/cli/shell/manual, or missing)");
    }
    if (pkg.manifest.needs_human_review) {
      reasons.push("needs_human_review is true — approve inputs/permissions first");
    }
    if (pkg.manifest.compile_profile !== "release") {
      reasons.push("compile_profile must be release");
    }
    const report = pkg.provenance?.compilation_report;
    if (
      !report ||
      report.profile !== "release" ||
      report.semantic_contract !== "native_0.5" ||
      !report.completeness.complete ||
      !report.approved ||
      report.pending_approvals.length > 0
    ) {
      reasons.push("an approved release compilation report is required");
    }
    const pendingInputs = pkg.manifest.inputs.filter((i) => i.required && i.approved !== true);
    if (pendingInputs.length) {
      reasons.push(`unapproved required inputs: ${pendingInputs.map((p) => p.name).join(", ")}`);
    }
  }

  if (!pkg.manifest.completeness?.complete) {
    reasons.push(
      `incomplete: missing ${pkg.manifest.completeness?.missing.join(", ") || "completeness report"}`,
    );
  }

  return { pass: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// verify — unified entry point
// ---------------------------------------------------------------------------

/**
 * A signed-off revocation claim for a digest. Matches
 * docs/rfcs/0003-revocation-expiry.md's `revocation_record` shape (that
 * RFC is spec-only, not implemented as a checkable log yet — `verify()`
 * doesn't re-verify this record's own signature, since that needs a
 * pinned revocation-issuer key this function has no context for; it's
 * the caller's job to have already checked `sig` against a trusted key
 * before including a revocation record here at all, same posture as
 * `anchored` below).
 */
export interface RevocationRecord {
  kind: "revocation_record";
  package_digest: string;
  reason: "security" | "policy" | "superseded" | "other";
  detail?: string;
  revoked_at: string;
  issuer_key_id: string;
}

/**
 * Evidence a caller has already gathered for a digest. `signature` and
 * `leaf`+`inclusionProof`+`treeHead` are checked here directly (both are
 * self-contained: verifying them needs nothing beyond what's in the
 * evidence itself). `anchored` and `revocation` are caller-supplied
 * pre-checked results rather than raw commitments/records `verify()`
 * re-derives: a `Commitment`'s real verification needs the specific
 * `Anchor` instance that produced it (issuer key, subject metadata —
 * see `RekorAnchor`'s config), and a `RevocationRecord`'s real
 * verification needs a pinned revocation-issuer key; neither fits inside
 * a generic, standalone `verify()` with no key-store access. Matches this
 * package's registry-independence invariant too: `verify()` has no
 * revocation *list* of its own to consult, only what's handed to it.
 */
export interface Evidence {
  signature?: Signature;
  leaf?: Leaf;
  inclusionProof?: InclusionProof;
  treeHead?: SignedTreeHead;
  /** Set once the caller has already run the relevant `Anchor.verify()` (e.g. `RekorAnchor`). */
  anchored?: boolean;
  /** A revocation record already matched to this digest and already signature-checked by the caller. */
  revocation?: RevocationRecord;
}

export interface VerifyResult {
  verified: boolean;
  digest: string;
  anchored: boolean;
  revoked: boolean;
  reasons: string[];
}

/**
 * Composes whatever evidence a caller supplies into one pass/fail verdict
 * with reasons — the keystone both a CLI `verify` command and the
 * registry's `/api/verify` are meant to sit on top of, per spec/
 * CONTRACT.md. Never claims `verified: true` without at least one
 * positive, actually-checked piece of evidence (a bare digest with no
 * evidence at all reports honestly as unverified, not defaulted to
 * trusted); never claims `verified: true` if any supplied evidence
 * fails, even if other evidence passed — a bad signature isn't
 * outweighed by a good inclusion proof.
 */
export async function verify(digest: string, evidence: Evidence = {}): Promise<VerifyResult> {
  const reasons: string[] = [];
  let anyChecked = false;
  let anyFailed = false;

  if (evidence.signature) {
    anyChecked = true;
    const ok = await verifySignature(digest, evidence.signature);
    reasons.push(ok ? "Signature verified" : "Signature verification failed");
    if (!ok) anyFailed = true;
  }

  if (evidence.leaf && evidence.inclusionProof && evidence.treeHead) {
    anyChecked = true;
    const ok = verifyMerkleInclusion(evidence.leaf, evidence.inclusionProof, evidence.treeHead);
    reasons.push(ok ? "Inclusion proof verified against signed tree head" : "Inclusion proof failed");
    if (!ok) anyFailed = true;
  }

  if (evidence.anchored !== undefined) {
    anyChecked = true;
    reasons.push(evidence.anchored ? "Anchor commitment verified" : "Anchor commitment failed verification");
    if (!evidence.anchored) anyFailed = true;
  }

  const revoked = Boolean(evidence.revocation && evidence.revocation.package_digest === digest);
  if (evidence.revocation && evidence.revocation.package_digest !== digest) {
    // Irrelevant to this digest — noted, but deliberately doesn't count as
    // "evidence checked" (it isn't evidence about this digest at all) and
    // doesn't affect anyFailed/revoked either.
    reasons.push("Supplied revocation record is for a different digest — ignored, not honored");
  } else if (revoked) {
    anyChecked = true;
    reasons.push(`Digest revoked: ${evidence.revocation!.reason}${evidence.revocation!.detail ? ` — ${evidence.revocation!.detail}` : ""}`);
  }

  if (!anyChecked) {
    reasons.push("No evidence supplied — digest pin only, nothing cryptographically checked");
  }

  return {
    verified: anyChecked && !anyFailed && !revoked,
    digest,
    anchored: Boolean(evidence.anchored),
    revoked,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// generateSBOM
// ---------------------------------------------------------------------------

export interface SBOMHash {
  alg: "SHA-256";
  content: string;
}

export interface SBOMComponent {
  type: "application" | "library";
  "bom-ref": string;
  name: string;
  version: string;
  hashes?: SBOMHash[];
}

/** CycloneDX 1.5 (a JSON-object subset — every field here is spec-valid CycloneDX, just not the full schema). */
export interface SBOM {
  bomFormat: "CycloneDX";
  specVersion: "1.5";
  serialNumber: string;
  version: 1;
  metadata: {
    timestamp?: string;
    component: SBOMComponent;
  };
  components: SBOMComponent[];
}

function bareHex(digest: string): string {
  return digest.replace(/^sha256:/, "");
}

/**
 * Deterministic UUID (RFC 9562 version 8, "custom") derived from the
 * package digest — the same package always gets the same
 * `serialNumber`, so generating an SBOM twice for identical input is
 * byte-identical, matching this repo's determinism discipline elsewhere
 * (SEC-J). Not a random/random-seeded UUID (CycloneDX doesn't require
 * one to be); this is a legitimate, spec-conformant use of a
 * vendor-defined UUID version specifically for exactly this "derived from
 * other data" case.
 */
function uuidFromDigest(digest: string): string {
  const hex = bareHex(digest).slice(0, 32).padEnd(32, "0");
  const bytes = hex.match(/.{2}/g)!.map((b) => parseInt(b, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x80; // version 8
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
  const h = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * A minimal, real CycloneDX 1.5 SBOM: the package itself as the root
 * `metadata.component`, and its declared `SkillManifest.dependencies`
 * (other skills, digest-pinned when known) as `components`. Deliberately
 * doesn't invent a deeper dependency graph — a `.skill` package's only
 * real declared "supply chain" today is `dependencies: SkillDependency[]`
 * (protocol/src/types.ts); there's no npm-style transitive package graph
 * to walk. `opts.timestamp` is optional and omitted by default so the
 * same package produces a byte-identical SBOM on every call; pass it
 * explicitly if a wall-clock timestamp is wanted in the output (never
 * inferred from `Date.now()` here).
 */
export function generateSBOM(pkg: SkillPackageFiles, opts: { timestamp?: string } = {}): SBOM {
  const manifest = pkg.manifest;
  const components: SBOMComponent[] = (manifest.dependencies ?? []).map((dep) => ({
    type: "library",
    "bom-ref": `skill:${dep.skill_id}@${dep.version}`,
    name: dep.skill_id,
    version: dep.version,
    ...(dep.package_digest ? { hashes: [{ alg: "SHA-256" as const, content: bareHex(dep.package_digest) }] } : {}),
  }));
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${uuidFromDigest(manifest.package_digest)}`,
    version: 1,
    metadata: {
      ...(opts.timestamp ? { timestamp: opts.timestamp } : {}),
      component: {
        type: "application",
        "bom-ref": `skill:${manifest.id}@${manifest.version}`,
        name: manifest.id,
        version: manifest.version,
        hashes: [{ alg: "SHA-256", content: bareHex(manifest.package_digest) }],
      },
    },
    components,
  };
}
