/**
 * Adapter layer: thin, real wrappers over this package's existing pack /
 * sign / anchor / gate primitives, shaped to match spec/CONTRACT.md's
 * frozen `@skillerr/core` API exactly. Nothing here is new cryptography or
 * new gate logic — see each function's doc comment for what it wraps.
 * Where the frozen shape genuinely doesn't exist yet (buildLeaf,
 * verifyInclusion, verifyConsistency, generateSBOM, evaluatePolicy,
 * scoreSignals, runSandboxed's declared-vs-actual diff, fromFormat/
 * toFormat's generic bridge), it's tracked in spec/CONTRACT.md's status
 * table instead of stubbed here.
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
