import { readFileSync } from "node:fs";
import type {
  CreationAttestation,
  HostClaimBinding,
  IssuerClass,
  PermanenceAnchor,
  SkillPackageFiles,
  TrustProfile,
  TrustState,
  TrustView,
} from "@skillerr/protocol";
import {
  detectAgentRuntimeMarkers,
  hasAgentRuntimeEvidence,
  isValidAgentHost,
} from "@skillerr/protocol";
import {
  canonicalize,
  PUBLIC_DEV_MINT_KEY,
  PUBLIC_DEV_MINT_KEY_ID,
  sealedManifestDigest,
  sha256Digest,
} from "./hash.js";
import { packSkill, unpackSkill } from "./pack.js";
import { validatePackageBytes, type ValidationIssue } from "./validate.js";

export interface MintOptions {
  host: string;
  provider?: string;
  agent_runtime?: string;
  agent_version?: string;
  key_id?: string;
  model?: string;
  deployment?: "local" | "hosted" | "hybrid" | "unknown";
  endpoint?: string;
  actors?: string[];
  /**
   * HMAC-style digest seal.
   * Omit / use the public constant only for local development — never production trust.
   */
  issuer_secret?: string;
  policy_profile?: TrustProfile;
  /**
   * Evidence that mint was invoked from an agent runtime path (not a bare human shell
   * that only exported SKILL_HOST). Markers are still locally spoofable; residual risk
   * for local LLMs remains.
   */
  agent_runtime_evidence?: {
    markers?: string[];
    session_id?: string;
  };
  /**
   * Only set when a non-public issuer key authenticates the host/model claim.
   * Default is always self_reported.
   */
  host_claim_binding?: HostClaimBinding;
  /** Env snapshot for marker detection (defaults to process.env). */
  env?: Record<string, string | undefined>;
}

export interface VerifyMintTrustOptions {
  issuer_secret?: string;
  /**
   * When true, public-dev HMAC may pass structural verification as trust_state=development.
   * Production execute paths must leave this false (fail closed).
   */
  allow_development_issuer?: boolean;
  /** Accept self_reported host binding as ok for the requested profile. Default false for minted+. */
  allow_self_reported?: boolean;
}

function loadCoreIdentity(): { name: string; version: string } {
  const metadata = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { name?: unknown; version?: unknown };
  if (typeof metadata.name !== "string" || typeof metadata.version !== "string") {
    throw new Error("Invalid @skillerr/core package metadata");
  }
  return { name: metadata.name, version: metadata.version };
}

const CORE_IDENTITY = loadCoreIdentity();

function resolveIssuerClass(secret: string, keyId: string): IssuerClass {
  if (secret === PUBLIC_DEV_MINT_KEY || keyId === PUBLIC_DEV_MINT_KEY_ID) {
    return "public_dev_hmac";
  }
  return "configured_hmac";
}

function resolveHostClaimBinding(
  opts: MintOptions,
  issuerClass: IssuerClass,
  markers: string[],
): HostClaimBinding {
  if (opts.host_claim_binding === "verified_issuer") {
    if (issuerClass === "public_dev_hmac") {
      throw new Error(
        "Cannot mark host_claim_binding=verified_issuer with the public development HMAC key",
      );
    }
    if (!hasAgentRuntimeEvidence(opts.agent_runtime_evidence, opts.env) && markers.length === 0) {
      throw new Error(
        "verified_issuer host binding requires agent runtime evidence (markers or session_id)",
      );
    }
    return "verified_issuer";
  }
  return "self_reported";
}

/**
 * Seal a draft package as minted.
 * Content under signatures/ may change; package_digest (content) stays fixed after finalize.
 *
 * Trust rules:
 * - Forbidden hosts (human/cli/shell/manual/…) refuse mint entirely.
 * - Env-only SKILL_HOST without agent runtime markers still mints, but as self_reported
 *   + public_dev_hmac — never production trust.
 * - Seal binds sealed_manifest_digest (identity + policy + content claims).
 */
