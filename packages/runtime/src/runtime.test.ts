/**
 * Package-local unit tests for @skillerr/runtime, run directly against this
 * package (no dependency on @skillerr/cli). End-to-end execute/dry_run
 * flows are covered by @skillerr/cli's conformance and adversarial suites;
 * this file targets the capability gate, input resolution, and trust gate
 * in isolation (Tier 3: root npm test only ran @skillerr/cli).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { assertCapabilityAllowed, runSkillPackage, runSkillArchive } from "./index.js";
import {
  compileSkillSource,
  approveCompilation,
  mintSkillPackage,
  packSkill,
} from "@skillerr/core";
import { DEFAULT_SKILL_POLICY, PROTOCOL_VERSION, type SkillPackageFiles, type SkillContract, type SkillSource } from "@skillerr/protocol";

function minimalPackage(overrides: {
  policy?: Partial<typeof DEFAULT_SKILL_POLICY>;
  permissions?: SkillPackageFiles["manifest"]["permissions"];
  inputs?: SkillPackageFiles["manifest"]["inputs"];
}): SkillPackageFiles {
  return {
    manifest: {
      kind: "dot-skill",
      id: "skl_runtime_unit",
      version: "1.0.0",
      title: "Runtime unit fixture",
      description: "Runtime unit fixture",
      container_version: "1",
      protocol_version: PROTOCOL_VERSION,
      entrypoint: "s1",
      inputs: overrides.inputs ?? [],
      outputs: [],
      capabilities: [],
      permissions: overrides.permissions ?? [],
      policy: { ...DEFAULT_SKILL_POLICY, ...overrides.policy },
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

test("capability gate: network host allowlist requires exact/suffix match, not substring", () => {
  const netCap = {
    name: "http.fetch",
    description: "Fetch URL",
    side_effect_class: "network" as const,
    fallback: "fail" as const,
    required: false,
  };
  const pkg = minimalPackage({
    policy: { allow_network: true },
    permissions: [
      {
        side_effect_class: "network",
        description: "Fetch from example.com",
        hosts: ["example.com"],
        requires_consent: false,
      },
    ],
  });
  assert.throws(() => assertCapabilityAllowed(pkg, netCap, { url: "https://evil.com/?q=example.com" }));
  assert.doesNotThrow(() => assertCapabilityAllowed(pkg, netCap, { url: "https://example.com" }));
});

test("capability gate: read requires a declared permission (not exempt from deny-by-default)", () => {
  const readCap = {
    name: "fs.read",
    description: "Read a file",
    side_effect_class: "read" as const,
    fallback: "fail" as const,
    required: false,
  };
  const noPerm = minimalPackage({});
  assert.throws(() => assertCapabilityAllowed(noPerm, readCap, { path: "/anything" }));

  const withPerm = minimalPackage({
    permissions: [
      { side_effect_class: "read", description: "Read /data", paths: ["/data"], requires_consent: false },
    ],
  });
  assert.doesNotThrow(() => assertCapabilityAllowed(withPerm, readCap, { path: "/data/notes.txt" }));
});

test("PHASE 4: capability gate: exec requires a declared permission (not exempt from deny-by-default) — the bundled-script case", () => {
  const execCap = {
    name: "run_lint",
    description: "Run a bundled lint script",
    side_effect_class: "exec" as const,
    fallback: "ask_human" as const,
    required: false,
  };
  const noPerm = minimalPackage({});
  assert.throws(
    () => assertCapabilityAllowed(noPerm, execCap, {}),
    /Denied: capability run_lint uses exec but no matching permission is declared/,
  );

  const withPerm = minimalPackage({
    permissions: [
      { side_effect_class: "exec", description: "Run bundled scripts", requires_consent: true },
    ],
  });
  assert.doesNotThrow(() => assertCapabilityAllowed(withPerm, execCap, {}));
});

test("input resolution: required input with no value/default is reported missing; a default resolves automatically", async () => {
  const pkg = minimalPackage({
    inputs: [
      {
        name: "required_no_default",
        description: "must be provided",
        schema: { type: "string" },
        required: true,
        sensitivity: "private",
        source: "human",
        ask_when: "if_missing",
      },
      {
        name: "has_default",
        description: "has a default",
        schema: { type: "string" },
        required: true,
        default: "fallback-value",
        sensitivity: "private",
        source: "human",
        ask_when: "if_missing",
      },
    ],
  });
  const run = await runSkillPackage(pkg, {}, { mode: "inspect" });
  const missingNames = (run.outputs?.missing_inputs as string[]) ?? [];
  assert.ok(missingNames.includes("required_no_default"));
  assert.ok(!missingNames.includes("has_default"));
  assert.equal(run.resolved_inputs?.has_default, "fallback-value");
});

test("input resolution: a secret-sensitivity input is substituted with a secret ref, never the raw value", async () => {
  const pkg = minimalPackage({
    inputs: [
      {
        name: "api_key",
        description: "API key",
        schema: { type: "string" },
        required: true,
        sensitivity: "secret",
        source: "secret",
        ask_when: "if_missing",
      },
    ],
  });
  const run = await runSkillPackage(pkg, {}, { mode: "inspect", inputs: { api_key: "sk-real-secret-value" } });
  assert.equal(run.resolved_inputs?.api_key, "secret:api_key");
  assert.equal(run.secret_refs?.api_key, "sk-real-secret-value");
});

function validContract(): SkillContract {
  return {
    kind: "skill_contract",
    contract_version: "1.0",
    skill_kind: "knowledge",
    title: "Runtime trust gate fixture",
    intent: "A minimal complete contract for trust-gate unit coverage.",
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

test("trust gate: execute refuses a dev-HMAC-minted (trust_state=development) package without --allow-untrusted", async () => {
  const contract = validContract();
  const source: SkillSource = {
    kind: "skill_source",
    id: "src_runtime_trust",
    hash: "sha256:" + "c".repeat(64),
    title: contract.title,
    contract,
    sections: [],
    steering: [],
    prompts: [],
    code_refs: [],
    parents: [],
    agent: { host: "cursor" },
    journey: { summary: "Trust gate fixture.", redacted: true, sensitivity: "private" },
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
  const { files } = mintSkillPackage(approved.files, { host: "cursor" });

  const refused = await runSkillArchive(packSkill(files), { host: "test" }, { mode: "execute" });
  assert.equal(refused.status, "failed");
  assert.match(refused.error ?? "", /Refusing execute/);

  const allowed = await runSkillArchive(
    packSkill(files),
    { host: "test", consent: async () => ({ allowed: true, actor: "t", at: new Date().toISOString() }) },
    { mode: "execute", allow_untrusted: true },
  );
  assert.doesNotMatch(allowed.error ?? "", /Refusing execute/);
});
