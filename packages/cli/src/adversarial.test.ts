/**
 * SEC-L: adversarial fixtures corpus.
 *
 * Every hostile input here must be refused with a distinct, machine-readable
 * error/issue code — never a crash, never a silent accept. This is also the
 * corpus a second independent implementation (Go/Rust/…) should reproduce
 * before this protocol is called Stable — see docs/ROADMAP.md.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { strToU8, zipSync } from "fflate";
import { generateKeyPairSync } from "node:crypto";
import {
  approveCompilation,
  compileSkillSource,
  mintSkillPackage,
  PUBLIC_DEV_MINT_KEY,
  packSkill,
  unpackSkill,
  UnsafePathError,
  UnsafeZipError,
  validatePackageBytes,
  createEd25519Signer,
} from "@skillerr/core";
import { inspectTrustView, verifyMintTrust } from "@skillerr/core";
import {
  anchorToRekor,
  verifyRekorAnchor,
  buildAnchorStatement,
  assertAnchorStatementPrivacy,
  type AnchorSubject,
} from "@skillerr/core";
import { runSkillArchive } from "@skillerr/runtime";
import {
  CONTAINER_VERSION,
  DEFAULT_SKILL_POLICY,
  PROTOCOL_VERSION,
  WORKFLOW_DIALECT_VERSION,
  type SkillContract,
  type SkillSource,
} from "@skillerr/protocol";

function validContract(): SkillContract {
  return {
    kind: "skill_contract",
    contract_version: "1.0",
    skill_kind: "knowledge",
    title: "Adversarial fixture",
    intent: "A minimal complete contract used as the base for tampering fixtures.",
    sensitivity: "private",
    triggers: { status: "specified", items: [{ id: "t1", description: "Always." }] },
    inputs: { status: "none", reason: "No inputs needed." },
    preconditions: { status: "none", reason: "None." },
    steps: {
      status: "specified",
      items: [
        { id: "s1", title: "Say hello", kind: "instruct", instruction: "Say hello." },
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
        actor: "fixture-author",
        at: "2026-07-13T00:00:00.000Z",
        scope: ["complete contract"],
      },
    },
  };
}

function validSource(): SkillSource {
  const contract = validContract();
  return {
    kind: "skill_source",
    id: "src_adversarial",
    hash: "sha256:" + "a".repeat(64),
    title: contract.title,
    contract,
    sections: [
      {
        id: "sec1",
        revision: 1,
        type: "doc",
        title: "Note",
        body: "Plain knowledge body for tampering fixtures.",
        attachments: [],
        code_refs: [],
        sensitivity: "shareable_redacted",
        authored_by: "agent",
      },
    ],
    steering: [],
    prompts: [],
    code_refs: [],
    parents: [],
    agent: { host: "cursor" },
    journey: { summary: "Adversarial fixture source.", redacted: true, sensitivity: "private" },
    inputs_declared: "none",
    sensitivity: "private",
    created_at: "2026-07-13T00:00:00.000Z",
    actor: { id: "test-agent" },
    source_protocol_version: PROTOCOL_VERSION,
  };
}

function validPackageBytes(): Uint8Array {
  const compiled = compileSkillSource(validSource(), {
    profile: "release",
    approve_inferred_inputs: true,
    approve_permissions: true,
  });
  return compiled.packageBytes;
}

function rawStoredZip(entries: Array<{ name: string; data: string }>): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const { name, data } of entries) {
    const nameBytes = strToU8(name);
    const dataBytes = strToU8(data);
    const header = new Uint8Array(30);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint32(14, 0, true);
    view.setUint32(18, dataBytes.length, true);
    view.setUint32(22, dataBytes.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    parts.push(header, nameBytes, dataBytes);
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

test("adversarial: ../ traversal entry -> path_traversal", () => {
  const archive = rawStoredZip([{ name: "resources/../../etc/passwd", data: "x" }]);
  assert.throws(
    () => unpackSkill(archive),
    (e: unknown) => e instanceof UnsafePathError && e.code === "path_traversal",
  );
});

test("adversarial: C:/ absolute entry -> windows_absolute_path", () => {
  const archive = rawStoredZip([{ name: "C:/evil.txt", data: "x" }]);
  assert.throws(
    () => unpackSkill(archive),
    (e: unknown) => e instanceof UnsafePathError && e.code === "windows_absolute_path",
  );
});

test("adversarial: symlink-style entry content is inert (no real filesystem extraction exists to escape)", () => {
  // Local zip file headers carry no Unix mode/symlink bit (that lives only
  // in the central directory, which this reader intentionally never
  // parses — see SEC-D). A "symlink entry" attack's actual danger is
  // entirely in what NAME it would be extracted to; that's covered by the
  // same path_traversal/absolute_path checks above regardless of what the
  // entry's bytes contain. unpackSkill never writes real files or follows
  // any path found in entry content, so a symlink-target-shaped byte
  // string is just opaque data here. Residual risk: if a future host adds
  // real filesystem extraction (e.g. Phase 4's bundled-script execution),
  // it must independently validate against symlink escapes at that point.
  const archive = rawStoredZip([
    { name: "skill.json", data: '{"kind":"dot-skill"}' },
    { name: "workflow.json", data: '{"kind":"workflow"}' },
    { name: "resources/link.txt", data: "../../../etc/passwd" },
  ]);
  const { files } = unpackSkill(archive);
  assert.equal(new TextDecoder().decode(files["resources/link.txt"]), "../../../etc/passwd");
});

test("adversarial: zip bomb (extreme compression ratio) -> suspicious_compression_ratio", () => {
  const bomb = packSkill({
    manifest: {
      kind: "dot-skill",
      id: "skl_bomb",
      version: "1.0.0",
      title: "bomb",
      description: "bomb",
      container_version: CONTAINER_VERSION,
      protocol_version: PROTOCOL_VERSION,
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
      dialect_version: WORKFLOW_DIALECT_VERSION,
      entrypoint: "s1",
      steps: [{ id: "s1", kind: "instruct", text: "x" }],
    },
    knowledge: [],
    resources: { "bomb.txt": "0".repeat(4_000_000) },
  });
  assert.throws(
    () => unpackSkill(bomb),
    (e: unknown) => e instanceof UnsafeZipError && e.code === "suspicious_compression_ratio",
  );
});

test("adversarial: duplicate skill.json entries -> duplicate_entry", () => {
  const archive = rawStoredZip([
    { name: "skill.json", data: '{"id":"looks-benign"}' },
    { name: "skill.json", data: '{"id":"actually-used"}' },
  ]);
  assert.throws(
    () => unpackSkill(archive),
    (e: unknown) => e instanceof UnsafeZipError && e.code === "duplicate_entry",
  );
});

test("adversarial: tampered knowledge content digest -> digest_mismatch", () => {
  const { files } = unpackSkill(validPackageBytes());
  const knowledgePath = Object.keys(files).find((p) => p.startsWith("knowledge/"))!;
  const tampered = zipSync({
    ...files,
    [knowledgePath]: strToU8('{"kind":"knowledge","id":"k_tampered","title":"h4x","body":"h4x"}'),
  });
  const validation = validatePackageBytes(tampered);
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((i) => i.code === "digest_mismatch"));
});

test("adversarial: tampered manifest capabilities -> manifest_digest_mismatch", () => {
  const { files } = unpackSkill(validPackageBytes());
  const manifest = JSON.parse(new TextDecoder().decode(files["skill.json"]!)) as Record<
    string,
    unknown
  >;
  manifest.capabilities = [
    {
      name: "exec.shell",
      description: "Run arbitrary shell commands",
      side_effect_class: "exec",
      fallback: "ask_human",
      required: true,
    },
  ];
  const tampered = zipSync({ ...files, "skill.json": strToU8(JSON.stringify(manifest)) });
  const validation = validatePackageBytes(tampered);
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((i) => i.code === "manifest_digest_mismatch"));
});

test("adversarial: stripped issuer_class -> missing_issuer_class", () => {
  const compiled = compileSkillSource(validSource(), {
    profile: "release",
    approve_inferred_inputs: true,
    approve_permissions: true,
  });
  const approved = approveCompilation(compiled, { inputs: ["*"], permissions: true });
  approved.files.manifest.needs_human_review = false;
  const { packageBytes } = mintSkillPackage(approved.files, { host: "cursor" });

  const { raw } = unpackSkill(packageBytes);
  const dsse = raw.signatures!["creation.dsse.json"] as { attestation: Record<string, unknown> };
  delete dsse.attestation.issuer_class;
  const tampered = packSkill({ ...raw, signatures: raw.signatures });

  const trust = verifyMintTrust(tampered, "minted", {
    allow_development_issuer: true,
    allow_self_reported: true,
  });
  assert.equal(trust.ok, false);
  assert.ok(trust.issues.some((i) => i.code === "missing_issuer_class"));
});

test("adversarial: dev-HMAC-minted package (trust_state=development) still refuses execute without --allow-untrusted", async () => {
  const compiled = compileSkillSource(validSource(), {
    profile: "release",
    approve_inferred_inputs: true,
    approve_permissions: true,
  });
  const approved = approveCompilation(compiled, { inputs: ["*"], permissions: true });
  approved.files.manifest.needs_human_review = false;
  const { packageBytes } = mintSkillPackage(approved.files, { host: "cursor" });

  // Confirm this fixture actually exercises trust_state=development, not
  // merely "unsigned" — public_dev_hmac is forgeable by anyone, so
  // execute must treat it identically to untrusted.
  const trustView = inspectTrustView(packageBytes);
  assert.equal(trustView.trust_state, "development");

  const refused = await runSkillArchive(packageBytes, { host: "test" }, { mode: "execute" });
  assert.equal(refused.status, "failed");
  assert.match(refused.error ?? "", /Refusing execute/);

  const allowed = await runSkillArchive(
    packageBytes,
    { host: "test", consent: async () => ({ allowed: true, actor: "t", at: new Date().toISOString() }) },
    { mode: "execute", allow_untrusted: true },
  );
  assert.doesNotMatch(allowed.error ?? "", /Refusing execute/);
});

test("adversarial: Ed25519-sealed package (issuer_class=configured_ed25519) presenting to a verifier with no matching trust-store pin is untrusted, not silently accepted", () => {
  // Complements the HMAC dev-key case above: a *correctly formed, real*
  // asymmetric seal is still worthless to a verifier who never pinned that
  // specific key — see PROTO-2 / RFC 0001 and the wiki's Key Ceremony page. This is
  // a distinct threat from a forged signature (attestation_sig_invalid,
  // covered in packages/core/src/core.test.ts): here the signature is
  // perfectly valid, the verifier just has no reason to trust it yet.
  const compiled = compileSkillSource(validSource(), {
    profile: "release",
    approve_inferred_inputs: true,
    approve_permissions: true,
  });
  const approved = approveCompilation(compiled, { inputs: ["*"], permissions: true });
  approved.files.manifest.needs_human_review = false;

  const { privateKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const signer = createEd25519Signer(privateKey as unknown as string, "untrusted-key-2026");
  const { packageBytes } = mintSkillPackage(approved.files, {
    host: "cursor",
    signer,
    host_claim_binding: "verified_issuer",
    agent_runtime_evidence: { session_id: "ses_adversarial" },
  });

  const noPin = verifyMintTrust(packageBytes, "minted", { trust_store: { version: 1, keys: [] } });
  assert.equal(noPin.ok, false);
  assert.equal(noPin.trust_state, "untrusted");
  assert.ok(noPin.issues.some((i) => i.code === "trust_store_key_not_found"));

  const inspected = inspectTrustView(packageBytes, { trust_store: { version: 1, keys: [] } });
  assert.equal(inspected.trust_state, "untrusted");
});

// --- RFC 0007: subject-bearing transparency anchor ------------------------
//
// The "legacy bare-digest anchor still verifies" case (also required by
// this suite's brief) is covered in packages/core/src/transparency.test.ts
// against a REAL captured Rekor bundle and a captured trusted-root snapshot.
// Reproducing that here would need importing @sigstore/protobuf-specs,
// which isn't a declared @skillerr/cli dependency. The four cases below
// only exercise checkAnchorPayload's pre-crypto short-circuit (see
// transparency.ts), so a minimal, undeclared-dependency-free witness stub
// is enough, no trusted-root fixture needed.

/** Matches @sigstore/sign's `Witness` shape structurally, without importing
 * its exact internal types (@sigstore/sign/@sigstore/bundle aren't declared
 * @skillerr/cli dependencies, @skillerr/core owns them). The `as any` at
 * each call site below is a test-only stub of external library internals,
 * not app code. Includes a full inclusionProof: bundleFromJSON (called
 * inside verifyRekorAnchor) structurally requires one to accept a v0.3
 * bundle at all, checked before any of the app-level checks below run. */
