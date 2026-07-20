/**
 * Unit + round-trip tests for the adapter layer in trust-spine.ts (see
 * spec/CONTRACT.md). Each adapter is tested against the same real
 * primitive it wraps — no new crypto/logic is introduced here, these tests
 * exist to prove the adapters faithfully expose that real behavior under
 * the frozen contract's shape.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { fileURLToPath } from "node:url";
import { TrustedRoot } from "@sigstore/protobuf-specs";
import type { Witness } from "@sigstore/sign";
import type { TransparencyLogEntry } from "@sigstore/bundle";
import {
  seal,
  openSealed,
  sign,
  verifySignature,
  RekorAnchor,
  capabilitiesFromPermission,
  evaluateReleaseProfile,
  verify,
  generateSBOM,
  type Commitment,
  type RevocationRecord,
} from "./trust-spine.js";
import { createEd25519Signer } from "./signer.js";
import { buildLeaf, generateInclusionProof, buildSignedTreeHead, type LogEvent } from "./merkle-log.js";
import type { AnchorSubject } from "./transparency.js";
import {
  DEFAULT_SKILL_POLICY,
  type SkillPackageFiles,
  type SkillPermission,
  type PermanenceAnchor,
} from "@skillerr/protocol";

function minimalPackage(): SkillPackageFiles {
  return {
    manifest: {
      kind: "dot-skill",
      id: "skl_trust_spine_unit",
      version: "1.0.0",
      title: "Trust spine unit test skill",
      description: "Minimal package for trust-spine.ts adapter tests",
      container_version: "1",
      protocol_version: "1.0.0",
      entrypoint: "s1",
      inputs: [],
      outputs: [],
      capabilities: [],
      permissions: [],
      policy: { ...DEFAULT_SKILL_POLICY },
      content: [],
      package_digest: "sha256:" + "0".repeat(64),
      provenance_mode: "proof_only",
    },
    workflow: {
      kind: "workflow",
      dialect_version: "1.1",
      entrypoint: "s1",
      steps: [{ id: "s1", kind: "emit", output: "result", from: "s1" }],
    },
    knowledge: [],
  };
}

// ---------------------------------------------------------------------------
// seal / openSealed
// ---------------------------------------------------------------------------

test("seal/openSealed: round-trips a package, digest matches the embedded manifest's package_digest", async () => {
  const pkg = minimalPackage();
  const sealed = await seal(pkg);
  assert.ok(Buffer.isBuffer(sealed.zip));
  assert.equal(sealed.digest, sealed.manifest.package_digest);
  assert.match(sealed.digest, /^sha256:[a-f0-9]{64}$/);

  const opened = await openSealed(sealed.zip);
  assert.deepEqual(opened.manifest, sealed.manifest);
  assert.equal(opened.digest, sealed.digest);
  assert.ok(opened.files["skill.json"]);
});

test("seal: same input seals to a byte-identical zip and digest twice (determinism)", async () => {
  const pkg = minimalPackage();
  const a = await seal(pkg);
  const b = await seal(pkg);
  assert.equal(a.digest, b.digest);
  assert.deepEqual(a.zip, b.zip);
});

// ---------------------------------------------------------------------------
// sign / verifySignature
// ---------------------------------------------------------------------------

test("sign/verifySignature: a real Ed25519 signature verifies against the digest it signed", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const digest = "sha256:" + "a".repeat(64);
  const sig = await sign(digest, {
    privateKeyPem: privateKey as unknown as string,
    keyId: "test-key",
    publicKeyPem: publicKey as unknown as string,
  });
  assert.equal(sig.sig_alg, "ed25519-v1");
  assert.equal(sig.key_id, "test-key");
  assert.equal(await verifySignature(digest, sig), true);
});

test("verifySignature: rejects a signature over a different digest", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const sig = await sign("sha256:" + "a".repeat(64), {
    privateKeyPem: privateKey as unknown as string,
    keyId: "test-key",
    publicKeyPem: publicKey as unknown as string,
  });
  assert.equal(await verifySignature("sha256:" + "b".repeat(64), sig), false);
});

test("verifySignature: rejects a signature checked against the wrong public key", async () => {
  const a = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const b = generateKeyPairSync("ed25519", { publicKeyEncoding: { type: "spki", format: "pem" } });
  const digest = "sha256:" + "c".repeat(64);
  const sig = await sign(digest, {
    privateKeyPem: a.privateKey as unknown as string,
    keyId: "test-key",
    publicKeyPem: a.publicKey as unknown as string,
  });
  const tampered = { ...sig, public_key_pem: b.publicKey as unknown as string };
  assert.equal(await verifySignature(digest, tampered), false);
});

// ---------------------------------------------------------------------------
// Anchor / RekorAnchor
// ---------------------------------------------------------------------------

function stubWitness(entry: Partial<TransparencyLogEntry> = {}): Witness {
  return {
    async testify() {
      return {
        tlogEntries: [
          {
            logIndex: "42",
            integratedTime: "1700000000",
            logId: { keyId: Buffer.from("stub-log-id") },
            kindVersion: { kind: "dsse", version: "0.0.1" },
            canonicalizedBody: Buffer.from("{}"),
            ...entry,
          } as TransparencyLogEntry,
        ],
      };
    },
  };
}

const testSubject: AnchorSubject = {
  skill_id: "skl_trust_spine_anchor",
  skill_version: "1.0.0",
  package_digest: "sha256:" + "1".repeat(64),
  issuer_class: "configured_ed25519",
};

test("RekorAnchor.anchor: builds a Commitment from a stub witness response, no live network call", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const anchor = RekorAnchor({
    issuerSigner: createEd25519Signer(privateKey as unknown as string, "test-key"),
    publicKeyPem: publicKey as unknown as string,
    subject: testSubject,
    options: { witness: stubWitness() },
  });
  const commitment = await anchor.anchor(testSubject.package_digest);
  assert.equal(commitment.log_index, "42");
  assert.equal(commitment.anchor.kind, "transparency_log");
});

// RekorAnchor.verify's positive path needs a REAL captured Rekor bundle —
// a synthetic stub witness can't satisfy the actual cryptographic
// inclusion-proof verification anchorToRekor's counterpart runs (same
// reason transparency.test.ts's own verifyRekorAnchor tests use a captured
// fixture instead of a stub, see that file's header comment). Reuses the
// exact same RFC 0007 (subject-bearing) fixture.
const statementFixturePath = fileURLToPath(
  new URL("../../../fixtures/transparency/rekor-anchor-statement.json", import.meta.url),
);
const statementFixture = JSON.parse(readFileSync(statementFixturePath, "utf8")) as {
  digest: string;
  subject: AnchorSubject;
  publicKeyPem: string;
  keyId: string;
  anchor: Omit<PermanenceAnchor, "package_digest">;
  trustedRootJSON: unknown;
};
const statementTrustedRoot = TrustedRoot.fromJSON(statementFixture.trustedRootJSON);

test("RekorAnchor.verify: a real captured anchor verifies true against a matching digest", async () => {
  const commitment: Commitment = { anchor: statementFixture.anchor, log_index: "captured" };
  const anchor = RekorAnchor({
    issuerSigner: createEd25519Signer(
      // signer is unused by verify() (verify only needs the public key), a
      // throwaway key satisfies the required IssuerSigner shape.
      generateKeyPairSync("ed25519", { privateKeyEncoding: { type: "pkcs8", format: "pem" } }).privateKey as unknown as string,
      statementFixture.keyId,
    ),
    publicKeyPem: statementFixture.publicKeyPem,
    subject: statementFixture.subject,
    verifyOptions: { trustedRoot: statementTrustedRoot },
  });
  assert.equal(await anchor.verify(statementFixture.digest, commitment), true);
});

test("RekorAnchor.verify: rejects when the digest doesn't match what was actually anchored", async () => {
  const commitment: Commitment = { anchor: statementFixture.anchor, log_index: "captured" };
  const anchor = RekorAnchor({
    issuerSigner: createEd25519Signer(
      generateKeyPairSync("ed25519", { privateKeyEncoding: { type: "pkcs8", format: "pem" } }).privateKey as unknown as string,
      statementFixture.keyId,
    ),
    publicKeyPem: statementFixture.publicKeyPem,
    subject: statementFixture.subject,
    verifyOptions: { trustedRoot: statementTrustedRoot },
  });
  assert.equal(await anchor.verify("sha256:" + "0".repeat(64), commitment), false);
});

// ---------------------------------------------------------------------------
// capabilitiesFromPermission
// ---------------------------------------------------------------------------

test("capabilitiesFromPermission: read/write/destructive map to fs, network maps to net, exec maps to shell (empty scope)", () => {
  const fsPerm: SkillPermission = {
    side_effect_class: "write",
    description: "writes files",
    paths: ["/tmp/out"],
    requires_consent: false,
  };
  assert.deepEqual(capabilitiesFromPermission(fsPerm), [{ kind: "fs", scope: ["/tmp/out"] }]);

  const netPerm: SkillPermission = {
    side_effect_class: "network",
    description: "calls an API",
    hosts: ["api.example.com"],
    requires_consent: false,
  };
  assert.deepEqual(capabilitiesFromPermission(netPerm), [{ kind: "net", scope: ["api.example.com"] }]);

  const execPerm: SkillPermission = {
    side_effect_class: "exec",
    description: "runs a script",
    requires_consent: true,
  };
  assert.deepEqual(capabilitiesFromPermission(execPerm), [{ kind: "shell", scope: [] }]);
});

test("capabilitiesFromPermission: none/read with no declared paths produces no capability", () => {
  assert.deepEqual(
    capabilitiesFromPermission({ side_effect_class: "none", description: "no-op", requires_consent: false }),
    [],
  );
  assert.deepEqual(
    capabilitiesFromPermission({ side_effect_class: "read", description: "reads nothing declared", requires_consent: false }),
    [],
  );
});

// ---------------------------------------------------------------------------
// evaluateReleaseProfile
// ---------------------------------------------------------------------------

test("evaluateReleaseProfile: continuity profile only cares about completeness", () => {
  const pkg = minimalPackage();
  pkg.manifest.completeness = {
    kind: "completeness_report",
    profile: "continuity",
    complete: true,
    present: [],
    missing: [],
    hints: [],
  };
  assert.deepEqual(evaluateReleaseProfile(pkg, "continuity"), { pass: true, reasons: [] });

  pkg.manifest.completeness.complete = false;
  pkg.manifest.completeness.missing = ["journey"];
  const result = evaluateReleaseProfile(pkg, "continuity");
  assert.equal(result.pass, false);
  assert.match(result.reasons[0]!, /incomplete: missing journey/);
});

function releaseReadyPackage(): SkillPackageFiles {
  const pkg = minimalPackage();
  pkg.manifest.compile_profile = "release";
  pkg.manifest.needs_human_review = false;
  pkg.manifest.completeness = {
    kind: "completeness_report",
    profile: "release",
    complete: true,
    present: [],
    missing: [],
    hints: [],
  };
  pkg.manifest.inputs = [];
  pkg.provenance = {
    source: { agent: { host: "cursor" } },
    compilation_report: {
      kind: "compilation_report",
      skill_id: pkg.manifest.id,
      profile: "release",
      created_at: "2026-01-01T00:00:00.000Z",
      mappings: [],
      inferred_inputs: [],
      issues: [],
      pending_approvals: [],
      approved: true,
      completeness: pkg.manifest.completeness,
      semantic_contract: "native_0.5",
    },
  };
  return pkg;
}

test("evaluateReleaseProfile: a fully-ready release package passes with no reasons", () => {
  assert.deepEqual(evaluateReleaseProfile(releaseReadyPackage(), "release"), { pass: true, reasons: [] });
});

test("evaluateReleaseProfile: release rejects an invalid/missing agent host", () => {
  const pkg = releaseReadyPackage();
  pkg.provenance!.source = { agent: { host: "human" } };
  const result = evaluateReleaseProfile(pkg, "release");
  assert.equal(result.pass, false);
  assert.ok(result.reasons.some((r) => /valid AI agent host/.test(r)));
});

test("evaluateReleaseProfile: release rejects needs_human_review", () => {
  const pkg = releaseReadyPackage();
  pkg.manifest.needs_human_review = true;
  const result = evaluateReleaseProfile(pkg, "release");
  assert.equal(result.pass, false);
  assert.ok(result.reasons.some((r) => /needs_human_review/.test(r)));
});

test("evaluateReleaseProfile: release rejects a non-release compile_profile", () => {
  const pkg = releaseReadyPackage();
  pkg.manifest.compile_profile = "continuity";
  const result = evaluateReleaseProfile(pkg, "release");
  assert.equal(result.pass, false);
  assert.ok(result.reasons.some((r) => /compile_profile must be release/.test(r)));
});

test("evaluateReleaseProfile: release rejects a missing/unapproved compilation report", () => {
  const pkg = releaseReadyPackage();
  pkg.provenance!.compilation_report!.approved = false;
  const result = evaluateReleaseProfile(pkg, "release");
  assert.equal(result.pass, false);
  assert.ok(result.reasons.some((r) => /approved release compilation report/.test(r)));
});

test("evaluateReleaseProfile: release rejects unapproved required inputs", () => {
  const pkg = releaseReadyPackage();
  pkg.manifest.inputs = [
    {
      name: "api_key",
      schema: { type: "string" },
      description: "An API key",
      source: "human",
      required: true,
      sensitivity: "secret",
      ask_when: "always",
      approved: false,
    },
  ];
  const result = evaluateReleaseProfile(pkg, "release");
  assert.equal(result.pass, false);
  assert.ok(result.reasons.some((r) => /unapproved required inputs: api_key/.test(r)));
});

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

test("verify: no evidence at all is honestly unverified, not defaulted to trusted", async () => {
  const result = await verify("sha256:" + "a".repeat(64));
  assert.equal(result.verified, false);
  assert.equal(result.anchored, false);
  assert.equal(result.revoked, false);
  assert.ok(result.reasons.some((r) => /No evidence supplied/.test(r)));
});

test("verify: a valid signature alone is sufficient to verify", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const digest = "sha256:" + "b".repeat(64);
  const signature = await sign(digest, {
    privateKeyPem: privateKey as unknown as string,
    keyId: "k1",
    publicKeyPem: publicKey as unknown as string,
  });
  const result = await verify(digest, { signature });
  assert.equal(result.verified, true);
  assert.ok(result.reasons.includes("Signature verified"));
});

test("verify: an invalid signature fails verification", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const digest = "sha256:" + "c".repeat(64);
  const signature = await sign(digest, {
    privateKeyPem: privateKey as unknown as string,
    keyId: "k1",
    publicKeyPem: publicKey as unknown as string,
  });
  const result = await verify("sha256:" + "d".repeat(64), { signature });
  assert.equal(result.verified, false);
  assert.ok(result.reasons.some((r) => /Signature verification failed/.test(r)));
});

function buildTestInclusionEvidence(digest: string) {
  const event: LogEvent = { kind: "publish", digest, timestamp: "2026-01-01T00:00:00.000Z" };
  const leaves = [buildLeaf(event), buildLeaf({ ...event, kind: "install" }), buildLeaf({ ...event, kind: "revoke" })];
  const hashes = leaves.map((l) => l.hash);
  const treeHead = buildSignedTreeHead(hashes);
  const inclusionProof = generateInclusionProof(hashes, 0);
  return { leaf: leaves[0]!, inclusionProof, treeHead };
}

test("verify: a valid inclusion proof alone is sufficient to verify", async () => {
  const digest = "sha256:" + "e".repeat(64);
  const { leaf, inclusionProof, treeHead } = buildTestInclusionEvidence(digest);
  const result = await verify(digest, { leaf, inclusionProof, treeHead });
  assert.equal(result.verified, true);
  assert.ok(result.reasons.some((r) => /Inclusion proof verified/.test(r)));
});

test("verify: a tampered inclusion proof fails verification", async () => {
  const digest = "sha256:" + "f".repeat(64);
  const { leaf, inclusionProof, treeHead } = buildTestInclusionEvidence(digest);
  const tampered = { ...inclusionProof, hashes: [...inclusionProof.hashes] };
  tampered.hashes[0] = "sha256:" + "0".repeat(64);
  const result = await verify(digest, { leaf, inclusionProof: tampered, treeHead });
  assert.equal(result.verified, false);
  assert.ok(result.reasons.some((r) => /Inclusion proof failed/.test(r)));
});

test("verify: anchored=true from the caller is sufficient to verify and is reported back", async () => {
  const result = await verify("sha256:" + "1".repeat(64), { anchored: true });
  assert.equal(result.verified, true);
  assert.equal(result.anchored, true);
  assert.ok(result.reasons.includes("Anchor commitment verified"));
});

test("verify: anchored=false from the caller fails verification", async () => {
  const result = await verify("sha256:" + "2".repeat(64), { anchored: false });
  assert.equal(result.verified, false);
  assert.equal(result.anchored, false);
  assert.ok(result.reasons.some((r) => /Anchor commitment failed/.test(r)));
});

test("verify: a matching revocation record marks revoked and fails verification even with a valid signature", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const digest = "sha256:" + "3".repeat(64);
  const signature = await sign(digest, {
    privateKeyPem: privateKey as unknown as string,
    keyId: "k1",
    publicKeyPem: publicKey as unknown as string,
  });
  const revocation: RevocationRecord = {
    kind: "revocation_record",
    package_digest: digest,
    reason: "security",
    detail: "Leaked credential in an example",
    revoked_at: "2026-01-01T00:00:00.000Z",
    issuer_key_id: "dot-skill-org-2026",
  };
  const result = await verify(digest, { signature, revocation });
  assert.equal(result.verified, false, "revocation must not be outweighed by a valid signature");
  assert.equal(result.revoked, true);
  assert.ok(result.reasons.some((r) => /Digest revoked: security/.test(r)));
});

test("verify: a revocation record for a different digest is ignored, not honored", async () => {
  const digest = "sha256:" + "4".repeat(64);
  const revocation: RevocationRecord = {
    kind: "revocation_record",
    package_digest: "sha256:" + "9".repeat(64),
    reason: "security",
    revoked_at: "2026-01-01T00:00:00.000Z",
    issuer_key_id: "dot-skill-org-2026",
  };
  const result = await verify(digest, { revocation, anchored: true });
  assert.equal(result.revoked, false);
  assert.equal(result.verified, true, "unrelated revocation record must not affect this digest's verdict");
  assert.ok(result.reasons.some((r) => /different digest — ignored/.test(r)));
});

test("verify: one failing piece of evidence fails the whole verdict even when other evidence passes", async () => {
  const digest = "sha256:" + "5".repeat(64);
  const { leaf, inclusionProof, treeHead } = buildTestInclusionEvidence(digest);
  const result = await verify(digest, { leaf, inclusionProof, treeHead, anchored: false });
  assert.equal(result.verified, false, "a bad anchor check must not be outweighed by a good inclusion proof");
  assert.ok(result.reasons.some((r) => /Inclusion proof verified/.test(r)));
  assert.ok(result.reasons.some((r) => /Anchor commitment failed/.test(r)));
});

// ---------------------------------------------------------------------------
// generateSBOM
// ---------------------------------------------------------------------------

test("generateSBOM: root component matches the manifest, no dependencies means an empty components array", () => {
  const pkg = minimalPackage();
  pkg.manifest.id = "skl_sbom_unit";
  pkg.manifest.version = "2.1.0";
  pkg.manifest.package_digest = "sha256:" + "a1".repeat(32);
  const sbom = generateSBOM(pkg);

  assert.equal(sbom.bomFormat, "CycloneDX");
  assert.equal(sbom.specVersion, "1.5");
  assert.equal(sbom.version, 1);
  assert.match(sbom.serialNumber, /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(sbom.metadata.component.type, "application");
  assert.equal(sbom.metadata.component.name, "skl_sbom_unit");
  assert.equal(sbom.metadata.component.version, "2.1.0");
  assert.deepEqual(sbom.metadata.component.hashes, [{ alg: "SHA-256", content: "a1".repeat(32) }]);
  assert.deepEqual(sbom.components, []);
  assert.equal(sbom.metadata.timestamp, undefined, "no timestamp unless explicitly passed");
});

test("generateSBOM: declared dependencies become components, digest-pinned when known", () => {
  const pkg = minimalPackage();
  pkg.manifest.dependencies = [
    { skill_id: "skl_dep_one", version: "1.0.0", package_digest: "sha256:" + "b2".repeat(32) },
    { skill_id: "skl_dep_two", version: "3.0.0" },
  ];
  const sbom = generateSBOM(pkg);
  assert.equal(sbom.components.length, 2);
  assert.equal(sbom.components[0]!.name, "skl_dep_one");
  assert.deepEqual(sbom.components[0]!.hashes, [{ alg: "SHA-256", content: "b2".repeat(32) }]);
  assert.equal(sbom.components[1]!.name, "skl_dep_two");
  assert.equal(sbom.components[1]!.hashes, undefined, "no digest known for this dependency, so no fabricated hash");
});

test("generateSBOM: deterministic — the same package produces a byte-identical SBOM every time", () => {
  const pkg = minimalPackage();
  pkg.manifest.dependencies = [{ skill_id: "skl_dep", version: "1.0.0", package_digest: "sha256:" + "c3".repeat(32) }];
  const a = generateSBOM(pkg);
  const b = generateSBOM(pkg);
  assert.deepEqual(a, b);
});

test("generateSBOM: an explicit timestamp is passed through verbatim, never inferred from wall clock", () => {
  const sbom = generateSBOM(minimalPackage(), { timestamp: "2026-01-01T00:00:00.000Z" });
  assert.equal(sbom.metadata.timestamp, "2026-01-01T00:00:00.000Z");
});