export function mintSkillPackage(
  pkg: SkillPackageFiles,
  opts: MintOptions,
): { files: SkillPackageFiles; packageBytes: Uint8Array; attestation: CreationAttestation } {
  if (!isValidAgentHost(opts.host)) {
    throw new Error(
      `Mint host "${opts.host}" is not a valid AI agent host (denylisted human/cli/shell/manual). ` +
        `Use an agent host id such as cursor, ollama, lmstudio, llama-cpp, custom-agent.`,
    );
  }
  if (pkg.manifest.needs_human_review) {
    throw new Error("Cannot mint while needs_human_review is true — approve inputs/permissions first");
  }
  if (pkg.manifest.compile_profile !== "release") {
    throw new Error(
      "Cannot mint: compile_profile must be release. Complete the journey and release compile first.",
    );
  }
  if (!pkg.manifest.completeness?.complete) {
    throw new Error(
      `Cannot mint incomplete skill. Missing: ${pkg.manifest.completeness?.missing.join(", ") || "completeness report"}`,
    );
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
    throw new Error("Cannot mint: approved release compilation report required");
  }
  const pending = pkg.manifest.inputs.filter((i) => i.required && i.approved !== true);
  if (pending.length) {
    throw new Error(
      `Cannot mint with unapproved inputs: ${pending.map((p) => p.name).join(", ")}`,
    );
  }

  const draftBytes = packSkill({
    ...pkg,
    signatures: undefined,
    attestation: undefined,
    anchors: pkg.anchors ?? pkg.manifest.anchors,
  });
  const unpacked = unpackSkill(draftBytes);
  const package_digest = unpacked.manifest.package_digest;

  const agentRuntime = opts.agent_runtime ?? CORE_IDENTITY.name;
  const agentVersion =
    opts.agent_version ?? (agentRuntime === CORE_IDENTITY.name ? CORE_IDENTITY.version : "unknown");

  const secret = opts.issuer_secret ?? PUBLIC_DEV_MINT_KEY;
  const keyId = opts.key_id ?? (secret === PUBLIC_DEV_MINT_KEY ? PUBLIC_DEV_MINT_KEY_ID : "configured-issuer");
  const issuer_class = resolveIssuerClass(secret, keyId);
  const markers = [
    ...detectAgentRuntimeMarkers(opts.env),
    ...(opts.agent_runtime_evidence?.markers ?? []),
  ].filter((m, i, arr) => arr.indexOf(m) === i);
  const host_claim_binding = resolveHostClaimBinding(opts, issuer_class, markers);

  // Apply seal-bound policy updates before hashing sealed_manifest_digest so
  // attestation covers the final identity/policy/content claims.
  const sealedManifestBase = {
    ...unpacked.manifest,
    policy: {
      ...unpacked.manifest.policy,
      require_signatures: true,
      require_minted: true,
      trust_profile: opts.policy_profile ?? "minted",
    },
  };
  const sealed_manifest_digest = sealedManifestDigest(sealedManifestBase);
  // Minting tightens policy fields (require_signatures/require_minted/
  // trust_profile), which are covered by manifest_digest's claim set too.
  // Refresh it so it isn't left stale/mismatched against the sealed state —
  // sealed_manifest_digest and manifest_digest are the same computation over
  // the same claims, so they're equal for a minted package by construction.
  sealedManifestBase.manifest_digest = sealed_manifest_digest;

  const attestation: CreationAttestation = {
    kind: "creation_attestation",
    package_digest,
    sealed_manifest_digest,
    skill_id: pkg.manifest.id,
    skill_version: pkg.manifest.version,
    minted_at: new Date().toISOString(),
    agent: {
      runtime: agentRuntime,
      version: agentVersion,
      key_id: keyId,
    },
    host: opts.host,
    provider: opts.provider,
    model: opts.model,
    deployment: opts.deployment,
    endpoint: opts.endpoint,
    host_claim_binding,
    issuer_class,
    agent_runtime_markers: markers.length ? markers : undefined,
    journey: {
      source_id: pkg.provenance?.compilation_report?.source_id,
      source_hash:
        pkg.provenance?.proof &&
        typeof pkg.provenance.proof === "object" &&
        pkg.provenance.proof !== null &&
        "source_hash" in pkg.provenance.proof
          ? String((pkg.provenance.proof as { source_hash: string }).source_hash)
          : undefined,
      recipe_id: pkg.provenance?.compilation_report?.recipe_id,
      recipe_hash:
        pkg.provenance?.recipe &&
        typeof pkg.provenance.recipe === "object" &&
        pkg.provenance.recipe !== null &&
        "hash" in pkg.provenance.recipe
          ? String((pkg.provenance.recipe as { hash: string }).hash)
          : undefined,
      proof_digest: pkg.provenance?.proof
        ? sha256Digest(canonicalize(pkg.provenance.proof))
        : undefined,
      summary: pkg.provenance?.journey?.summary,
    },
    generation_usage: pkg.provenance?.generation_usage,
    human_approvals: {
      inputs: pkg.manifest.inputs.filter((i) => i.approved === true).map((i) => i.name),
      permissions: pkg.manifest.permissions
        .filter((p) => p.requires_consent)
        .map((p) => p.side_effect_class),
      // No actor evidence was fabricated: absent/empty opts.actors is recorded as
      // attested:false, never silently defaulted to a claimed human approver.
      actors: opts.actors ?? [],
      attested: (opts.actors?.length ?? 0) > 0,
    },
    policy_profile: opts.policy_profile ?? "minted",
  };

  const payload = canonicalize(attestation);
  const payloadDigest = sha256Digest(payload);
  const sig = sha256Digest(`${secret}:${payloadDigest}`);

  const dsse = {
    payloadType: "application/vnd.dot-skill.creation-attestation+json",
    payload_digest: payloadDigest,
    signatures: [{ keyid: attestation.agent.key_id, sig }],
    attestation,
  };

  const minted: SkillPackageFiles = {
    ...unpacked.raw,
    manifest: {
      ...sealedManifestBase,
      mint: {
        mint_status: "minted",
        minted_at: attestation.minted_at,
        mint_issuer: attestation.agent.runtime,
        content_id: package_digest,
      },
      attestation_digest: payloadDigest,
      sealed_manifest_digest,
    },
    attestation,
    signatures: {
      "creation.dsse.json": dsse,
    },
    anchors: unpacked.raw.anchors ?? unpacked.manifest.anchors,
  };

  const packageBytes = packSkill(minted);
  const verify = unpackSkill(packageBytes);
  if (verify.manifest.package_digest !== package_digest) {
    throw new Error(
      `Mint changed content digest (${verify.manifest.package_digest} != ${package_digest})`,
    );
  }

  return { files: { ...minted, manifest: verify.manifest }, packageBytes, attestation };
}

