/**
 * Phase E2: a structural, not just documented, separation between claims
 * this protocol has cryptographically checked and claims it's only relaying
 * (self-reported by the environment/signer, never independently verified).
 *
 * docs/WHAT-IS-VERIFIABLE.md already draws this line in prose. The problem
 * that leaves open: nothing stops a UI or an agent parsing TrustView's JSON
 * from displaying `agent.host` next to a green "verified" badge, because
 * both verified and self-reported fields sit in the same flat object with
 * no machine-readable assurance tag at all. `assessClaims` fixes that by
 * putting every claim into exactly one of two separate arrays — never a
 * single array with an easy-to-ignore boolean flag — so a consumer that
 * only ever reads `.verified` structurally cannot end up displaying a
 * self-reported value as checked.
 */
import type { TrustView } from "@skillerr/protocol";
import type { AnchorVerification, KeylessVerification } from "./transparency.js";

export interface VerifiedClaim {
  /** Dot-path identifying the claim, e.g. "package_digest", "agent.host", "transparency_log.owner_identity". */
  field: string;
  value: string;
  /** How this was checked — for transparency/debugging, not for display logic. */
  method: string;
}

export interface SelfReportedClaim {
  field: string;
  value: string;
  /** Where this came from and why it isn't independently checkable. */
  note: string;
}

export interface ClaimsAssurance {
  verified: VerifiedClaim[];
  self_reported: SelfReportedClaim[];
}

export interface AssessClaimsOptions {
  /** Result of verifyRekorAnchor, if a transparency_log anchor was present and checked. */
  transparency?: AnchorVerification;
  /** Result of verifyKeylessAnchor, if a keyless_identity anchor was present and checked. */
  keyless?: KeylessVerification;
}

/**
 * Builds the verified/self-reported split from an already-computed
 * `TrustView` (see `inspectTrustView`) plus optional anchor-verification
 * results (see `verifyRekorAnchor`/`verifyKeylessAnchor`). Performs no
 * cryptography itself — every claim here is placed based on a check some
 * other, already-tested function already ran; this only organizes the
 * results into a shape that's hard to misuse.
 */
export function assessClaims(view: TrustView, opts: AssessClaimsOptions = {}): ClaimsAssurance {
  const verified: VerifiedClaim[] = [];
  const self_reported: SelfReportedClaim[] = [];

  if (view.package_digest) {
    verified.push({
      field: "package_digest",
      value: view.package_digest,
      method: "sha256 content digest, recomputed from the archive and compared",
    });
  }

  if (view.sealed_manifest_digest) {
    verified.push({
      field: "sealed_manifest_digest",
      value: view.sealed_manifest_digest,
      method: "recomputed from the manifest, compared against the signed value",
    });
  }

  if (view.signed) {
    const method =
      view.trust_state === "development"
        ? "public-dev HMAC verified structurally — forgeable by design, development trust only"
        : view.issuer_class === "configured_ed25519"
          ? "ed25519 signature verified against the signer's public key"
          : "signature verified";
    verified.push({ field: "signature", value: view.trust_state, method });
  }

  // Both verified_issuer and self_reported trust_state mean the signer's
  // key_id was found pinned in the trust store and its signature verified
  // — that part is identical between them. What differs is host_claim_binding
  // (below): self_reported only means the *host/agent claims* lack runtime
  // evidence to bind them to that verified key, not that the key itself is
  // unverified. Conflating the two would be exactly the kind of structural
  // mistake this module exists to prevent. Note this is `agent.key_id`, not
  // `view.issuer` — TrustView.issuer is actually `agent.runtime` (which
  // tool minted this), a self-reported field handled below alongside the
  // rest of `agent.*`, not the trust-store-checked key identifier.
  if ((view.trust_state === "verified_issuer" || view.trust_state === "self_reported") && view.agent?.key_id) {
    verified.push({
      field: "issuer_key_id",
      value: view.agent.key_id,
      method: "signature verified and key_id found pinned in the trust store",
    });
  } else if (view.agent?.key_id) {
    self_reported.push({
      field: "issuer_key_id",
      value: view.agent.key_id,
      note: "not pinned in any trust store (or the mint used the public-dev HMAC key), so its real-world identity is unestablished",
    });
  }

  const hostBound = view.host_claim_binding === "verified_issuer";
  const agentFields: Array<[string, string | undefined]> = [
    ["agent.host", view.agent?.host],
    ["agent.provider", view.agent?.provider],
    ["agent.model", view.agent?.model],
    ["agent.runtime", view.agent?.runtime],
    ["agent.deployment", view.agent?.deployment],
  ];
  for (const [field, value] of agentFields) {
    if (!value) continue;
    if (hostBound) {
      verified.push({
        field,
        value,
        method: "bound by a verified issuer signature plus real agent-runtime evidence (see host_claim_binding)",
      });
    } else {
      self_reported.push({
        field,
        value,
        note: "environment-asserted at compile/mint time (e.g. SKILL_HOST) — trivially spoofable, not independently checkable",
      });
    }
  }

  if (opts.transparency?.ok) {
    if (opts.transparency.log_index) {
      verified.push({
        field: "transparency_log.log_index",
        value: opts.transparency.log_index,
        method: "Rekor inclusion proof and signature verified against the sigstore trusted root",
      });
    }
    if (opts.transparency.integrated_time) {
      verified.push({
        field: "transparency_log.integrated_time",
        value: opts.transparency.integrated_time,
        method: "the log's own integratedTime — not a self-claimed timestamp",
      });
    }
  }

  if (opts.keyless?.ok) {
    if (opts.keyless.owner_identity) {
      verified.push({
        field: "owner_identity",
        value: opts.keyless.owner_identity,
        method: "re-derived from the Fulcio certificate during this verification, after checking its chain to Fulcio's CA — never read from the package's own stored claim",
      });
    }
    if (opts.keyless.owner_issuer) {
      verified.push({
        field: "owner_issuer",
        value: opts.keyless.owner_issuer,
        method: "OIDC issuer extension read from the same verified Fulcio certificate",
      });
    }
  }

  return { verified, self_reported };
}
