/**
 * PHASE E2: assessClaims splits TrustView into two structurally separate
 * arrays — verified and self_reported — built from real mint/verify output,
 * not hand-typed fakes, so these tests exercise the same classification
 * logic real callers hit.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { compileSkillSource, approveCompilation } from "./compile.js";
import { mintSkillPackage } from "./mint.js";
import { createEd25519Signer } from "./signer.js";
import { inspectTrustView } from "./mint.js";
import { assessClaims } from "./claims.js";
import { PROTOCOL_VERSION, type SkillContract, type SkillSource } from "@skillerr/protocol";

function validContract(): SkillContract {
  return {
    kind: "skill_contract",
    contract_version: "0.5",
    skill_kind: "knowledge",
    title: "Claims unit test contract",
    intent: "A minimal complete contract for assessClaims coverage.",
    sensitivity: "private",
    triggers: { status: "specified", items: [{ id: "t1", description: "Always." }] },
    inputs: { status: "none", reason: "None." },
    preconditions: { status: "none", reason: "None." },
    steps: {
      status: "specified",
      items: [
        { id: "s1", title: "Say hi", kind: "instruct", instruction: "Say hi." },
        { id: "s2", title: "Emit", kind: "emit", output: "result", from: "s1" },
      ],
    },
    branches: { status: "none", reason: "None." },
    human_decisions: { status: "none", reason: "None." },
    capabilities: { status: "none", reason: "None." },
    permissions: { status: "none", reason: "None." },
    forbidden_actions: { status: "none", reason: "None." },
    outputs: {
      status: "specified",
      items: [{ name: "result", description: "Greeting", schema: { type: "string" }, required: true }],
    },
    recovery: { status: "not_applicable", reason: "No side effects." },
    verification: {
      status: "specified",
      items: [{ id: "v1", assertion: "A greeting was produced.", check: "human", required: true }],
    },
    corrections: { status: "none", reason: "None." },
    provenance: {
      evidence: { status: "none", reason: "None." },
      limitations: { status: "none", reason: "None." },
      human_review: { status: "reviewed", actor: "unit-test", at: "2026-07-13T00:00:00.000Z", scope: ["complete contract"] },
    },
  };
}

function buildApprovedFiles(idSuffix: string) {
  const contract = validContract();
  const source: SkillSource = {
    kind: "skill_source",
    id: `src_claims_${idSuffix}`,
    hash: "sha256:" + "d".repeat(64),
    title: contract.title,
    contract,
    sections: [],
    steering: [],
    prompts: [],
    code_refs: [],
    parents: [],
    agent: { host: "cursor" },
    journey: { summary: "assessClaims unit fixture.", redacted: true, sensitivity: "private" },
    inputs_declared: "none",
    sensitivity: "private",
    created_at: "2026-07-13T00:00:00.000Z",
    actor: { id: "test-agent" },
    source_protocol_version: PROTOCOL_VERSION,
  };
  const compiled = compileSkillSource(source, {
    profile: "release",
    approve_inferred_inputs: true,
    approve_permissions: true,
  });
  const approved = approveCompilation(compiled, { inputs: ["*"], permissions: true });
  approved.files.manifest.needs_human_review = false;
  return approved.files;
}

function findField<T extends { field: string }>(claims: T[], field: string): T | undefined {
  return claims.find((c) => c.field === field);
}

test("PHASE E2: assessClaims on a development (public-dev HMAC) mint — digests + signature verified, agent.host self-reported", () => {
  const files = buildApprovedFiles("dev");
  const sealed = mintSkillPackage(files, { host: "cursor" });
  const view = inspectTrustView(sealed.packageBytes);
  assert.equal(view.trust_state, "development");

  const claims = assessClaims(view);

  assert.ok(findField(claims.verified, "package_digest"), "package_digest must be verified");
  assert.ok(findField(claims.verified, "sealed_manifest_digest"), "sealed_manifest_digest must be verified");
  assert.ok(findField(claims.verified, "signature"), "signature must be verified (even if dev-only trust)");
  assert.equal(findField(claims.verified, "issuer_key_id"), undefined, "dev HMAC key is not trust-store-checked");
  assert.ok(findField(claims.self_reported, "issuer_key_id"), "the dev HMAC key_id itself is still reported, just not verified");

  const hostClaim = findField(claims.self_reported, "agent.host");
  assert.ok(hostClaim, "agent.host must be self-reported for a dev-HMAC mint");
  assert.equal(hostClaim!.value, "cursor");
  assert.equal(findField(claims.verified, "agent.host"), undefined, "agent.host must never also appear as verified");
});

test("PHASE E2: assessClaims on a verified_issuer mint — issuer AND agent.host both verified (real runtime evidence present)", () => {
  const files = buildApprovedFiles("verified");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const signer = createEd25519Signer(privateKey as unknown as string, "issuer-claims-2026");
  const sealed = mintSkillPackage(files, {
    host: "cursor",
    signer,
    host_claim_binding: "verified_issuer",
    agent_runtime_evidence: { session_id: "ses_test", markers: ["SKILL_AGENT_INVOCATION"] },
  });
  const trustStore = {
    version: 1 as const,
    keys: [{ key_id: "issuer-claims-2026", public_key_pem: publicKey as unknown as string, algorithm: "ed25519" as const }],
  };
  const view = inspectTrustView(sealed.packageBytes, { trust_store: trustStore });
  assert.equal(view.trust_state, "verified_issuer");

  const claims = assessClaims(view);

  const issuerClaim = findField(claims.verified, "issuer_key_id");
  assert.ok(issuerClaim, "issuer must be verified");
  assert.equal(issuerClaim!.value, "issuer-claims-2026");

  const hostClaim = findField(claims.verified, "agent.host");
  assert.ok(hostClaim, "agent.host must be verified when host_claim_binding=verified_issuer");
  assert.equal(hostClaim!.value, "cursor");
  assert.equal(findField(claims.self_reported, "agent.host"), undefined, "agent.host must not also appear as self-reported");
});

test("PHASE E2: assessClaims on a self_reported mint — issuer IS verified (key pinned + signature checked), but agent.host is not (no runtime evidence to bind it)", () => {
  const files = buildApprovedFiles("selfreported");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const signer = createEd25519Signer(privateKey as unknown as string, "issuer-selfreported-2026");
  // No host_claim_binding, no agent_runtime_evidence — the signature is
  // still real and the key is still pinned, but host claims aren't bound.
  const sealed = mintSkillPackage(files, { host: "cursor", signer });
  const trustStore = {
    version: 1 as const,
    keys: [{ key_id: "issuer-selfreported-2026", public_key_pem: publicKey as unknown as string, algorithm: "ed25519" as const }],
  };
  const view = inspectTrustView(sealed.packageBytes, { trust_store: trustStore });
  assert.equal(view.trust_state, "self_reported");

  const claims = assessClaims(view);

  const issuerClaim = findField(claims.verified, "issuer_key_id");
  assert.ok(issuerClaim, "issuer must still be verified — the key WAS found pinned and the signature DID verify");

  const hostClaim = findField(claims.self_reported, "agent.host");
  assert.ok(hostClaim, "agent.host must be self-reported — no runtime evidence bound it to the verified key");
  assert.equal(findField(claims.verified, "agent.host"), undefined);
});

test("PHASE E2: assessClaims includes transparency-log fields as verified only when the caller passes a successful verifyRekorAnchor result", () => {
  const files = buildApprovedFiles("tlog");
  const sealed = mintSkillPackage(files, { host: "cursor" });
  const view = inspectTrustView(sealed.packageBytes);

  const withoutAnchor = assessClaims(view);
  assert.equal(findField(withoutAnchor.verified, "transparency_log.log_index"), undefined);

  const withAnchor = assessClaims(view, {
    transparency: { ok: true, log_index: "12345", integrated_time: "1700000000" },
  });
  const logIndexClaim = findField(withAnchor.verified, "transparency_log.log_index");
  assert.ok(logIndexClaim);
  assert.equal(logIndexClaim!.value, "12345");
  assert.ok(findField(withAnchor.verified, "transparency_log.integrated_time"));

  const withFailedAnchor = assessClaims(view, { transparency: { ok: false, error: "digest mismatch" } });
  assert.equal(findField(withFailedAnchor.verified, "transparency_log.log_index"), undefined);
});

test("PHASE E2: assessClaims includes owner_identity as verified only when the caller passes a successful verifyKeylessAnchor result", () => {
  const files = buildApprovedFiles("keyless");
  const sealed = mintSkillPackage(files, { host: "cursor" });
  const view = inspectTrustView(sealed.packageBytes);

  const withoutKeyless = assessClaims(view);
  assert.equal(findField(withoutKeyless.verified, "owner_identity"), undefined);

  const withKeyless = assessClaims(view, {
    keyless: { ok: true, owner_identity: "https://github.com/org/repo/.github/workflows/x.yml@refs/heads/main", owner_issuer: "https://token.actions.githubusercontent.com" },
  });
  const identityClaim = findField(withKeyless.verified, "owner_identity");
  assert.ok(identityClaim);
  assert.equal(identityClaim!.value, "https://github.com/org/repo/.github/workflows/x.yml@refs/heads/main");
  assert.ok(findField(withKeyless.verified, "owner_issuer"));
});