export function addPermanenceAnchor(
  archive: Uint8Array,
  anchor: Omit<PermanenceAnchor, "package_digest"> & { package_digest?: string },
): Uint8Array {
  const unpacked = unpackSkill(archive);
  const package_digest = unpacked.manifest.package_digest;
  const full: PermanenceAnchor = {
    ...anchor,
    package_digest: anchor.package_digest ?? package_digest,
  };
  if (full.package_digest !== package_digest) {
    throw new Error("Anchor package_digest must match skill package_digest");
  }
  const anchors = [...(unpacked.manifest.anchors ?? []), full];
  const files: SkillPackageFiles = {
    ...unpacked.raw,
    manifest: {
      ...unpacked.manifest,
      anchors,
    },
    anchors,
    signatures: {
      ...(unpacked.raw.signatures ?? {}),
      [`anchors/${anchors.length}-${full.kind}.json`]: full,
    },
  };
  return packSkill(files);
}

function extractAttestation(unpacked: ReturnType<typeof unpackSkill>): {
  attestation?: CreationAttestation;
  envelope?: {
    attestation?: CreationAttestation;
    payload_digest?: string;
    signatures?: Array<{ sig: string; keyid?: string }>;
  };
} {
  const envelope = unpacked.raw.signatures?.["creation.dsse.json"] as
    | {
        attestation?: CreationAttestation;
        payload_digest?: string;
        signatures?: Array<{ sig: string; keyid?: string }>;
      }
    | undefined;
  const attestation = envelope?.attestation ?? unpacked.raw.attestation;
  return { attestation, envelope };
}

function classifyTrustState(
  attestation: CreationAttestation | undefined,
  signedOk: boolean,
): TrustState {
  if (!attestation || !signedOk) return "untrusted";
  if (attestation.issuer_class === "public_dev_hmac") return "development";
  if (attestation.host_claim_binding === "verified_issuer") return "verified_issuer";
  return "self_reported";
}