const adversarialStubWitness = {
  async testify() {
    return {
      tlogEntries: [
        {
          logIndex: "42",
          integratedTime: "1700000000",
          logId: { keyId: Buffer.from("stub-log-id") },
          kindVersion: { kind: "dsse", version: "0.0.1" },
          canonicalizedBody: Buffer.from("{}"),
          inclusionProof: {
            logIndex: "42",
            rootHash: Buffer.from("stub-root-hash"),
            treeSize: "1",
            hashes: [],
            checkpoint: { envelope: "stub-checkpoint" },
          },
        },
      ],
    };
  },
};

const adversarialSubject: AnchorSubject = {
  skill_id: "skl_adversarial0000",
  skill_version: "1.0.0",
  package_digest: "sha256:" + "e".repeat(64),
  issuer_class: "configured_ed25519",
};

test("adversarial: transparency anchor with a tampered subject name -> anchor_subject_mismatch", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const signer = createEd25519Signer(privateKey as unknown as string, "adversarial-anchor-key-1");
  const digest = "sha256:" + "f0".repeat(32);
  // A validly-signed, correctly-logged anchor for adversarialSubject...
  const { anchor } = await anchorToRekor(digest, signer, publicKey, adversarialSubject, {
    witness: adversarialStubWitness as never,
  });
  // ...presented as if it were about a different skill_id. No signature
  // tampering needed: re-using a legitimate anchor's receipt to vouch for
  // the wrong skill is the realistic attack this check exists to catch.
  const result = await verifyRekorAnchor(
    { ...anchor, package_digest: digest },
    digest,
    publicKey,
    { skill_id: "skl_not_the_real_skill", package_digest: adversarialSubject.package_digest },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "anchor_subject_mismatch");
});

