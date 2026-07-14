/**
 * Package-local unit tests for @skillerr/core's primitives, run directly
 * against this package (no dependency on @skillerr/cli). End-to-end
 * compile/mint/pack flows are covered by @skillerr/cli's conformance and
 * adversarial suites; this file targets the lower-level building blocks in
 * isolation (Tier 3: root npm test only ran @skillerr/cli).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { canonicalize, sha256Digest, sha256Hex, packageDigestFromContent } from "./hash.js";
import { normalizePath, assertSafePaths, UnsafePathError } from "./paths.js";
import { packSkill, unpackSkill } from "./pack.js";
import { mintSkillPackage, verifyMintTrust } from "./mint.js";
import { createEd25519Signer } from "./signer.js";
import { validatePackageBytes, inspectSkill } from "./validate.js";
import { compileSkillSource, approveCompilation } from "./compile.js";
import {
  DEFAULT_SKILL_POLICY,
  PROTOCOL_VERSION,
  type SkillContract,
  type SkillPackageFiles,
  type SkillSource,
} from "@skillerr/protocol";

test("canonicalize: object keys sort by UTF-16 code unit, not insertion order", () => {
  assert.equal(canonicalize({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalize({}), "{}");
  assert.equal(canonicalize([1, "two", null, true]), '[1,"two",null,true]');
});

test("canonicalize: rejects non-finite numbers", () => {
  assert.throws(() => canonicalize({ x: Infinity }), /finite/i);
  assert.throws(() => canonicalize({ x: NaN }), /finite/i);
});

test("sha256Digest / sha256Hex: stable, prefixed, hex-encoded", () => {
  const digest = sha256Digest("abc");
  assert.match(digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(digest, `sha256:${sha256Hex("abc")}`);
  assert.equal(sha256Digest("abc"), sha256Digest("abc"));
  assert.notEqual(sha256Digest("abc"), sha256Digest("abd"));
});

test("packageDigestFromContent: order-independent, excludes signatures/**", () => {
  const a = packageDigestFromContent([
    { path: "b.json", digest: "sha256:1" },
    { path: "a.json", digest: "sha256:2" },
  ]);
  const b = packageDigestFromContent([
    { path: "a.json", digest: "sha256:2" },
    { path: "b.json", digest: "sha256:1" },
  ]);
  assert.equal(a, b, "content order must not affect the digest");

  const withSig = packageDigestFromContent([
    { path: "a.json", digest: "sha256:2" },
    { path: "signatures/creation.dsse.json", digest: "sha256:ignored" },
  ]);
  const withoutSig = packageDigestFromContent([{ path: "a.json", digest: "sha256:2" }]);
  assert.equal(withSig, withoutSig, "signatures/** must not affect package_digest");
});

test("normalizePath: accepts safe relative paths, converts backslashes", () => {
  assert.equal(normalizePath("knowledge/a.json"), "knowledge/a.json");
  assert.equal(normalizePath("knowledge\\a.json"), "knowledge/a.json");
});

test("normalizePath: rejects each unsafe pattern with a distinct code", () => {
  const cases: Array<[string, string]> = [
    ["../evil.txt", "path_traversal"],
    ["/etc/passwd", "absolute_path"],
    ["C:/evil.txt", "windows_absolute_path"],
    ["a//b", "invalid_segment"],
    ["./a", "invalid_segment"],
    ["", "empty_path"],
  ];
  for (const [input, code] of cases) {
    assert.throws(
      () => normalizePath(input),
      (e: unknown) => e instanceof UnsafePathError && e.code === code,
      `expected code "${code}" for input ${JSON.stringify(input)}`,
    );
  }
});

test("assertSafePaths: rejects duplicate normalized paths", () => {
  assert.throws(
    () => assertSafePaths(["a.json", "a.json"]),
    (e: unknown) => e instanceof UnsafePathError && e.code === "duplicate_path",
  );
  assert.doesNotThrow(() => assertSafePaths(["a.json", "b.json"]));
});

function minimalPackage(): SkillPackageFiles {
  return {
    manifest: {
      kind: "dot-skill",
      id: "skl_unit",
      version: "1.0.0",
      title: "Unit test skill",
      description: "Minimal package for core unit tests",
      container_version: "1",
      protocol_version: "0.5.0",
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

test("pack/unpack: round-trips manifest, workflow, and knowledge unchanged", () => {
  const pkg = minimalPackage();
  pkg.knowledge = [
    {
      kind: "knowledge",
      id: "k1",
      type: "rule",
      title: "Rule",
      body: "Always be polite.",
      fidelity: "exact",
      pinned: true,
    },
  ];
  const bytes = packSkill(pkg);
  const unpacked = unpackSkill(bytes);
  assert.equal(unpacked.manifest.id, "skl_unit");
  assert.equal(unpacked.knowledge.length, 1);
  assert.equal(unpacked.knowledge[0]!.body, "Always be polite.");
  // manifest_digest (SEC-F) is computed at pack time and must self-verify.
  assert.ok(unpacked.manifest.manifest_digest);
});

test("pack/unpack: assets/ round-trips like resources/artifacts (Phase 6 icon slot, Phase 1 ingest asset mapping)", () => {
  const pkg = minimalPackage();
  pkg.assets = { "icon.svg": "<svg></svg>" };
  const bytes = packSkill(pkg);
  const unpacked = unpackSkill(bytes);
  assert.equal(new TextDecoder().decode(unpacked.raw.assets!["icon.svg"] as Uint8Array), "<svg></svg>");
  assert.ok(unpacked.manifest.content.some((c) => c.path === "assets/icon.svg"));
});

test("PROTO-7: a well-formed package validates clean against the JSON Schemas", () => {
  const pkg = minimalPackage();
  pkg.knowledge = [
    { kind: "knowledge", id: "k1", type: "rule", title: "Rule", body: "Be polite.", fidelity: "exact" },
  ];
  const validation = validatePackageBytes(packSkill(pkg));
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
  assert.ok(!validation.issues.some((i) => i.code.startsWith("schema_")));
});

test("PROTO-7: schema-check catches a wrong field type the hand-written checks alone don't", () => {
  const pkg = minimalPackage();
  // A number where the schema (and the real type) require a string. None of
  // validateManifestShape's hand-written checks type-check `version` at
  // all — they only check truthiness — so before PROTO-7 this passed
  // silently.
  (pkg.manifest as unknown as Record<string, unknown>).version = 42;
  const validation = validatePackageBytes(packSkill(pkg));
  assert.equal(validation.ok, false);
  assert.ok(
    validation.issues.some((i) => i.code === "schema_manifest" && i.message.includes("version")),
    JSON.stringify(validation.issues),
  );
});

test("PROTO-7: schema-check catches a knowledge item missing a required field", () => {
  const pkg = minimalPackage();
  pkg.knowledge = [
    // Missing `fidelity`, required by knowledge-item.schema.json.
    { kind: "knowledge", id: "k1", type: "rule", title: "Rule", body: "x" } as never,
  ];
  const validation = validatePackageBytes(packSkill(pkg));
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((i) => i.code === "schema_knowledge_item"));
});

function validContract(): SkillContract {
  return {
    kind: "skill_contract",
    contract_version: "0.5",
    skill_kind: "knowledge",
    title: "Unit test contract",
    intent: "A minimal complete contract for mint/verify unit coverage.",
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
      human_review: {
        status: "reviewed",
        actor: "unit-test",
        at: "2026-07-13T00:00:00.000Z",
        scope: ["complete contract"],
      },
    },
  };
}

test("mint/verify: a package minted with the public dev key verifies as development, never higher", () => {
  const contract = validContract();
  const source: SkillSource = {
    kind: "skill_source",
    id: "src_unit",
    hash: "sha256:" + "b".repeat(64),
    title: contract.title,
    contract,
    sections: [],
    steering: [],
    prompts: [],
    code_refs: [],
    parents: [],
    agent: { host: "cursor" },
    journey: { summary: "Unit test fixture.", redacted: true, sensitivity: "private" },
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

  const sealed = mintSkillPackage(approved.files, { host: "cursor" });
  assert.equal(sealed.files.manifest.mint?.mint_status, "minted");
  assert.equal(sealed.attestation.issuer_class, "public_dev_hmac");

  const trust = verifyMintTrust(sealed.packageBytes, "minted", {
    allow_development_issuer: true,
    allow_self_reported: true,
  });
  assert.equal(trust.ok, true, JSON.stringify(trust.issues));
  assert.equal(trust.trust_state, "development");

  // Without explicit opt-in, the public dev key must never pass as trusted.
  const strict = verifyMintTrust(sealed.packageBytes, "minted");
  assert.equal(strict.ok, false);
});

test("license: SkillSource.license/license_url flow through compile into the manifest and inspectSkill, self-reported like npm's package.json field", () => {
  const contract = validContract();
  const source: SkillSource = {
    kind: "skill_source",
    id: "src_license_unit",
    hash: "sha256:" + "e".repeat(64),
    title: contract.title,
    contract,
    sections: [],
    steering: [],
    prompts: [],
    code_refs: [],
    parents: [],
    agent: { host: "cursor" },
    journey: { summary: "License field unit fixture.", redacted: true, sensitivity: "private" },
    inputs_declared: "none",
    sensitivity: "private",
    created_at: "2026-07-13T00:00:00.000Z",
    actor: { id: "test-agent" },
    source_protocol_version: PROTOCOL_VERSION,
    license: "Apache-2.0",
    license_url: "https://example.test/terms",
  };
  const compiled = compileSkillSource(source, {
    profile: "release",
    approve_inferred_inputs: true,
    approve_permissions: true,
  });
  assert.equal(compiled.files.manifest.license, "Apache-2.0");
  assert.equal(compiled.files.manifest.license_url, "https://example.test/terms");

  const approved = approveCompilation(compiled, { inputs: ["*"], permissions: true });
  approved.files.manifest.needs_human_review = false;
  const sealed = mintSkillPackage(approved.files, { host: "cursor" });

  const inspected = inspectSkill(sealed.packageBytes);
  assert.equal(inspected.summary.license, "Apache-2.0");
  assert.equal(inspected.summary.license_url, "https://example.test/terms");

  // opts.license overrides source.license, same pattern as opts.title.
  const overridden = compileSkillSource(source, {
    profile: "release",
    approve_inferred_inputs: true,
    approve_permissions: true,
    license: "MIT",
  });
  assert.equal(overridden.files.manifest.license, "MIT");
});

function mintedEd25519Fixture(overrides?: { host?: string }) {
  const contract = validContract();
  const source: SkillSource = {
    kind: "skill_source",
    id: "src_ed25519_unit",
    hash: "sha256:" + "c".repeat(64),
    title: contract.title,
    contract,
    sections: [],
    steering: [],
    prompts: [],
    code_refs: [],
    parents: [],
    agent: { host: "cursor" },
    journey: { summary: "Ed25519 signer unit fixture.", redacted: true, sensitivity: "private" },
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

  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const signer = createEd25519Signer(privateKey as unknown as string, "issuer-2026");

  const sealed = mintSkillPackage(approved.files, {
    host: overrides?.host ?? "cursor",
    signer,
    host_claim_binding: "verified_issuer",
    agent_runtime_evidence: { session_id: "ses_test", markers: ["SKILL_AGENT_INVOCATION"] },
  });
  return { sealed, publicKeyPem: publicKey as unknown as string, keyId: "issuer-2026" };
}

test("PROTO-2: mint with a configured Ed25519 signer, verified against a matching trust-store key, is verified_issuer", () => {
  const { sealed, publicKeyPem, keyId } = mintedEd25519Fixture();
  assert.equal(sealed.attestation.issuer_class, "configured_ed25519");

  const trustStore = { version: 1 as const, keys: [{ key_id: keyId, public_key_pem: publicKeyPem, algorithm: "ed25519" as const }] };
  const trust = verifyMintTrust(sealed.packageBytes, "minted", { trust_store: trustStore });
  assert.equal(trust.ok, true, JSON.stringify(trust.issues));
  assert.equal(trust.trust_state, "verified_issuer");
});

test("PROTO-2: the same Ed25519-sealed package verified without that key in the trust store is untrusted, not silently downgraded-but-passing", () => {
  const { sealed } = mintedEd25519Fixture();
  const emptyStore = { version: 1 as const, keys: [] };
  const trust = verifyMintTrust(sealed.packageBytes, "minted", { trust_store: emptyStore });
  assert.equal(trust.ok, false);
  assert.equal(trust.trust_state, "untrusted");
  assert.ok(trust.issues.some((i) => i.code === "trust_store_key_not_found"));
});

test("PROTO-2: no trust_store passed at all refuses with trust_store_not_configured", () => {
  const { sealed } = mintedEd25519Fixture();
  const trust = verifyMintTrust(sealed.packageBytes, "minted", {});
  assert.equal(trust.ok, false);
  assert.ok(trust.issues.some((i) => i.code === "trust_store_not_configured"));
});

test("PROTO-2: an expired trust-store key refuses with trust_store_key_expired", () => {
  const { sealed, publicKeyPem, keyId } = mintedEd25519Fixture();
  const expiredStore = {
    version: 1 as const,
    keys: [
      {
        key_id: keyId,
        public_key_pem: publicKeyPem,
        algorithm: "ed25519" as const,
        not_after: "2020-01-01T00:00:00.000Z",
      },
    ],
  };
  const trust = verifyMintTrust(sealed.packageBytes, "minted", { trust_store: expiredStore });
  assert.equal(trust.ok, false);
  assert.ok(trust.issues.some((i) => i.code === "trust_store_key_expired"));
});

test("PROTO-2: a trust-store key not authorized for the attestation's host refuses with trust_store_host_not_allowed", () => {
  const { sealed, publicKeyPem, keyId } = mintedEd25519Fixture();
  const scopedStore = {
    version: 1 as const,
    keys: [
      { key_id: keyId, public_key_pem: publicKeyPem, algorithm: "ed25519" as const, allowed_hosts: ["claude-code"] },
    ],
  };
  const trust = verifyMintTrust(sealed.packageBytes, "minted", { trust_store: scopedStore });
  assert.equal(trust.ok, false);
  assert.ok(trust.issues.some((i) => i.code === "trust_store_host_not_allowed"));
});

test("PROTO-2: a corrupted Ed25519 signature byte refuses with attestation_sig_invalid, never crashes", () => {
  const { sealed, publicKeyPem, keyId } = mintedEd25519Fixture();
  const unpacked = unpackSkill(sealed.packageBytes);
  const dsse = unpacked.raw.signatures!["creation.dsse.json"] as { signatures: Array<{ sig: string; keyid?: string }> };
  const sig = dsse.signatures[0]!.sig;
  dsse.signatures[0]!.sig = sig.slice(0, -4) + (sig.slice(-4) === "AAAA" ? "BBBB" : "AAAA");
  const tampered = packSkill({ ...unpacked.raw, signatures: unpacked.raw.signatures });

  const trustStore = { version: 1 as const, keys: [{ key_id: keyId, public_key_pem: publicKeyPem, algorithm: "ed25519" as const }] };
  const trust = verifyMintTrust(tampered, "minted", { trust_store: trustStore });
  assert.equal(trust.ok, false);
  assert.ok(trust.issues.some((i) => i.code === "attestation_sig_invalid"));
});

test("PROTO-2: an Ed25519-configured signer key_id that isn't actually an Ed25519 key is rejected at signer construction, not silently accepted", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  assert.throws(() => createEd25519Signer(pem, "bad-key"), /not an Ed25519 private key/);
});