export function verifyMintTrust(
  archive: Uint8Array,
  profile: TrustProfile = "minted",
  issuer_secret_or_opts?: string | VerifyMintTrustOptions,
): {
  ok: boolean;
  issues: ValidationIssue[];
  attestation?: CreationAttestation;
  trust_state: TrustState;
} {
  const opts: VerifyMintTrustOptions =
    typeof issuer_secret_or_opts === "string"
      ? { issuer_secret: issuer_secret_or_opts }
      : (issuer_secret_or_opts ?? {});

  const base = validatePackageBytes(archive);
  const issues = [...base.issues];
  const unpacked = unpackSkill(archive);
  const mintStatus = unpacked.manifest.mint?.mint_status ?? "draft";
  const { attestation, envelope } = extractAttestation(unpacked);
  let signedOk = false;

  if (profile !== "open") {
    if (mintStatus !== "minted") {
      issues.push({
        severity: "error",
        code: "not_minted",
        message: "Trust profile requires mint_status=minted",
      });
    }
    if (!attestation) {
      issues.push({
        severity: "error",
        code: "missing_attestation",
        message: "Minted skills require CreationAttestation",
      });
    } else if (!envelope?.signatures?.[0]?.sig) {
      issues.push({
        severity: "error",
        code: "missing_attestation_signature",
        message: "Minted trust profile requires a signed DSSE attestation envelope",
      });
    } else if (attestation.package_digest !== unpacked.manifest.package_digest) {
      issues.push({
        severity: "error",
        code: "attestation_digest_mismatch",
        message: "Attestation package_digest does not match manifest",
      });
    } else {
      const expectedSealed = sealedManifestDigest(unpacked.manifest);
      const sealed =
        attestation.sealed_manifest_digest ?? unpacked.manifest.sealed_manifest_digest;
      if (!sealed) {
        issues.push({
          severity: "error",
          code: "missing_sealed_manifest_digest",
          message: "Attestation must bind sealed_manifest_digest over identity/policy/content claims",
        });
      } else if (sealed !== expectedSealed) {
        issues.push({
          severity: "error",
          code: "sealed_manifest_digest_mismatch",
          message: "sealed_manifest_digest does not match current manifest claims",
        });
      }
      if (
        unpacked.manifest.sealed_manifest_digest &&
        unpacked.manifest.sealed_manifest_digest !== sealed
      ) {
        issues.push({
          severity: "error",
          code: "manifest_sealed_digest_mismatch",
          message: "Manifest sealed_manifest_digest does not match attestation",
        });
      }

      const payloadDigest = sha256Digest(canonicalize(attestation));
      if (envelope.payload_digest !== payloadDigest) {
        issues.push({
          severity: "error",
          code: "attestation_payload_digest",
          message: "DSSE payload_digest does not match CreationAttestation",
        });
      }

      // issuer_class is a required attestation field. A stripped/absent value
      // must be a loud, fail-closed error — never leniently reconstructed
      // from key_id, which an attacker controls just as easily as the field
      // itself and could use to launder a public_dev_hmac seal into a
      // higher-trust label downstream (see classifyTrustState, which reads
      // attestation.issuer_class directly and would otherwise report
      // self_reported/verified_issuer instead of development).
      if (!attestation.issuer_class) {
        issues.push({
          severity: "error",
          code: "missing_issuer_class",
          message:
            "CreationAttestation.issuer_class is absent. Trust class must be explicit on the " +
            "attestation; it is never reconstructed from key_id.",
        });
      }
      const issuerClass = attestation.issuer_class;

      // Fail closed: public-dev HMAC is never production trust unless explicitly allowed.
      if (issuerClass === "public_dev_hmac" && !opts.allow_development_issuer) {
        issues.push({
          severity: "error",
          code: "public_dev_issuer_untrusted",
          message:
            "Seal uses the public development HMAC key — not production trust. " +
            "Pass allow_development_issuer only for local testing, or mint with a configured issuer secret.",
        });
      }

      const hostBinding = attestation.host_claim_binding ?? "self_reported";
      if (
        hostBinding === "self_reported" &&
        !opts.allow_self_reported &&
        !opts.allow_development_issuer
      ) {
        issues.push({
          severity: "error",
          code: "self_reported_host_untrusted",
          message:
            "Host/model claims are self_reported (e.g. SKILL_HOST env alone). " +
            "Not treated as verified_issuer trust.",
        });
      }

      const secret =
        opts.issuer_secret ??
        (issuerClass === "public_dev_hmac" ? PUBLIC_DEV_MINT_KEY : undefined);
      if (!secret) {
        issues.push({
          severity: "error",
          code: "issuer_secret_required",
          message: "Configured issuer seal requires a matching issuer_secret in the trust store",
        });
      } else {
        const expected = sha256Digest(`${secret}:${payloadDigest}`);
        const sig = envelope?.signatures?.[0]?.sig;
        if (sig !== expected) {
          issues.push({
            severity: "error",
            code: "attestation_sig_invalid",
            message: "CreationAttestation signature failed verification",
          });
        } else {
          signedOk = true;
        }
      }

      if (issuerClass === "public_dev_hmac") {
        issues.push({
          severity: "warning",
          code: "development_attestation",
          message:
            "Attestation uses the public development key — labeled development, never production identity",
        });
      }
    }
  } else if (attestation && envelope?.signatures?.[0]?.sig) {
    // open profile: still classify if a seal is present
    const payloadDigest = sha256Digest(canonicalize(attestation));
    const secret = opts.issuer_secret ?? PUBLIC_DEV_MINT_KEY;
    signedOk = envelope.signatures[0].sig === sha256Digest(`${secret}:${payloadDigest}`);
  }

  if (profile === "anchored") {
    const anchors = unpacked.manifest.anchors ?? [];
    if (!anchors.length) {
      issues.push({
        severity: "error",
        code: "anchor_required",
        message: "Trust profile requires at least one PermanenceAnchor",
      });
    }
  }

  if (profile.startsWith("issuer:")) {
    const want = profile.slice("issuer:".length);
    if (attestation?.agent.runtime !== want && attestation?.agent.key_id !== want) {
      issues.push({
        severity: "error",
        code: "issuer_mismatch",
        message: `Attestation issuer does not match ${profile}`,
      });
    }
  }

  const trust_state = classifyTrustState(attestation, signedOk);
  return {
    ok: !issues.some((i) => i.severity === "error"),
    issues,
    attestation,
    trust_state,
  };
}