test("adversarial: transparency anchor with a subject digest that doesn't match the package -> anchor_subject_mismatch", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const signer = createEd25519Signer(privateKey as unknown as string, "adversarial-anchor-key-2");
  const digest = "sha256:" + "f1".repeat(32);
  const { anchor } = await anchorToRekor(digest, signer, publicKey, adversarialSubject, {
    witness: adversarialStubWitness as never,
  });
  const result = await verifyRekorAnchor(
    { ...anchor, package_digest: digest },
    digest,
    publicKey,
    { skill_id: adversarialSubject.skill_id, package_digest: "sha256:" + "99".repeat(32) },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "anchor_subject_mismatch");
});

test("adversarial: transparency anchor verified against the wrong sealed_manifest_digest -> refused, not silently accepted", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const signer = createEd25519Signer(privateKey as unknown as string, "adversarial-anchor-key-3");
  const digest = "sha256:" + "f2".repeat(32);
  const { anchor } = await anchorToRekor(digest, signer, publicKey, adversarialSubject, {
    witness: adversarialStubWitness as never,
  });
  const result = await verifyRekorAnchor(
    { ...anchor, package_digest: digest },
    "sha256:" + "f3".repeat(32),
    publicKey,
  );
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /does not match/);
});

test("adversarial: an anchor statement predicate leaking a disallowed key is refused before it's ever signed", () => {
  const digest = "sha256:" + "f4".repeat(32);
  const statement = buildAnchorStatement(digest, adversarialSubject);
  // Simulate a future code change accidentally adding a descriptive field
  // (title, intent, journey text, anything beyond the fixed allowlist) to
  // the predicate before it's signed and permanently, publicly logged.
  (statement.predicate as unknown as Record<string, unknown>).skill_title = "Do not log me publicly";
  assert.throws(() => assertAnchorStatementPrivacy(statement), /disallowed key/);
});