/**
 * TrustView from skill.json + signatures + digests only — no compile, no model body ingest.
 */
export function inspectTrustView(archive: Uint8Array): TrustView {
  const base = validatePackageBytes(archive);
  const warnings: string[] = [];
  if (!base.manifest) {
    return {
      trust_state: "untrusted",
      mint_status: "draft",
      signed: false,
      package_digest: "",
      label: "INVALID — package failed validation",
      warnings: [],
      issues: base.issues,
    };
  }

  const unpacked = unpackSkill(archive);
  const m = unpacked.manifest;
  const mint_status = m.mint?.mint_status ?? "draft";
  const { attestation, envelope } = extractAttestation(unpacked);
  const signed = Boolean(envelope?.signatures?.[0]?.sig && attestation);

  let trust_state: TrustState = "untrusted";
  let label = "UNSIGNED / OPEN — untrusted";

  if (mint_status === "draft" || !signed) {
    trust_state = "untrusted";
    label = "UNSIGNED / OPEN — untrusted (do not execute without --allow-untrusted)";
    warnings.push("Package has no verified creation seal");
  } else {
    const verify = verifyMintTrust(archive, "minted", {
      allow_development_issuer: true,
      allow_self_reported: true,
    });
    trust_state = verify.trust_state;
    if (trust_state === "development") {
      label = "DEVELOPMENT seal (public-dev HMAC) — not production trust";
      warnings.push("Public development HMAC is forgeable; treat as untrusted for production execute");
    } else if (trust_state === "self_reported") {
      label = "SELF-REPORTED agent host claims — signed but not verified_issuer";
      warnings.push("Host/provider/model are self-asserted; local LLMs can lie about authorship");
    } else if (trust_state === "verified_issuer") {
      label = "VERIFIED ISSUER seal — host claims bound by configured issuer";
      warnings.push(
        "Issuer key authenticity is established; model honesty (esp. local LLMs) remains a residual risk",
      );
    } else {
      label = "UNTRUSTED — seal present but verification failed";
    }
    for (const issue of verify.issues) {
      if (issue.severity === "warning") warnings.push(issue.message);
    }
  }

  const expectedSealed = sealedManifestDigest(m);

  return {
    trust_state,
    mint_status,
    signed,
    issuer: attestation?.agent.runtime ?? m.mint?.mint_issuer,
    issuer_class: attestation?.issuer_class,
    host_claim_binding: attestation?.host_claim_binding,
    agent: attestation
      ? {
          host: attestation.host,
          provider: attestation.provider,
          model: attestation.model,
          runtime: attestation.agent.runtime,
          version: attestation.agent.version,
          key_id: attestation.agent.key_id,
          deployment: attestation.deployment,
          markers: attestation.agent_runtime_markers,
        }
      : undefined,
    package_digest: m.package_digest,
    sealed_manifest_digest: attestation?.sealed_manifest_digest ?? m.sealed_manifest_digest ?? expectedSealed,
    attestation_digest: m.attestation_digest,
    label,
    warnings,
    issues: base.issues,
  };
}
