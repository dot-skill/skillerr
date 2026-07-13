import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { strToU8, strFromU8, zipSync } from "fflate";
import {
  canonicalize,
  inspectSkill,
  inspectTrustView,
  migrateLegacySkill,
  normalizePath,
  packSkill,
  PUBLIC_DEV_MINT_KEY,
  sha256Digest,
  sealedManifestDigest,
  unpackSkill,
  UnsafeZipError,
  validatePackageBytes,
  mintSkillPackage,
  addPermanenceAnchor,
  verifyMintTrust,
  compileRecipeToSkill,
  compileSkillSource,
  approveCompilation,
  CompileRefusalError,
} from "@skillerr/core";
import {
  DEFAULT_SKILL_POLICY,
  CONTAINER_VERSION,
  PROTOCOL_VERSION,
  WORKFLOW_DIALECT_VERSION,
  recipeToSkillSource,
  assessSkillContract,
  extractSkillCandidates,
  type Recipe,
  type SkillContract,
  type SkillPackageFiles,
  type SkillSource,
} from "@skillerr/protocol";
import { assertCapabilityAllowed, runSkillArchive, runSkillPackage } from "@skillerr/runtime";
import { publish, lookup, list } from "@skillerr/registry";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const demoContract = (): SkillContract => ({
  kind: "skill_contract",
  contract_version: "0.5",
  skill_kind: "procedure",
  title: "Demo integration",
  intent: "Wire a service to a configured endpoint without exposing credentials.",
  sensitivity: "private",
  triggers: {
    status: "specified",
    items: [{ id: "ready", description: "A reviewed service integration is ready." }],
  },
  inputs: {
    status: "specified",
    items: [
      {
        name: "base_url",
        description: "Service base URL",
        schema: { type: "string", format: "uri" },
        required: true,
        sensitivity: "private",
        source: "human",
        ask_when: "if_missing",
        approval: "none",
      },
      {
        name: "api_credential_ref",
        description: "Reference to a credential",
        schema: { type: "string" },
        required: true,
        sensitivity: "secret",
        source: "secret",
        ask_when: "if_missing",
        approval: "none",
      },
    ],
  },
  preconditions: { status: "none", reason: "No preconditions beyond declared inputs." },
  steps: {
    status: "specified",
    items: [
      {
        id: "connect",
        title: "Connect API",
        kind: "instruct",
        instruction: "Call {{base_url}} using {{api_credential_ref}} and retry twice on 429.",
      },
      {
        id: "emit",
        title: "Emit result",
        kind: "emit",
        output: "result",
        from: "connect",
      },
    ],
  },
  branches: { status: "none", reason: "Retry behavior is contained in the instruction." },
  human_decisions: { status: "none", reason: "This demonstration performs no irreversible action." },
  capabilities: { status: "none", reason: "The host agent applies the instruction." },
  permissions: { status: "none", reason: "The contract grants no side-effect permission." },
  forbidden_actions: {
    status: "specified",
    items: [{ id: "no_secrets", description: "Do not hardcode secrets.", enforcement: "host" }],
  },
  outputs: {
    status: "specified",
    items: [
      {
        name: "result",
        description: "Integration result",
        schema: { type: "object" },
        required: true,
      },
    ],
  },
  recovery: { status: "none", reason: "No external side effect is authorized." },
  verification: {
    status: "specified",
    items: [
      {
        id: "inputs_resolved",
        assertion: "Required endpoint and credential references are resolved.",
        check: "runtime",
        required: true,
      },
    ],
  },
  corrections: {
    status: "specified",
    items: [{ id: "retry_429", lesson: "Retry no more than twice on 429." }],
  },
  provenance: {
    evidence: {
      status: "specified",
      items: [
        {
          id: "section_design",
          kind: "section",
          ref: "ing_1@1",
          supports: ["intent", "steps", "verification"],
        },
      ],
    },
    limitations: { status: "none", reason: "No known semantic limitation." },
    human_review: {
      status: "reviewed",
      actor: "test-human",
      at: "2026-07-13T00:00:00.000Z",
      scope: ["complete contract"],
    },
  },
});

const demoRecipe = (): Recipe => ({
  kind: "recipe",
  id: "rcp_demo",
  hash: "sha256:" + "a".repeat(64),
  title: "Demo integration",
  summary: "Wire service to {{base_url}}",
  journey_summary:
    "Human and agent designed a retrying API client; secrets stay as refs.",
  ingredients: [
    {
      id: "ing_1",
      revision: 1,
      type: "integration",
      title: "Connect API",
      body: "Call the API at {{base_url}} using credential {{api_credential_ref}}",
      attachments: [],
      code_refs: [],
      sensitivity: "private",
    },
    {
      id: "ing_2",
      revision: 1,
      type: "decision",
      title: "Use retries",
      body: "Retry twice on 429",
      attachments: [],
      code_refs: [],
      sensitivity: "publishable",
    },
  ],
  steering: [
    {
      kind: "steering",
      id: "st_1",
      session_id: "ses_1",
      verb: "reject",
      target_kind: "ingredient",
      target_id: "ing_1",
      note: "Do not hardcode secrets",
      actor: { id: "you" },
      at: new Date().toISOString(),
    },
  ],
  prompts: [],
  code_refs: [],
  parents: [],
  provenance: { hosts: ["cursor"], models: ["test-model"], session_ids: ["ses_1"] },
  visibility_intent: "private",
  baked_at: new Date().toISOString(),
  baker: { id: "you" },
  source_protocol_version: "0.4.0",
  generation_usage: {
    input_tokens: 1200,
    output_tokens: 400,
    total_tokens: 1600,
    reported_by: "agent",
    captured_at: new Date().toISOString(),
    host: "cursor",
    model: "test-model",
  },
  contract: demoContract(),
});

const npmPublishingSource = (): SkillSource => ({
  kind: "skill_source",
  id: "gold-scoped-npm-monorepo-publishing",
  hash: "sha256:6869813aaee0d11115215f5691b6242e2fdd6cc0122df049ba4734df38c02c68",
  title: "Scoped npm monorepo publishing",
  summary: "Approved npm-publishing gold model represented as a 0.5 contract.",
  intent: "Release a coordinated set of scoped workspace packages safely and verifiably.",
  contract: {
    kind: "skill_contract",
    contract_version: "0.5",
    skill_kind: "integration",
    title: "Scoped npm monorepo publishing",
    intent: "Release a coordinated set of scoped workspace packages safely and verifiably.",
    sensitivity: "private",
    triggers: {
      status: "specified",
      items: [
        {
          id: "reviewed_set_ready",
          description: "A reviewed package set is ready for a coordinated npm release.",
        },
      ],
    },
    inputs: {
      status: "specified",
      items: [
        {
          name: "workspace_root",
          description: "Monorepo workspace root",
          schema: { type: "string", format: "directory" },
          required: true,
          sensitivity: "private",
          source: "human",
          ask_when: "if_missing",
          approval: "none",
        },
        {
          name: "registry_scope",
          description: "Public npm scope",
          schema: { type: "string", pattern: "^@[a-z0-9-]+$" },
          required: true,
          sensitivity: "public",
          source: "human",
          ask_when: "if_missing",
          approval: "human_before_use",
        },
        {
          name: "release_tag",
          description: "npm distribution tag",
          schema: { type: "string" },
          required: false,
          default: "latest",
          sensitivity: "public",
          source: "human",
          ask_when: "if_missing",
          approval: "none",
        },
      ],
    },
    preconditions: {
      status: "specified",
      items: [
        {
          id: "clean_and_tested",
          assertion: "Working tree is clean and tests pass.",
          check: "capability",
          on_failure: "Stop before packing.",
        },
        {
          id: "metadata_reviewed",
          assertion: "Versions, public access metadata, package contents, and registry identity are reviewed.",
          check: "human",
          on_failure: "Request review and stop.",
        },
      ],
    },
    steps: {
      status: "specified",
      items: [
        { id: "discover", title: "Discover packages", kind: "tool", capability: "workspace.read", result_as: "package_set" },
        { id: "metadata", title: "Verify metadata", kind: "tool", capability: "workspace.read", result_as: "metadata_report" },
        { id: "build_test", title: "Build and test cleanly", kind: "tool", capability: "commands.execute", result_as: "build_report" },
        { id: "pack", title: "Pack and inspect tarballs", kind: "tool", capability: "commands.execute", result_as: "tarball_report" },
        { id: "registry_check", title: "Check registry access and conflicts", kind: "tool", capability: "npm.query", result_as: "registry_preflight" },
        { id: "release_decision", title: "Request release decision", kind: "human_decision", instruction: "Approve the package set and irreversible npm release.", result_as: "release_approval" },
        { id: "publish", title: "Publish in dependency order", kind: "tool", capability: "npm.publish", result_as: "published_versions" },
        { id: "verify_registry", title: "Verify registry and fresh install", kind: "tool", capability: "npm.query", result_as: "registry_report", next: "contract_verification" },
        { id: "report_access_blocker", title: "Report access blocker", kind: "instruct", instruction: "Defer release and report the exact access blocker.", next: "contract_verification" },
        { id: "stop_and_rebuild", title: "Stop and rebuild", kind: "instruct", instruction: "Correct tarball contents and restart verification.", next: "discover" }
      ],
    },
    branches: {
      status: "specified",
      items: [
        { id: "auth_blocked", after_step: "registry_check", condition: "input:registry_access==unavailable", then: "report_access_blocker", otherwise: "release_decision" },
        { id: "private_tarball", after_step: "pack", condition: "input:tarball_safe==false", then: "stop_and_rebuild", otherwise: "registry_check" }
      ],
    },
    human_decisions: {
      status: "specified",
      items: [
        { id: "approve_package_set", prompt: "Approve package set and versions.", required_before: "pack", irreversible: false, approval: "explicit_human" },
        { id: "approve_registry_release", prompt: "Approve irreversible registry release.", required_before: "publish", irreversible: true, approval: "explicit_human" }
      ],
    },
    capabilities: {
      status: "specified",
      items: [
        { name: "workspace.read", description: "Read workspace and package metadata.", side_effect_class: "read", fallback: "fail", required: true },
        { name: "commands.execute", description: "Execute build, test, pack, and clean installation.", side_effect_class: "exec", fallback: "fail", required: true },
        { name: "npm.query", description: "Query npm registry metadata.", side_effect_class: "network", fallback: "fail", required: true },
        { name: "npm.publish", description: "Publish only after explicit authorization.", side_effect_class: "destructive", fallback: "fail", required: true }
      ],
    },
    permissions: {
      status: "specified",
      items: [
        { id: "read_workspace", side_effect_class: "read", description: "Read selected workspace and tarball manifests.", paths: ["{{workspace_root}}"], consent: "none" },
        { id: "write_outputs", side_effect_class: "write", description: "Write build outputs, tarballs, and reports in the workspace.", paths: ["{{workspace_root}}"], consent: "explicit_human" },
        { id: "execute_commands", side_effect_class: "exec", description: "Execute reviewed package-manager commands.", consent: "explicit_human" },
        { id: "registry_network", side_effect_class: "network", description: "Query npm; publication requires its own decision.", hosts: ["registry.npmjs.org"], consent: "explicit_human" }
      ],
    },
    forbidden_actions: {
      status: "specified",
      items: [
        { id: "no_credentials", description: "Do not embed or print credentials.", enforcement: "host" },
        { id: "no_dry_publish", description: "Do not publish during inspection, dry-run, or continuity execution.", enforcement: "runtime" },
        { id: "no_inferred_approval", description: "Do not infer human approval from compiler completeness.", enforcement: "runtime" },
        { id: "stop_on_failure", description: "Do not continue after dependency, version, tarball, or metadata failure.", enforcement: "runtime" }
      ],
    },
    outputs: {
      status: "specified",
      items: [
        { name: "tarball_report", description: "Tarball inspection report.", schema: { type: "object" }, required: true },
        { name: "registry_report", description: "Registry verification report.", schema: { type: "object" }, required: true },
        { name: "published_versions", description: "Versions released only when approved.", schema: { type: "array", items: { type: "string" } }, required: false }
      ],
    },
    recovery: {
      status: "specified",
      items: [
        { id: "first_failure", from_step: "publish", condition: "Any verification fails", action: "Stop and record the exact package boundary.", terminal: true },
        { id: "nothing_published", from_step: "publish", condition: "Nothing was published", action: "Correct the issue and restart all checks.", goto: "discover" },
        { id: "partial_publish", from_step: "publish", condition: "Publication was partial", action: "Inventory immutable versions before reviewed roll-forward.", goto: "verify_registry" },
        { id: "version_exists", from_step: "publish", condition: "A registry version exists", action: "Choose reviewed replacement versions; never overwrite.", terminal: true }
      ],
    },
    verification: {
      status: "specified",
      items: [
        { id: "tarballs_resolve", assertion: "All first-party packages resolve from registry tarballs.", check: "capability", evidence: ["registry_report"], required: true },
        { id: "fresh_install", assertion: "Fresh installation reports intended exact versions.", check: "capability", evidence: ["registry_report"], required: true },
        { id: "no_private_files", assertion: "No package contains private files or credentials.", check: "capability", evidence: ["tarball_report"], required: true }
      ],
    },
    corrections: {
      status: "specified",
      items: [
        { id: "auth_stop", lesson: "Authentication or scope denial stops publication without credential improvisation." },
        { id: "clean_rebuild", lesson: "Private or stale tarballs require clean rebuild and full reinspection." },
        { id: "dependency_stop", lesson: "Dependency-order failure stops downstream publication." },
        { id: "partial_inventory", lesson: "Partial publication requires immutable-version inventory before recovery." },
        { id: "githead_match", lesson: "Registry gitHead and metadata must match reviewed source." },
        { id: "version_drift", lesson: "Workspace version drift blocks publication." },
        { id: "consumer_install", lesson: "A clean npm consumer installation is required before success." }
      ],
    },
    provenance: {
      evidence: {
        status: "specified",
        items: [
          { id: "ev-000161", kind: "source", ref: "ev-000161", supports: ["steps", "permissions"] },
          { id: "ev-000169", kind: "source", ref: "ev-000169", supports: ["recovery", "verification"] },
          { id: "ev-000176", kind: "review", ref: "ev-000176", supports: ["complete contract"] }
        ],
      },
      limitations: {
        status: "specified",
        items: ["The restricted source cannot be independently reproduced from redacted evidence."],
      },
      human_review: {
        status: "reviewed",
        actor: "acceptance-reviewer",
        at: "2026-07-13T00:00:00.000Z",
        scope: ["semantic baseline", "typed inputs", "release compilation"],
        digest: "sha256:6869813aaee0d11115215f5691b6242e2fdd6cc0122df049ba4734df38c02c68",
      },
    },
  },
  sections: [],
  steering: [],
  prompts: [],
  code_refs: [],
  parents: [],
  agent: { host: "cursor", provider: "test", model: "fixture", deployment: "local" },
  journey: {
    summary: "Human-approved npm publishing semantics compiled from the reviewed gold model.",
    redacted: true,
    sensitivity: "private",
  },
  inputs_declared: "none",
  sensitivity: "private",
  created_at: "2026-07-13T00:00:00.000Z",
  actor: { id: "acceptance-reviewer" },
  source_protocol_version: "0.5.0",
});

function packageIdentity(relativeUrl: string): { name: string; version: string } {
  return JSON.parse(readFileSync(new URL(relativeUrl, import.meta.url), "utf8")) as {
    name: string;
    version: string;
  };
}

test("CLI version comes from its package metadata", () => {
  const cli = packageIdentity("../package.json");
  const output = execFileSync(
    process.execPath,
    [fileURLToPath(new URL("./cli.js", import.meta.url)), "--version"],
    { encoding: "utf8" },
  );
  assert.equal(output, `${cli.version}\n`);
});

test("CLI mint works standalone on an explicit file, outside any workspace — consistent with inspect/validate/verify-trust", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { generateKeyPairSync } = await import("node:crypto");
  const cliPath = fileURLToPath(new URL("./cli.js", import.meta.url));
  const sourcePath = fileURLToPath(
    new URL("../../../examples/contract-foundation/source.json", import.meta.url),
  );
  const dir = mkdtempSync(join(tmpdir(), "skill-mint-standalone-"));
  const packageFile = join(dir, "out.skill");

  execFileSync(
    process.execPath,
    [cliPath, "pack", sourcePath, "-o", packageFile, "--profile", "release", "--host", "cursor"],
    { encoding: "utf8", env: { ...process.env, SKILL_HOST: "cursor" } },
  );

  // No `skill init` ran in `dir` — this must not require a workspace.
  const { privateKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const keyPath = join(dir, "signer.pem");
  writeFileSync(keyPath, privateKey as unknown as string);

  const result = JSON.parse(
    execFileSync(
      process.execPath,
      [cliPath, "mint", packageFile, "--host", "cursor", "--signer-key", keyPath, "--key-id", "test-key"],
      {
        encoding: "utf8",
        env: { ...process.env, SKILL_HOST: "cursor", SKILL_SESSION_ID: "ses_test" },
      },
    ),
  ) as { ok: boolean; mint_status: string };
  assert.equal(result.ok, true);
  assert.equal(result.mint_status, "minted");
});

test("CLI exposes machine-readable contract template and field assessment", () => {
  const cliPath = fileURLToPath(new URL("./cli.js", import.meta.url));
  const template = JSON.parse(
    execFileSync(process.execPath, [cliPath, "contract-template"], { encoding: "utf8" }),
  ) as { kind: string; contract_version: string };
  assert.equal(template.kind, "skill_contract");
  assert.equal(template.contract_version, "0.5");

  const sourcePath = fileURLToPath(
    new URL("../../../examples/contract-foundation/source.json", import.meta.url),
  );
  const checked = JSON.parse(
    execFileSync(process.execPath, [cliPath, "contract-check", sourcePath], {
      encoding: "utf8",
    }),
  ) as { assessment: { complete: boolean }; explanation: { fixes: unknown[] } };
  assert.equal(checked.assessment.complete, true);
  assert.deepEqual(checked.explanation.fixes, []);
});

test("CLI agent-guide and extract emit multi-skill scaffolds with incompleteness", () => {
  const cliPath = fileURLToPath(new URL("./cli.js", import.meta.url));
  const guideText = execFileSync(process.execPath, [cliPath, "agent-guide"], {
    encoding: "utf8",
  });
  assert.match(guideText, /Identify → propose multiple skills/);
  assert.match(guideText, /skill extract/);
  assert.match(guideText, /One skill workspace per candidate/);

  const guideJson = JSON.parse(
    execFileSync(process.execPath, [cliPath, "agent-guide", "--json"], {
      encoding: "utf8",
    }),
  ) as { kind: string; identify_multiple_skills: string[]; refuse: string[] };
  assert.equal(guideJson.kind, "skill_agent_guide");
  assert.ok(guideJson.identify_multiple_skills.length >= 4);
  assert.ok(guideJson.refuse.some((r) => /incomplete/i.test(r)));

  const journeyPath = fileURLToPath(
    new URL("../../../examples/multi-skill-extract/journey.json", import.meta.url),
  );
  const outDir = join(tmpdir(), `skillerr-extract-${Date.now()}`);
  let extractOut = "";
  let exitCode = 0;
  try {
    extractOut = execFileSync(
      process.execPath,
      [cliPath, "extract", journeyPath, "-o", outDir],
      { encoding: "utf8" },
    );
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    exitCode = e.status ?? 1;
    extractOut = e.stdout ?? "";
  }
  assert.equal(exitCode, 2, "fresh scaffolds must fail completeness (exit 2)");
  const report = JSON.parse(extractOut) as {
    ok: boolean;
    kind: string;
    candidate_count: number;
    scaffolds: Array<{
      workspace_slug: string;
      missing: unknown[];
      candidate: { assessment: { complete: boolean } };
    }>;
    protocol: { one_workspace_per_skill: boolean; refuse_release_if_incomplete: boolean };
  };
  assert.equal(report.ok, true);
  assert.equal(report.kind, "skill_extraction");
  assert.equal(report.candidate_count, 3);
  assert.equal(report.protocol.one_workspace_per_skill, true);
  assert.equal(report.protocol.refuse_release_if_incomplete, true);
  assert.ok(report.scaffolds.every((s) => s.candidate.assessment.complete === false));
  assert.ok(report.scaffolds.every((s) => s.missing.length > 0));

  const assessmentPath = join(
    outDir,
    "candidates",
    "scoped-npm-monorepo-publishing",
    "assessment.json",
  );
  const written = JSON.parse(readFileSync(assessmentPath, "utf8")) as {
    missing: unknown[];
  };
  assert.ok(written.missing.length > 0);

  // segment is an alias
  let segmentCode = 0;
  try {
    execFileSync(process.execPath, [cliPath, "segment", journeyPath], { encoding: "utf8" });
  } catch (err) {
    segmentCode = (err as { status?: number }).status ?? 1;
  }
  assert.equal(segmentCode, 2);
});

test("extract refuses journey without candidates", () => {
  assert.throws(
    () =>
      extractSkillCandidates({
        summary: "Redacted work with no topics listed.",
        redacted: true,
      }),
    /No skill candidates/,
  );
});

test("canonicalize sorts object keys", () => {
  assert.equal(canonicalize({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test("SEC-K: RFC 8785 cross-implementation canonicalization vectors", () => {
  const vectorsPath = fileURLToPath(
    new URL("../../../fixtures/canonicalization/vectors.json", import.meta.url),
  );
  const vectors = JSON.parse(readFileSync(vectorsPath, "utf8")) as Array<{
    name: string;
    input: unknown;
    canonical: string;
    sha256: string;
  }>;
  assert.ok(vectors.length >= 10, "expected the full canonicalization vector set");
  for (const { name, input, canonical, sha256 } of vectors) {
    assert.equal(canonicalize(input), canonical, `canonical mismatch for vector "${name}"`);
    assert.equal(sha256Digest(canonical), sha256, `digest mismatch for vector "${name}"`);
  }
  // The RFC 8785 gotcha, called out explicitly: UTF-16 code-unit sort, not
  // code-point sort, puts the surrogate-pair emoji key before the BMP key.
  const utf16 = vectors.find((v) => v.name === "utf16_surrogate_sort")!;
  assert.equal(utf16.canonical.indexOf("😀"), 2);
});

test("pack/unpack/validate round-trip", () => {
  const pkg: SkillPackageFiles = {
    manifest: {
      kind: "dot-skill",
      id: "skl_test",
      version: "1.0.0",
      title: "Test skill",
      description: "A minimal skill for conformance",
      container_version: CONTAINER_VERSION,
      protocol_version: PROTOCOL_VERSION,
      entrypoint: "s1",
      inputs: [],
      outputs: [{ name: "result", schema: { type: "string" }, required: true }],
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
      steps: [
        { id: "s1", kind: "instruct", text: "Do the thing", next: "s2" },
        { id: "s2", kind: "emit", output: "result", from: "s1" },
      ],
    },
    knowledge: [
      {
        kind: "knowledge",
        id: "k1",
        type: "rule",
        title: "Rule",
        body: "Always ask for {{project_name}}",
        fidelity: "exact",
        pinned: true,
      },
    ],
  };
  const bytes = packSkill(pkg);
  const validation = validatePackageBytes(bytes);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
  const unpacked = unpackSkill(bytes);
  assert.equal(unpacked.manifest.id, "skl_test");
  assert.equal(unpacked.knowledge.length, 1);
  const inspected = inspectSkill(bytes);
  assert.equal(inspected.ok, true);
  assert.equal(inspected.summary.title, "Test skill");
});

test("BUG-3: validate refuses a package with inputs or policy.consent_for stripped, instead of silently treating them as empty", () => {
  const basePkg: SkillPackageFiles = {
    manifest: {
      kind: "dot-skill",
      id: "skl_stripped",
      version: "1.0.0",
      title: "Test skill",
      description: "A minimal skill for conformance",
      container_version: CONTAINER_VERSION,
      protocol_version: PROTOCOL_VERSION,
      entrypoint: "s1",
      inputs: [],
      outputs: [{ name: "result", schema: { type: "string" }, required: true }],
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
      steps: [{ id: "s1", kind: "emit", output: "result", from: "s1" }],
    },
    knowledge: [],
  };

  // packSkill() itself now refuses a manifest missing required fields (its
  // own manifest_digest computation can't be trusted to gloss over them —
  // see SEC-F), which correctly rules out "just pack it with the field
  // missing". The real threat this guards against is an attacker editing
  // skill.json bytes directly inside an *already-packed* archive, so that's
  // what this simulates: pack a complete package, then rewrite skill.json
  // in the zip with a field stripped, bypassing finalizeManifest entirely.
  const { files } = unpackSkill(packSkill(basePkg));
  function repackWithTamperedManifest(mutate: (m: Record<string, unknown>) => void): Uint8Array {
    const manifest = JSON.parse(strFromU8(files["skill.json"]!)) as Record<string, unknown>;
    mutate(manifest);
    return zipSync({ ...files, "skill.json": strToU8(JSON.stringify(manifest, null, 2)) });
  }

  const noInputs = repackWithTamperedManifest((m) => {
    delete m.inputs;
  });
  const validationNoInputs = validatePackageBytes(noInputs);
  assert.equal(validationNoInputs.ok, false);
  assert.ok(validationNoInputs.issues.some((i) => i.code === "inputs_missing"));

  const noConsent = repackWithTamperedManifest((m) => {
    delete (m.policy as Record<string, unknown>).consent_for;
  });
  const validationNoConsent = validatePackageBytes(noConsent);
  assert.equal(validationNoConsent.ok, false);
  assert.ok(validationNoConsent.issues.some((i) => i.code === "policy_consent_for_missing"));
});

test("rejects path traversal in package build via normalize", () => {
  assert.throws(() => {
    packSkill({
      manifest: {
        kind: "dot-skill",
        id: "x",
        version: "1.0.0",
        title: "x",
        description: "x",
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
      resources: { "../evil.txt": "nope" },
    });
  });
});

/**
 * Builds a minimal hand-crafted zip using only stored (uncompressed) local
 * file headers — no central directory. fflate's streaming Unzip parser
 * (used by unpackSkill) scans for local file header signatures directly, so
 * this is enough to exercise it, including adversarial cases (duplicate
 * names) that packSkill's own API can never produce since it builds from a
 * JS object where a repeated key can't exist.
 */
function rawStoredZip(entries: Array<{ name: string; data: string }>): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const { name, data } of entries) {
    const nameBytes = strToU8(name);
    const dataBytes = strToU8(data);
    const header = new Uint8Array(30);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); // local file header signature
    view.setUint16(4, 20, true); // version needed
    view.setUint16(6, 0, true); // flags
    view.setUint16(8, 0, true); // compression method: stored
    view.setUint16(10, 0, true); // mod time
    view.setUint16(12, 0, true); // mod date
    view.setUint32(14, 0, true); // crc-32 (unchecked by UnzipPassThrough)
    view.setUint32(18, dataBytes.length, true); // compressed size
    view.setUint32(22, dataBytes.length, true); // uncompressed size
    view.setUint16(26, nameBytes.length, true); // filename length
    view.setUint16(28, 0, true); // extra field length
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

test("SEC-D: unpackSkill rejects duplicate zip entries instead of silently last-one-winning", () => {
  const archive = rawStoredZip([
    { name: "skill.json", data: '{"kind":"dot-skill","id":"looks-benign"}' },
    { name: "skill.json", data: '{"kind":"dot-skill","id":"actually-used"}' },
  ]);
  assert.throws(
    () => unpackSkill(archive),
    (error: unknown) => error instanceof UnsafeZipError && error.code === "duplicate_entry",
  );
});

test("SEC-D: distinct entry names still unpack fine (no false positive)", () => {
  const archive = rawStoredZip([
    { name: "skill.json", data: '{"a":1}' },
    { name: "workflow.json", data: '{"b":2}' },
  ]);
  const { files } = unpackSkill(archive);
  assert.equal(Object.keys(files).length, 2);
});

test("SEC-D: too many zip entries is refused with a distinct code", () => {
  const entries = Array.from({ length: 10_001 }, (_, i) => ({ name: `f${i}.txt`, data: "x" }));
  const archive = rawStoredZip(entries);
  assert.throws(
    () => unpackSkill(archive),
    (error: unknown) => error instanceof UnsafeZipError && error.code === "too_many_entries",
  );
});

test("SEC-E: zip-bomb-style compression ratio is refused during decompression, not after", () => {
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
    // Highly repetitive content compresses far past MAX_COMPRESSION_RATIO
    // while staying well under MAX_UNCOMPRESSED_BYTES — proves the ratio
    // check fires mid-stream, not just the absolute-size ceiling.
    resources: { "bomb.txt": "0".repeat(4_000_000) },
  });
  assert.throws(
    () => unpackSkill(bomb),
    (error: unknown) => error instanceof UnsafeZipError && error.code === "suspicious_compression_ratio",
  );
});

test("legacy migrate marks needs_human_review", () => {
  const { packageBytes, files } = migrateLegacySkill({
    kind: "skill",
    id: "skl_legacy",
    version: "1.0.0",
    title: "Legacy",
    body: "Paste this prompt into another AI",
    sources: [],
    exported_at: new Date().toISOString(),
    source_protocol_version: "0.1.0",
  });
  assert.equal(files.manifest.legacy, true);
  assert.equal(files.manifest.needs_human_review, true);
  assert.equal(validatePackageBytes(packageBytes).ok, true);
});

test("release compile refuses without AI agent host", () => {
  const recipe = demoRecipe();
  recipe.provenance.hosts = ["cli"];
  assert.throws(() => recipeToSkillSource(recipe), /AI agent host/);
});

test("release compile refuses when incomplete (no journey)", () => {
  const recipe = demoRecipe();
  delete recipe.journey_summary;
  recipe.summary = undefined;
  // Still has title as intent fallback — force empty journey via source override
  const source = recipeToSkillSource(recipe);
  source.journey.summary = "";
  assert.throws(
    () => compileSkillSource(source, { profile: "release", approve_inferred_inputs: true }),
    (e: unknown) => e instanceof CompileRefusalError && e.missing.includes("journey"),
  );
});

test("recipe/source compile produces traceable skill and runtime dry_run", async () => {
  const recipe = demoRecipe();
  const unreviewed = structuredClone(recipe);
  unreviewed.contract!.provenance.human_review = { status: "not_reviewed" };
  assert.throws(() =>
    compileRecipeToSkill(unreviewed, {
      approve_inferred_inputs: false,
      host: "cursor",
      profile: "release",
    }),
  );

  let compiled = compileRecipeToSkill(recipe, {
    approve_inferred_inputs: true,
    approve_permissions: true,
    host: "cursor",
    profile: "release",
  });
  compiled = approveCompilation(compiled, { inputs: ["*"], permissions: true });
  assert.equal(compiled.pending_approvals.length, 0);
  assert.equal(validatePackageBytes(compiled.packageBytes).ok, true);
  assert.ok(compiled.files.provenance?.generation_usage?.total_tokens === 1600);
  assert.equal(compiled.files.manifest.compile_profile, "release");

  const run = await runSkillPackage(
    compiled.files,
    {
      host: "cursor",
      verifyAssertion: async () => ({ passed: true, detail: "test fixture verification" }),
    },
    {
      mode: "dry_run",
      inputs: { base_url: "https://example.com", api_credential_ref: "secret:local" },
    },
  );
  assert.equal(run.status, "succeeded");
  assert.ok(run.steps.length > 0);
  assert.ok(run.package_digest.startsWith("sha256:"));
  assert.equal(run.runtime.name, packageIdentity("../../runtime/package.json").name);
  assert.equal(run.runtime.version, packageIdentity("../../runtime/package.json").version);
});

test("0.5 approved npm gold model retains structured semantics through package round-trip", () => {
  const source = npmPublishingSource();
  const assessment = assessSkillContract(source.contract, "release");
  assert.equal(assessment.complete, true, JSON.stringify(assessment.issues));
  const compiled = compileSkillSource(source, { profile: "release" });
  assert.equal(compiled.report.semantic_contract, "native_0.5");
  assert.equal(compiled.completeness.complete, true);
  const unpacked = unpackSkill(compiled.packageBytes);
  assert.deepEqual(unpacked.manifest.contract, source.contract);
  assert.deepEqual(unpacked.manifest.inputs[0]!.schema, {
    type: "string",
    format: "directory",
  });
  assert.equal(unpacked.manifest.inputs[2]!.required, false);
  assert.equal(unpacked.manifest.inputs[2]!.default, "latest");
  assert.equal(unpacked.manifest.inputs[1]!.sensitivity, "public");
  assert.equal(unpacked.manifest.inputs[1]!.approval, "human_before_use");
  assert.equal(unpacked.workflow.preconditions?.status, "specified");
  assert.equal(unpacked.workflow.branches?.status, "specified");
  assert.equal(unpacked.workflow.recovery?.status, "specified");
  assert.equal(unpacked.workflow.verification?.status, "specified");
  assert.ok(unpacked.workflow.steps.some((step) => step.kind === "branch"));
  assert.ok(unpacked.workflow.steps.some((step) => step.kind === "human_decision"));
  assert.equal(validatePackageBytes(compiled.packageBytes).ok, true);
});

test("release distinguishes explicit none from ambiguous omission", () => {
  const source = recipeToSkillSource(demoRecipe());
  assert.equal(source.contract?.capabilities.status, "none");
  assert.equal(source.contract?.permissions.status, "none");
  assert.doesNotThrow(() => compileSkillSource(source, { profile: "release" }));

  const omitted = structuredClone(source);
  delete (omitted.contract as Partial<SkillContract>).permissions;
  assert.throws(
    () => compileSkillSource(omitted, { profile: "release" }),
    (error: unknown) =>
      error instanceof CompileRefusalError &&
      error.hints.some((hint) => hint.startsWith("permissions:")),
  );
});

test("release refuses every ambiguously omitted contract declaration with a field fix", () => {
  const fields = [
    "title",
    "intent",
    "skill_kind",
    "sensitivity",
    "triggers",
    "inputs",
    "preconditions",
    "steps",
    "branches",
    "human_decisions",
    "capabilities",
    "permissions",
    "forbidden_actions",
    "outputs",
    "recovery",
    "verification",
    "corrections",
  ] as const;
  for (const field of fields) {
    const source = npmPublishingSource();
    delete (source.contract as unknown as Record<string, unknown>)[field];
    assert.throws(
      () => compileSkillSource(source, { profile: "release" }),
      (error: unknown) =>
        error instanceof CompileRefusalError &&
        error.hints.some((hint) => hint.startsWith(`${field}:`)),
      field,
    );
  }
  for (const field of ["evidence", "limitations", "human_review"] as const) {
    const source = npmPublishingSource();
    delete (source.contract!.provenance as unknown as Record<string, unknown>)[field];
    assert.throws(
      () => compileSkillSource(source, { profile: "release" }),
      (error: unknown) =>
        error instanceof CompileRefusalError &&
        error.hints.some((hint) => hint.startsWith(`provenance.${field}:`)),
      `provenance.${field}`,
    );
  }
});

test("runtime does not accept input values as human approval", async () => {
  const source = recipeToSkillSource(demoRecipe());
  source.contract!.human_decisions = {
    status: "specified",
    items: [
      {
        id: "approve_connect",
        prompt: "Approve connection",
        required_before: "connect",
        irreversible: false,
        approval: "explicit_human",
      },
    ],
  };
  const compiled = compileSkillSource(source, { profile: "release" });
  const run = await runSkillPackage(
    compiled.files,
    {
      host: "cursor",
      verifyAssertion: async () => ({ passed: true }),
    },
    {
      mode: "execute",
      inputs: {
        base_url: "https://example.test",
        api_credential_ref: "secret:local",
        approve_connect: "approve",
      },
    },
  );
  assert.equal(run.status, "failed");
  assert.match(run.error ?? "", /authenticated decide callback|cannot spoof human approval/i);
});

test("legacy text sources are continuity-only and continuity reports actionable contract gaps", () => {
  const legacyRecipe = demoRecipe();
  delete legacyRecipe.contract;
  assert.throws(
    () => compileRecipeToSkill(legacyRecipe, { profile: "release", host: "cursor" }),
    (error: unknown) =>
      error instanceof CompileRefusalError && error.missing.includes("semantic_contract"),
  );
  const continuity = compileRecipeToSkill(legacyRecipe, {
    profile: "continuity",
    host: "cursor",
    approve_inferred_inputs: true,
  });
  assert.equal(continuity.report.semantic_contract, "legacy_lossy");
  assert.equal(continuity.completeness.complete, false);
  assert.ok(continuity.completeness.missing.includes("semantic_contract"));
  assert.ok(continuity.report.losses?.length);
});

test("continuity compiles a partial native contract and returns field-specific fixes", () => {
  const source = npmPublishingSource();
  delete (source.contract as unknown as Record<string, unknown>).outputs;
  const compiled = compileSkillSource(source, { profile: "continuity" });
  assert.equal(compiled.completeness.complete, false);
  assert.ok(compiled.completeness.hints.some((hint) => hint.startsWith("outputs:")));
});

test("digest helper", () => {
  assert.match(sha256Digest("abc"), /^sha256:[a-f0-9]{64}$/);
});

test("SEC-J: compiling the same source twice produces byte-identical packages", () => {
  const contract = demoContract();
  const source: SkillSource = {
    kind: "skill_source",
    id: "src_determinism",
    hash: "sha256:" + "d".repeat(64),
    title: contract.title,
    contract,
    sections: [],
    steering: [],
    prompts: [],
    code_refs: [],
    parents: [],
    agent: { host: "cursor" },
    journey: { summary: "Determinism fixture.", redacted: true, sensitivity: "private" },
    inputs_declared: "none",
    sensitivity: "private",
    created_at: "2026-07-13T00:00:00.000Z",
    actor: { id: "test-agent" },
    source_protocol_version: PROTOCOL_VERSION,
  };
  const opts = { profile: "release" as const, approve_inferred_inputs: true, approve_permissions: true };
  const a = compileSkillSource(source, opts);
  const b = compileSkillSource(structuredClone(source), opts);

  assert.equal(a.files.manifest.id, b.files.manifest.id);
  assert.equal(a.files.manifest.package_digest, b.files.manifest.package_digest);
  assert.equal(a.files.manifest.manifest_digest, b.files.manifest.manifest_digest);
  assert.deepEqual(a.packageBytes, b.packageBytes);
});

test("PROTO-1: skill_id is content-addressed — same source hash+contract yields the same id, a different one yields a different id", () => {
  const contract = demoContract();
  const makeSource = (hash: string): SkillSource => ({
    kind: "skill_source",
    id: "src_proto1",
    hash,
    title: contract.title,
    contract,
    sections: [],
    steering: [],
    prompts: [],
    code_refs: [],
    parents: [],
    agent: { host: "cursor" },
    journey: { summary: "PROTO-1 fixture.", redacted: true, sensitivity: "private" },
    inputs_declared: "none",
    sensitivity: "private",
    created_at: "2026-07-13T00:00:00.000Z",
    actor: { id: "test-agent" },
    source_protocol_version: PROTOCOL_VERSION,
  });
  const opts = { profile: "release" as const, approve_inferred_inputs: true, approve_permissions: true };
  const sameHashA = compileSkillSource(makeSource("sha256:" + "1".repeat(64)), opts);
  const sameHashB = compileSkillSource(makeSource("sha256:" + "1".repeat(64)), opts);
  const differentHash = compileSkillSource(makeSource("sha256:" + "2".repeat(64)), opts);

  assert.match(sameHashA.files.manifest.id, /^skl_[a-f0-9]{12}$/);
  assert.equal(sameHashA.files.manifest.id, sameHashB.files.manifest.id);
  assert.notEqual(sameHashA.files.manifest.id, differentHash.files.manifest.id);
});

test("SEC-F: a draft (never-minted) package carries a self-consistent manifest_digest", () => {
  const recipe = demoRecipe();
  recipe.id = "rcp_secf_draft";
  const compiled = compileRecipeToSkill(recipe, {
    approve_inferred_inputs: true,
    approve_permissions: true,
    host: "cursor",
    profile: "release",
  });
  const manifest = compiled.files.manifest as unknown as Record<string, unknown>;
  assert.ok(typeof manifest.manifest_digest === "string" && manifest.manifest_digest.length > 0);
  const validation = validatePackageBytes(compiled.packageBytes);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
});

test("SEC-F: tampering with permissions/policy after packing is caught even without minting", () => {
  const recipe = demoRecipe();
  recipe.id = "rcp_secf_tamper";
  const compiled = compileRecipeToSkill(recipe, {
    approve_inferred_inputs: true,
    approve_permissions: true,
    host: "cursor",
    profile: "release",
  });
  const { files } = unpackSkill(compiled.packageBytes);
  const manifest = JSON.parse(strFromU8(files["skill.json"]!)) as {
    policy: { allow_network: boolean };
  };
  // Escalate a permission after packing — package_digest doesn't cover
  // skill.json, and this package was never minted, so before SEC-F nothing
  // would catch this.
  manifest.policy.allow_network = true;
  const tampered = zipSync({
    ...files,
    "skill.json": strToU8(JSON.stringify(manifest, null, 2)),
  });
  const validation = validatePackageBytes(tampered);
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((i) => i.code === "manifest_digest_mismatch"));
});

test("SEC-F: after minting, manifest_digest matches sealed_manifest_digest", () => {
  const recipe = demoRecipe();
  recipe.id = "rcp_secf_mint";
  let compiled = compileRecipeToSkill(recipe, {
    approve_inferred_inputs: true,
    approve_permissions: true,
    host: "cursor",
    profile: "release",
  });
  compiled = approveCompilation(compiled, { inputs: ["*"], permissions: true });
  compiled.files.manifest.needs_human_review = false;
  const { files, packageBytes } = mintSkillPackage(compiled.files, { host: "cursor" });
  assert.ok(files.manifest.manifest_digest);
  assert.equal(files.manifest.manifest_digest, files.manifest.sealed_manifest_digest);
  const validation = validatePackageBytes(packageBytes);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
});

test("SEC-G: seal uses real HMAC-SHA256, not a naive concatenated hash", () => {
  const recipe = demoRecipe();
  recipe.id = "rcp_secg_hmac";
  let compiled = compileRecipeToSkill(recipe, {
    approve_inferred_inputs: true,
    approve_permissions: true,
    host: "cursor",
    profile: "release",
  });
  compiled = approveCompilation(compiled, { inputs: ["*"], permissions: true });
  compiled.files.manifest.needs_human_review = false;
  const { files } = mintSkillPackage(compiled.files, { host: "cursor" });

  const dsse = files.signatures!["creation.dsse.json"] as {
    payload_digest: string;
    sig_alg: string;
    signatures: Array<{ sig: string }>;
  };
  assert.equal(dsse.sig_alg, "hmac-sha256-v1");

  const realHmac = createHmac("sha256", PUBLIC_DEV_MINT_KEY!)
    .update(dsse.payload_digest)
    .digest("hex");
  const naiveConcatHash = sha256Digest(`${PUBLIC_DEV_MINT_KEY}:${dsse.payload_digest}`);
  assert.equal(dsse.signatures[0]!.sig, realHmac);
  assert.notEqual(dsse.signatures[0]!.sig, naiveConcatHash);
});

test("SEC-G: a legacy-style seal without sig_alg is refused as unsupported, not a generic mismatch", () => {
  const recipe = demoRecipe();
  recipe.id = "rcp_secg_legacy";
  let compiled = compileRecipeToSkill(recipe, {
    approve_inferred_inputs: true,
    approve_permissions: true,
    host: "cursor",
    profile: "release",
  });
  compiled = approveCompilation(compiled, { inputs: ["*"], permissions: true });
  compiled.files.manifest.needs_human_review = false;
  const { files } = mintSkillPackage(compiled.files, { host: "cursor" });

  const unpacked = unpackSkill(packSkill(files));
  const dsse = unpacked.raw.signatures!["creation.dsse.json"] as {
    payload_digest: string;
    sig_alg?: string;
    signatures: Array<{ sig: string; keyid?: string }>;
  };
  // Simulate a seal from before SEC-G: naive concatenated hash, no sig_alg.
  delete dsse.sig_alg;
  dsse.signatures[0]!.sig = sha256Digest(`${PUBLIC_DEV_MINT_KEY}:${dsse.payload_digest}`);
  const legacyBytes = packSkill(unpacked.raw);

  const trust = verifyMintTrust(legacyBytes, "minted", {
    allow_development_issuer: true,
    allow_self_reported: true,
  });
  assert.equal(trust.ok, false);
  assert.ok(
    trust.issues.some((i) => i.code === "unsupported_seal_version"),
    `expected unsupported_seal_version, got: ${JSON.stringify(trust.issues)}`,
  );
  assert.ok(!trust.issues.some((i) => i.code === "attestation_sig_invalid"));
});

test("mint seals package and verify-trust accepts development profile with explicit opt-in", () => {
  const recipe = demoRecipe();
  recipe.id = "rcp_mint";
  let compiled = compileRecipeToSkill(recipe, {
    approve_inferred_inputs: true,
    approve_permissions: true,
    host: "cursor",
    profile: "release",
  });
  compiled = approveCompilation(compiled, { inputs: ["*"], permissions: true });
  compiled.files.manifest.needs_human_review = false;
  const before = compiled.files.manifest.package_digest;
  const { packageBytes, files, attestation } = mintSkillPackage(compiled.files, { host: "cursor" });
  assert.equal(files.manifest.mint?.mint_status, "minted");
  assert.equal(files.manifest.package_digest, before);
  assert.equal(files.manifest.mint?.content_id, before);
  assert.ok(files.attestation?.generation_usage?.total_tokens === 1600);
  assert.equal(attestation.agent.runtime, packageIdentity("../../core/package.json").name);
  assert.equal(attestation.agent.version, packageIdentity("../../core/package.json").version);
  assert.equal(attestation.issuer_class, "public_dev_hmac");
  assert.equal(attestation.host_claim_binding, "self_reported");
  assert.ok(attestation.sealed_manifest_digest);
  assert.equal(attestation.sealed_manifest_digest, sealedManifestDigest(files.manifest));
  // Public-dev HMAC must NOT verify as production trust by default.
  assert.equal(verifyMintTrust(packageBytes, "minted").ok, false);
  const trust = verifyMintTrust(packageBytes, "minted", {
    allow_development_issuer: true,
    allow_self_reported: true,
  });
  assert.equal(trust.ok, true, JSON.stringify(trust.issues));
  assert.equal(trust.trust_state, "development");
  const anchored = addPermanenceAnchor(packageBytes, {
    kind: "ledger",
    located_at: "ledger:example/tx/1",
    anchored_at: new Date().toISOString(),
    issuer: "test",
  });
  assert.equal(
    verifyMintTrust(anchored, "anchored", {
      allow_development_issuer: true,
      allow_self_reported: true,
    }).ok,
    true,
  );
});

test("BUG-2: mint never fabricates human approval evidence", () => {
  const recipe = demoRecipe();
  recipe.id = "rcp_bug2_mint";
  let compiled = compileRecipeToSkill(recipe, {
    approve_inferred_inputs: true,
    approve_permissions: true,
    host: "cursor",
    profile: "release",
  });
  compiled = approveCompilation(compiled, { inputs: ["*"], permissions: true });
  compiled.files.manifest.needs_human_review = false;

  // No actor evidence provided — must be an explicit "unattested" marker,
  // never a silently fabricated ["human"].
  const unattested = mintSkillPackage(compiled.files, { host: "cursor" });
  assert.deepEqual(unattested.attestation.human_approvals.actors, []);
  assert.equal(unattested.attestation.human_approvals.attested, false);

  // Real actor evidence, when actually provided, is recorded as-is.
  const attested = mintSkillPackage(compiled.files, {
    host: "cursor",
    actors: ["reviewer@example.com"],
  });
  assert.deepEqual(attested.attestation.human_approvals.actors, ["reviewer@example.com"]);
  assert.equal(attested.attestation.human_approvals.attested, true);
});

test("BUG-2: workspace authorship reflects the agent, never a fabricated human default (SKILL_HOST=cursor)", async () => {
  const { mkdtempSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "skill-ws-authorship-"));
  const prev = process.cwd();
  const prevHost = process.env.SKILL_HOST;
  const prevActor = process.env.SKILL_ACTOR;
  process.chdir(dir);
  process.env.SKILL_HOST = "cursor";
  delete process.env.SKILL_ACTOR;
  try {
    const { initWorkspace, proposeSection, setJourney, saveWorkspaceContract, checkpoint, compileWorkspace } =
      await import("@skillerr/workspace");
    await initWorkspace(dir, { title: "Authorship WS" });
    await setJourney(dir, { summary: "Agent captures notes; no human actor identity supplied." });
    await proposeSection(dir, { title: "Note", body: "Plain legacy text.", type: "doc" });

    const cont = await checkpoint(dir, { message: "WIP" });
    const contAuthors = cont.compile.files.manifest.authors;
    assert.ok(contAuthors && contAuthors[0]!.id.startsWith("agent:"), JSON.stringify(contAuthors));
    assert.notEqual(contAuthors![0]!.id, "human");

    await saveWorkspaceContract(dir, demoContract());
    const rel = await compileWorkspace(dir, { message: "Authorship WS", profile: "release", approve: true, mint: true });
    const relAuthors = rel.compile.files.manifest.authors;
    assert.ok(relAuthors && relAuthors[0]!.id.startsWith("agent:"), JSON.stringify(relAuthors));
    assert.notEqual(relAuthors![0]!.id, "human");
    // Minting without SKILL_ACTOR set must not fabricate an approver either.
    assert.deepEqual(rel.compile.files.attestation?.human_approvals.actors, []);
    assert.equal(rel.compile.files.attestation?.human_approvals.attested, false);
  } finally {
    process.chdir(prev);
    if (prevHost === undefined) delete process.env.SKILL_HOST;
    else process.env.SKILL_HOST = prevHost;
    if (prevActor === undefined) delete process.env.SKILL_ACTOR;
    else process.env.SKILL_ACTOR = prevActor;
  }
});

test("BUG-2: a section file placed on disk with a non-agent source is rejected, not silently relabeled", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "skill-ws-badsource-"));
  const prev = process.cwd();
  const prevHost = process.env.SKILL_HOST;
  process.chdir(dir);
  process.env.SKILL_HOST = "cursor";
  try {
    const { initWorkspace, status } = await import("@skillerr/workspace");
    await initWorkspace(dir, { title: "Bad Source WS" });
    mkdirSync(join(dir, ".skill", "sections"), { recursive: true });
    writeFileSync(
      join(dir, ".skill", "sections", "sec_tampered.json"),
      JSON.stringify({
        kind: "section",
        id: "sec_tampered",
        type: "doc",
        title: "Snuck in",
        body: "Written directly to disk, not via skill propose.",
        fidelity: "exact",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        source: "human",
      }),
    );
    await assert.rejects(() => status(dir), /source="human", not "agent"/);
  } finally {
    process.chdir(prev);
    if (prevHost === undefined) delete process.env.SKILL_HOST;
    else process.env.SKILL_HOST = prevHost;
  }
});

test("cannot mint with reserved non-agent host", () => {
  const recipe = demoRecipe();
  let compiled = compileRecipeToSkill(recipe, {
    approve_inferred_inputs: true,
    approve_permissions: true,
    host: "cursor",
  });
  compiled = approveCompilation(compiled, { inputs: ["*"], permissions: true });
  compiled.files.manifest.needs_human_review = false;
  assert.throws(() => mintSkillPackage(compiled.files, { host: "cli" }), /not a valid AI|denylisted/);
  assert.throws(() => mintSkillPackage(compiled.files, { host: "shell" }), /not a valid AI|denylisted/);
  assert.throws(() => mintSkillPackage(compiled.files, { host: "manual" }), /not a valid AI|denylisted/);
  assert.throws(() => mintSkillPackage(compiled.files, { host: "human" }), /not a valid AI|denylisted/);
});

test("local Ollama agent can compile and mint offline provenance", () => {
  const recipe = demoRecipe();
  recipe.provenance.hosts = ["ollama"];
  recipe.provenance.models = ["llama3.2"];
  const source = recipeToSkillSource(recipe, {
    agent: {
      host: "ollama",
      provider: "ollama",
      deployment: "local",
      endpoint: "http://127.0.0.1:11434/v1",
    },
  });
  let compiled = compileSkillSource(source, {
    profile: "release",
    approve_inferred_inputs: true,
    approve_permissions: true,
  });
  compiled = approveCompilation(compiled, { inputs: ["*"], permissions: true });
  compiled.files.manifest.needs_human_review = false;
  const minted = mintSkillPackage(compiled.files, {
    host: "ollama",
    provider: "ollama",
    model: "llama3.2",
    deployment: "local",
    endpoint: "http://127.0.0.1:11434/v1",
  });
  assert.equal(minted.attestation.host, "ollama");
  assert.equal(minted.attestation.provider, "ollama");
  assert.equal(minted.attestation.deployment, "local");
  assert.equal(minted.attestation.issuer_class, "public_dev_hmac");
  assert.equal(
    verifyMintTrust(minted.packageBytes, "minted", {
      allow_development_issuer: true,
      allow_self_reported: true,
    }).ok,
    true,
  );
});

test("mint refuses a relabeled continuity draft", () => {
  const source = recipeToSkillSource(demoRecipe());
  const continuity = compileSkillSource(source, {
    profile: "continuity",
    approve_inferred_inputs: true,
    approve_permissions: true,
  });
  continuity.files.manifest.compile_profile = "release";
  continuity.files.manifest.completeness!.complete = true;
  continuity.files.manifest.needs_human_review = false;
  assert.throws(
    () => mintSkillPackage(continuity.files, { host: "ollama" }),
    /approved release compilation report required/,
  );
});

test("minted verification and runtime reject missing signature", async () => {
  let compiled = compileRecipeToSkill(demoRecipe(), {
    approve_inferred_inputs: true,
    approve_permissions: true,
    host: "cursor",
    profile: "release",
  });
  compiled = approveCompilation(compiled, { inputs: ["*"], permissions: true });
  compiled.files.manifest.needs_human_review = false;
  const minted = mintSkillPackage(compiled.files, { host: "cursor" });
  const unpacked = unpackSkill(minted.packageBytes);
  unpacked.raw.signatures = {};
  unpacked.raw.attestation = minted.attestation;
  const unsigned = packSkill(unpacked.raw);
  assert.equal(verifyMintTrust(unsigned, "minted").ok, false);
  const run = await runSkillArchive(unsigned, { host: "test" }, { mode: "dry_run" });
  assert.equal(run.status, "failed");
  assert.match(run.error ?? "", /trust verification|validation failed/i);
});

test("journey and endpoint provenance are scrubbed", () => {
  const source = recipeToSkillSource(demoRecipe(), {
    agent: {
      host: "ollama",
      provider: "ollama",
      deployment: "local",
      endpoint: "http://user:sk_supersecret123@example.test/v1",
    },
    journey: {
      summary: "Used token sk_supersecret123 while testing",
    },
  });
  const compiled = compileSkillSource(source, {
    profile: "release",
    approve_inferred_inputs: true,
    approve_permissions: true,
  });
  assert.doesNotMatch(compiled.files.provenance?.journey?.summary ?? "", /supersecret/);
  assert.doesNotMatch(
    JSON.stringify(compiled.files.provenance?.source ?? {}),
    /supersecret/,
  );
});

test("BUG-3: secret redaction skips hex digests (git SHAs, content hashes) but still redacts real secrets, and reports every redaction", () => {
  const gitSha = "a".repeat(40); // 40-char hex — looks like a git SHA, not a secret
  const contentDigest = "b".repeat(64); // 64-char hex — looks like a sha256 digest
  const realSecret = "sk-" + "Xy9".repeat(14); // sk-prefixed, not hex-only
  const contract = demoContract();
  contract.steps = {
    status: "specified",
    items: [
      {
        id: "connect",
        title: "Connect API",
        kind: "instruct",
        instruction: `Call using ${realSecret}.`,
      },
      { id: "emit", title: "Emit result", kind: "emit", output: "result", from: "connect" },
    ],
  };
  const source: SkillSource = {
    kind: "skill_source",
    id: "src_redact",
    hash: "sha256:" + "c".repeat(64),
    title: contract.title,
    contract,
    sections: [
      {
        id: "sec_1",
        revision: 1,
        type: "doc",
        title: "Notes",
        body: `Built from commit ${gitSha} (content digest ${contentDigest}). Token: ${realSecret}`,
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
    journey: { summary: "Redaction fixture.", redacted: true, sensitivity: "private" },
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
  const body = compiled.files.knowledge[0]!.body;
  assert.match(body, new RegExp(gitSha), "hex git SHA must survive redaction unchanged");
  assert.match(body, new RegExp(contentDigest), "hex content digest must survive redaction unchanged");
  assert.doesNotMatch(body, /sk-/, "a real secret-shaped token must still be redacted");
  assert.match(body, /\{\{secret_ref\}\}/);

  const report = compiled.files.provenance?.compilation_report;
  assert.ok(
    report?.issues.some((i) => i.code === "secret_redacted" && i.related?.includes("sec_1")),
    `expected a secret_redacted issue, got: ${JSON.stringify(report?.issues)}`,
  );
});

test("BUG-3: a contract step missing its kind-required field is flagged, not silently compiled as empty text", () => {
  const contract = demoContract();
  contract.steps = {
    status: "specified",
    items: [
      // "instruct" with no `instruction` — compileContractStep would otherwise
      // silently fall back to text:"" with zero signal that anything is wrong.
      { id: "connect", title: "Connect API", kind: "instruct" },
      { id: "emit", title: "Emit result", kind: "emit", output: "result", from: "connect" },
    ],
  };
  const assessment = assessSkillContract(contract, "release");
  assert.equal(assessment.complete, false);
  assert.ok(
    assessment.issues.some(
      (i) => i.field === "steps" && i.message.includes("lacks instruction"),
    ),
    `expected a steps issue about the missing instruction, got: ${JSON.stringify(assessment.issues)}`,
  );
});

test("BUG-3: verify refuses a stripped issuer_class instead of reconstructing it from key_id", () => {
  const recipe = demoRecipe();
  recipe.id = "rcp_bug3_issuer";
  let compiled = compileRecipeToSkill(recipe, {
    approve_inferred_inputs: true,
    approve_permissions: true,
    host: "cursor",
    profile: "release",
  });
  compiled = approveCompilation(compiled, { inputs: ["*"], permissions: true });
  compiled.files.manifest.needs_human_review = false;
  const { packageBytes } = mintSkillPackage(compiled.files, { host: "cursor" });

  // Simulate an attacker stripping issuer_class from an otherwise-valid
  // public-dev-HMAC-sealed package to see if verify silently reconstructs a
  // (possibly more trusted-looking) class from key_id instead of refusing.
  const unpacked = unpackSkill(packageBytes);
  const dsse = unpacked.raw.signatures?.["creation.dsse.json"] as {
    attestation: Record<string, unknown>;
  };
  delete dsse.attestation.issuer_class;
  const tampered = packSkill({ ...unpacked.raw, signatures: unpacked.raw.signatures });

  const trust = verifyMintTrust(tampered, "minted", {
    allow_development_issuer: true,
    allow_self_reported: true,
  });
  assert.equal(trust.ok, false);
  assert.ok(
    trust.issues.some((i) => i.code === "missing_issuer_class"),
    `expected missing_issuer_class, got: ${JSON.stringify(trust.issues)}`,
  );
  // Must not be laundered into a higher-trust label than the true (stripped) class.
  assert.notEqual(trust.trust_state, "verified_issuer");
});

test("BUG-3: workspace status() does not swallow errors, only the expected missing-agent-host case", async () => {
  const { mkdtempSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "skill-ws-status-"));
  const prev = process.cwd();
  const prevHost = process.env.SKILL_HOST;
  process.chdir(dir);
  try {
    const { initWorkspace, proposeSection, status } = await import("@skillerr/workspace");
    process.env.SKILL_HOST = "cursor";
    await initWorkspace(dir, { title: "Status WS" });
    await proposeSection(dir, { title: "Note", body: "Plain text.", type: "doc" });

    // Expected case: no valid agent host — status() must not throw, just
    // omit completeness (agent_host_ok already reports the reason).
    delete process.env.SKILL_HOST;
    const st = await status(dir);
    assert.equal(st.completeness, undefined);
    assert.equal(st.agent_host_ok, false);
  } finally {
    process.chdir(prev);
    if (prevHost === undefined) delete process.env.SKILL_HOST;
    else process.env.SKILL_HOST = prevHost;
  }
});

test("registry local log publish and lookup", async () => {
  const logPath = join(tmpdir(), `skillerr-test-${Date.now()}.jsonl`);
  const digest = "sha256:" + "c".repeat(64);
  const result = await publish(digest, { title: "test" }, logPath);
  assert.equal(result.ok, true);
  assert.equal(result.entry.digest, digest);

  const found = await lookup(digest, logPath);
  assert.equal(found.found, true);
  assert.equal(found.entries.length, 1);

  const notFound = await lookup("sha256:" + "d".repeat(64), logPath);
  assert.equal(notFound.found, false);

  const entries = await list(logPath, 10);
  assert.equal(entries.length, 1);
});

test("workspace legacy sections checkpoint for continuity but refuse release", async () => {
  const { mkdtempSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "skill-ws-"));
  const prev = process.cwd();
  const prevHost = process.env.SKILL_HOST;
  const prevAgentRuntime = process.env.SKILL_AGENT_RUNTIME;
  const prevAgentVersion = process.env.SKILL_AGENT_VERSION;
  process.chdir(dir);
  process.env.SKILL_HOST = "cursor";
  process.env.SKILL_MODEL = "test";
  process.env.SKILL_INPUT_TOKENS = "100";
  process.env.SKILL_OUTPUT_TOKENS = "50";
  delete process.env.SKILL_AGENT_RUNTIME;
  delete process.env.SKILL_AGENT_VERSION;
  try {
    const {
      initWorkspace,
      proposeMany,
      compileWorkspace,
      checkpoint,
      status,
      setJourney,
      loadSkillHandoff,
    } = await import("@skillerr/workspace");
    await initWorkspace(dir, { title: "WS" });
    await setJourney(dir, {
      summary: "Building auth flow with agent; tokens as secret refs only.",
      open_questions: ["Which OAuth provider?"],
    });
    await proposeMany(dir, [
      { title: "A", body: "Decision A stays fixed forever in this skill.", type: "decision" },
      {
        title: "B",
        body: "Call the service at {{base_url}} with retries.",
        type: "integration",
      },
    ]);
    const st = await status(dir);
    assert.equal(st.staged.length, 2);

    const cont = await checkpoint(dir, { message: "WIP auth" });
    assert.equal(cont.profile, "continuity");
    assert.ok(cont.package_path.endsWith(".skill"));
    const handoff = await loadSkillHandoff(cont.package_path);
    assert.ok(handoff.journey);
    assert.equal(handoff.compile_profile, "continuity");

    await assert.rejects(
      () =>
        compileWorkspace(dir, {
          message: "WS skill",
          mint: true,
          approve: true,
          profile: "release",
        }),
      (error: unknown) =>
        error instanceof CompileRefusalError && error.missing.includes("semantic_contract"),
    );
  } finally {
    process.chdir(prev);
    if (prevHost === undefined) delete process.env.SKILL_HOST;
    else process.env.SKILL_HOST = prevHost;
    if (prevAgentRuntime === undefined) delete process.env.SKILL_AGENT_RUNTIME;
    else process.env.SKILL_AGENT_RUNTIME = prevAgentRuntime;
    if (prevAgentVersion === undefined) delete process.env.SKILL_AGENT_VERSION;
    else process.env.SKILL_AGENT_VERSION = prevAgentVersion;
  }
});

test("propose without agent provenance is rejected", async () => {
  const { mkdtempSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "skill-ws-human-"));
  const prevHost = process.env.SKILL_HOST;
  delete process.env.SKILL_HOST;
  try {
    const { initWorkspace, proposeSection } = await import("@skillerr/workspace");
    await initWorkspace(dir, { title: "Nope" });
    await assert.rejects(
      () => proposeSection(dir, { title: "x", body: "y" }),
      /AI agent provenance required/,
    );
  } finally {
    if (prevHost === undefined) delete process.env.SKILL_HOST;
    else process.env.SKILL_HOST = prevHost;
  }
});

test("BUG-1: workspace-authored .skill/contract.json survives into a release compile", async () => {
  const { mkdtempSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "skill-ws-contract-"));
  const prev = process.cwd();
  const prevHost = process.env.SKILL_HOST;
  process.chdir(dir);
  process.env.SKILL_HOST = "cursor";
  try {
    const { initWorkspace, proposeSection, setJourney, saveWorkspaceContract, compileWorkspace } =
      await import("@skillerr/workspace");
    await initWorkspace(dir, { title: "Contract WS" });
    await setJourney(dir, { summary: "Agent authored a reviewed contract for this workspace." });
    await saveWorkspaceContract(dir, demoContract());
    await proposeSection(dir, {
      id: "ing_1",
      title: "Design note",
      body: "Retry twice on 429 against the configured base_url.",
      type: "implementation_note",
    });

    // Release must no longer refuse now that a contract is attached — this is
    // the core regression: before the fix, compileWorkspace() never set
    // source.contract, so release ALWAYS threw compile_refused.
    const result = await compileWorkspace(dir, {
      message: "Contract WS",
      profile: "release",
      approve: true,
    });
    assert.equal(result.profile, "release");
    assert.deepEqual(result.compile.files.manifest.contract, demoContract());
    assert.equal(result.compile.completeness.complete, true);
  } finally {
    process.chdir(prev);
    if (prevHost === undefined) delete process.env.SKILL_HOST;
    else process.env.SKILL_HOST = prevHost;
  }
});

test("BUG-1: absent .skill contract is a loud contract_missing entry on continuity, not silent", async () => {
  const { mkdtempSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "skill-ws-nocontract-"));
  const prev = process.cwd();
  const prevHost = process.env.SKILL_HOST;
  process.chdir(dir);
  process.env.SKILL_HOST = "cursor";
  try {
    const { initWorkspace, proposeSection, setJourney, checkpoint } = await import(
      "@skillerr/workspace"
    );
    await initWorkspace(dir, { title: "No Contract WS" });
    await setJourney(dir, { summary: "Agent captured notes; no contract authored yet." });
    await proposeSection(dir, { title: "Note", body: "Plain legacy text.", type: "doc" });

    const cont = await checkpoint(dir, { message: "WIP" });
    const issues = cont.compile.files.provenance?.compilation_report?.issues ?? [];
    assert.ok(
      issues.some((i) => i.code === "contract_missing"),
      `expected a contract_missing issue, got: ${JSON.stringify(issues)}`,
    );
  } finally {
    process.chdir(prev);
    if (prevHost === undefined) delete process.env.SKILL_HOST;
    else process.env.SKILL_HOST = prevHost;
  }
});

test("BUG-1: unparsable .skill/contract.json refuses release and flags contract_unparsable on continuity", async () => {
  const { mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "skill-ws-badcontract-"));
  const prev = process.cwd();
  const prevHost = process.env.SKILL_HOST;
  process.chdir(dir);
  process.env.SKILL_HOST = "cursor";
  try {
    const { initWorkspace, proposeSection, setJourney, checkpoint, compileWorkspace } =
      await import("@skillerr/workspace");
    await initWorkspace(dir, { title: "Bad Contract WS" });
    await setJourney(dir, { summary: "Agent wrote a broken contract file by mistake." });
    await proposeSection(dir, { title: "Note", body: "Plain legacy text.", type: "doc" });
    mkdirSync(join(dir, ".skill"), { recursive: true });
    writeFileSync(join(dir, ".skill", "contract.json"), JSON.stringify({ not: "a contract" }));

    const cont = await checkpoint(dir, { message: "WIP" });
    const issues = cont.compile.files.provenance?.compilation_report?.issues ?? [];
    assert.ok(
      issues.some(
        (i) => i.code === "contract_unparsable" && i.message.includes("does not look like a SkillContract"),
      ),
      `expected a contract_unparsable issue, got: ${JSON.stringify(issues)}`,
    );

    await assert.rejects(
      () => compileWorkspace(dir, { message: "Bad Contract WS", profile: "release", approve: true }),
      (error: unknown) =>
        error instanceof CompileRefusalError &&
        error.missing.includes("semantic_contract") &&
        error.hints.some((h) => h.includes("could not be used")),
    );
  } finally {
    process.chdir(prev);
    if (prevHost === undefined) delete process.env.SKILL_HOST;
    else process.env.SKILL_HOST = prevHost;
  }
});

test("BUG-1 parity: skill pack <source.json> and workspace compile agree on manifest.contract for the same contract", async () => {
  const { mkdtempSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "skill-ws-parity-"));
  const prev = process.cwd();
  const prevHost = process.env.SKILL_HOST;
  process.chdir(dir);
  process.env.SKILL_HOST = "cursor";
  try {
    const contract = demoContract();

    const directSource: SkillSource = {
      kind: "skill_source",
      id: "src_parity",
      hash: "sha256:" + "b".repeat(64),
      title: contract.title,
      contract,
      sections: [],
      steering: [],
      prompts: [],
      code_refs: [],
      parents: [],
      agent: { host: "cursor" },
      journey: { summary: "Direct source parity fixture.", redacted: true, sensitivity: "private" },
      inputs_declared: "none",
      sensitivity: "private",
      created_at: "2026-07-13T00:00:00.000Z",
      actor: { id: "test-agent" },
      source_protocol_version: PROTOCOL_VERSION,
    };
    const direct = compileSkillSource(directSource, { profile: "release", approve_inferred_inputs: true, approve_permissions: true });

    const { initWorkspace, proposeSection, setJourney, saveWorkspaceContract, compileWorkspace } =
      await import("@skillerr/workspace");
    await initWorkspace(dir, { title: contract.title });
    await setJourney(dir, { summary: "Workspace parity fixture." });
    await saveWorkspaceContract(dir, contract);
    await proposeSection(dir, { title: "Note", body: "unused for a contract-driven compile", type: "doc" });
    const viaWorkspace = await compileWorkspace(dir, {
      message: contract.title,
      profile: "release",
      approve: true,
    });

    // Full package byte-equivalence needs deterministic packing (SEC-J) and
    // content-addressed ids (PROTO-1), which land separately. What BUG-1
    // guarantees today: the authored contract itself is carried through
    // either path with zero loss.
    assert.deepEqual(direct.files.manifest.contract, viaWorkspace.compile.files.manifest.contract);
    assert.deepEqual(direct.files.manifest.contract, contract);
  } finally {
    process.chdir(prev);
    if (prevHost === undefined) delete process.env.SKILL_HOST;
    else process.env.SKILL_HOST = prevHost;
  }
});

test("P0: human-fake SKILL_HOST cannot mint as trusted", () => {
  let compiled = compileRecipeToSkill(demoRecipe(), {
    approve_inferred_inputs: true,
    approve_permissions: true,
    host: "cursor",
    profile: "release",
  });
  compiled = approveCompilation(compiled, { inputs: ["*"], permissions: true });
  compiled.files.manifest.needs_human_review = false;

  // Human exporting SKILL_HOST=cursor with no agent markers → self_reported + public_dev.
  const minted = mintSkillPackage(compiled.files, {
    host: "cursor",
    env: {}, // no agent runtime markers
  });
  assert.equal(minted.attestation.host_claim_binding, "self_reported");
  assert.equal(minted.attestation.issuer_class, "public_dev_hmac");
  const untrusted = verifyMintTrust(minted.packageBytes, "minted");
  assert.equal(untrusted.ok, false);
  // Structurally a development seal — never production-trusted.
  assert.equal(untrusted.trust_state, "development");
  assert.ok(untrusted.issues.some((i) => i.code === "public_dev_issuer_untrusted"));

  // Even with markers, public-dev HMAC is still not production trust.
  const withMarkers = mintSkillPackage(compiled.files, {
    host: "cursor",
    env: { SKILL_AGENT_INVOCATION: "1" },
  });
  assert.ok(withMarkers.attestation.agent_runtime_markers?.includes("SKILL_AGENT_INVOCATION"));
  assert.equal(withMarkers.attestation.issuer_class, "public_dev_hmac");
  assert.equal(verifyMintTrust(withMarkers.packageBytes, "minted").ok, false);

  // verified_issuer refused with public-dev key
  assert.throws(
    () =>
      mintSkillPackage(compiled.files, {
        host: "cursor",
        host_claim_binding: "verified_issuer",
        agent_runtime_evidence: { markers: ["SKILL_AGENT_INVOCATION"] },
      }),
    /public development HMAC/,
  );

  // Configured issuer + evidence → verified_issuer; production verify needs the secret.
  const secret = "test-issuer-secret-not-public";
  const verified = mintSkillPackage(compiled.files, {
    host: "cursor",
    issuer_secret: secret,
    key_id: "test-issuer",
    host_claim_binding: "verified_issuer",
    agent_runtime_evidence: { session_id: "ses_test", markers: ["SKILL_AGENT_INVOCATION"] },
  });
  assert.equal(verified.attestation.host_claim_binding, "verified_issuer");
  assert.equal(verified.attestation.issuer_class, "configured_hmac");
  assert.equal(verifyMintTrust(verified.packageBytes, "minted", { issuer_secret: secret }).ok, true);
  assert.equal(
    verifyMintTrust(verified.packageBytes, "minted", { issuer_secret: secret }).trust_state,
    "verified_issuer",
  );
});

test("SEC-I: inspectSkill labels a minted package's seal as an unverified claim, not a confident SEALED", () => {
  const recipe = demoRecipe();
  recipe.id = "rcp_seci_real";
  let compiled = compileRecipeToSkill(recipe, {
    approve_inferred_inputs: true,
    approve_permissions: true,
    host: "cursor",
    profile: "release",
  });
  compiled = approveCompilation(compiled, { inputs: ["*"], permissions: true });
  compiled.files.manifest.needs_human_review = false;
  const { packageBytes } = mintSkillPackage(compiled.files, { host: "cursor" });

  const inspected = inspectSkill(packageBytes);
  assert.equal(inspected.summary.mint_status, "minted");
  assert.match(inspected.summary.trust_label ?? "", /unverified/i);
  assert.doesNotMatch(inspected.summary.trust_label ?? "", /^SEALED/);
  assert.equal(inspected.summary.trust_state, "self_reported");
});

test("SEC-I: a forged mint_status/attestation_digest without a real signature is labeled unverified, and the deep trust check still refuses it", () => {
  const recipe = demoRecipe();
  recipe.id = "rcp_seci_forged";
  const compiled = compileRecipeToSkill(recipe, {
    approve_inferred_inputs: true,
    approve_permissions: true,
    host: "cursor",
    profile: "release",
  });
  // Forge mint_status + attestation_digest by hand — no signatures/
  // artifact backs this claim. attestation_digest/mint_status aren't part
  // of manifest_digest's claim set (SEC-F), so this specific tampering
  // still passes structural validate(); inspectSkill's label must not
  // read as more confident than "claims sealed, unverified".
  const forged: SkillPackageFiles = {
    ...compiled.files,
    manifest: {
      ...compiled.files.manifest,
      mint: { mint_status: "minted", minted_at: new Date().toISOString(), mint_issuer: "forger" },
      attestation_digest: "sha256:" + "f".repeat(64),
    },
  };
  const bytes = packSkill(forged);

  const inspected = inspectSkill(bytes);
  assert.equal(inspected.summary.mint_status, "minted");
  assert.match(inspected.summary.trust_label ?? "", /unverified/i);

  // The deep check is unfooled: no real attestation/signature exists.
  const trust = verifyMintTrust(bytes, "minted", {
    allow_development_issuer: true,
    allow_self_reported: true,
  });
  assert.equal(trust.ok, false);
  assert.ok(trust.issues.some((i) => i.code === "missing_attestation"));
});

test("P0: inspect --trust TrustView without compile", () => {
  let compiled = compileRecipeToSkill(demoRecipe(), {
    approve_inferred_inputs: true,
    approve_permissions: true,
    host: "cursor",
    profile: "release",
  });
  compiled = approveCompilation(compiled, { inputs: ["*"], permissions: true });
  compiled.files.manifest.needs_human_review = false;

  const draftView = inspectTrustView(compiled.packageBytes);
  assert.equal(draftView.trust_state, "untrusted");
  assert.match(draftView.label, /UNSIGNED|untrusted/i);
  assert.equal(draftView.signed, false);
  assert.ok(draftView.package_digest.startsWith("sha256:"));

  const minted = mintSkillPackage(compiled.files, {
    host: "cursor",
    provider: "cursor",
    model: "test-model",
  });
  const view = inspectTrustView(minted.packageBytes);
  assert.equal(view.trust_state, "development");
  assert.match(view.label, /DEVELOPMENT|public-dev/i);
  assert.equal(view.signed, true);
  assert.equal(view.agent?.host, "cursor");
  assert.equal(view.agent?.model, "test-model");
  assert.equal(view.issuer_class, "public_dev_hmac");
  assert.ok(view.sealed_manifest_digest?.startsWith("sha256:"));
  assert.ok(view.package_digest.startsWith("sha256:"));
  // TrustView must not require feeding prompts/knowledge to a model — it is pure metadata.
  assert.ok(!("knowledge" in view));
  assert.ok(!("workflow" in view));
});

test("P0: undeclared network capability is refused", async () => {
  let compiled = compileRecipeToSkill(demoRecipe(), {
    approve_inferred_inputs: true,
    approve_permissions: true,
    host: "cursor",
    profile: "release",
  });
  compiled = approveCompilation(compiled, { inputs: ["*"], permissions: true });
  const netCap = {
    name: "http.fetch",
    description: "Fetch URL",
    side_effect_class: "network" as const,
    fallback: "fail" as const,
    required: false,
  };
  compiled.files.manifest.capabilities.push(netCap);
  compiled.files.workflow.steps = [
    {
      id: "sneaky_net",
      kind: "tool",
      capability: "http.fetch",
      arguments: { url: "https://evil.example" },
    },
  ];
  compiled.files.workflow.entrypoint = "sneaky_net";
  compiled.files.manifest.entrypoint = "sneaky_net";

  assert.throws(
    () => assertCapabilityAllowed(compiled.files, netCap, { url: "https://evil.example" }),
    /allow_network=false|deny-by-default/,
  );

  const run = await runSkillPackage(
    compiled.files,
    {
      host: "cursor",
      adapters: [
        {
          name: "http",
          supports: (c) => c.name === "http.fetch",
          invoke: async () => ({ ok: true, result: { leaked: true }, adapter: { kind: "http" } }),
        },
      ],
    },
    {
      mode: "dry_run",
      inputs: { base_url: "https://example.com", api_credential_ref: "secret:local" },
    },
  );
  assert.equal(run.status, "failed");
  assert.match(run.error ?? "", /allow_network=false|Denied/);
});

function minimalPackage(overrides: {
  policy?: Partial<typeof DEFAULT_SKILL_POLICY>;
  permissions?: SkillPackageFiles["manifest"]["permissions"];
}): SkillPackageFiles {
  return {
    manifest: {
      kind: "dot-skill",
      id: "skl_secfix",
      version: "1.0.0",
      title: "SEC fixture",
      description: "SEC-A/B/H fixture",
      container_version: CONTAINER_VERSION,
      protocol_version: PROTOCOL_VERSION,
      entrypoint: "s1",
      inputs: [],
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
      dialect_version: WORKFLOW_DIALECT_VERSION,
      entrypoint: "s1",
      steps: [{ id: "s1", kind: "instruct", text: "x" }],
    },
    knowledge: [],
  };
}

test("SEC-A: network host allowlist compares real hostnames, not substrings/prefixes", () => {
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

  // Substring bypass: "example.com" appears inside the URL, but the real host is evil.com.
  assert.throws(
    () => assertCapabilityAllowed(pkg, netCap, { url: "https://evil.com/?q=example.com" }),
    /not in declared permission.hosts/,
  );
  // Prefix bypass: startsWith("example.com") is true, but the real host is a different domain.
  assert.throws(
    () => assertCapabilityAllowed(pkg, netCap, { host: "example.com.attacker.io" }),
    /not in declared permission.hosts/,
  );
  // No attributable host at all — deny rather than silently allow.
  assert.throws(
    () => assertCapabilityAllowed(pkg, netCap, {}),
    /not in declared permission.hosts/,
  );
  // The real, legitimately allowlisted host still works.
  assert.doesNotThrow(() => assertCapabilityAllowed(pkg, netCap, { url: "https://example.com/v1" }));

  const wildcardPkg = minimalPackage({
    policy: { allow_network: true },
    permissions: [
      {
        side_effect_class: "network",
        description: "Fetch from any example.com subdomain",
        hosts: ["*.example.com"],
        requires_consent: false,
      },
    ],
  });
  assert.doesNotThrow(() => assertCapabilityAllowed(wildcardPkg, netCap, { host: "api.example.com" }));
  assert.throws(
    () => assertCapabilityAllowed(wildcardPkg, netCap, { host: "notexample.com" }),
    /not in declared permission.hosts/,
  );
});

test("SEC-B: filesystem permission/root checks normalize paths before comparing", () => {
  const readCap = {
    name: "fs.read",
    description: "Read a file",
    side_effect_class: "read" as const,
    fallback: "fail" as const,
    required: false,
  };
  const pkg = minimalPackage({
    policy: { filesystem_roots: ["/data"] },
    permissions: [
      {
        side_effect_class: "read",
        description: "Read within /data",
        paths: ["/data"],
        requires_consent: false,
      },
    ],
  });

  assert.throws(
    () => assertCapabilityAllowed(pkg, readCap, { path: "/data/../etc/passwd" }),
    /outside policy.filesystem_roots/,
  );
  assert.doesNotThrow(() => assertCapabilityAllowed(pkg, readCap, { path: "/data/notes.txt" }));
});

test("SEC-C: normalizePath rejects Windows drive-letter and UNC absolute paths", () => {
  assert.throws(() => normalizePath("C:/evil.txt"), /Unsafe path/);
  assert.throws(() => normalizePath("C:\\evil.txt"), /Unsafe path/);
  assert.throws(() => normalizePath("\\\\server\\share\\evil.txt"), /Unsafe path/);
  assert.equal(normalizePath("knowledge/notes.txt"), "knowledge/notes.txt");
});

test("SEC-H: undeclared read capability is denied like write/destructive, not exempt from deny-by-default", () => {
  const readCap = {
    name: "fs.read",
    description: "Read a file",
    side_effect_class: "read" as const,
    fallback: "fail" as const,
    required: false,
  };
  const pkg = minimalPackage({ permissions: [] });
  assert.throws(
    () => assertCapabilityAllowed(pkg, readCap, { path: "/anything" }),
    /no matching permission is declared/,
  );
});

test("P0: execute refuses unsigned packages without --allow-untrusted", async () => {
  const compiled = compileRecipeToSkill(demoRecipe(), {
    approve_inferred_inputs: true,
    approve_permissions: true,
    host: "cursor",
    profile: "release",
  });
  const run = await runSkillArchive(
    compiled.packageBytes,
    { host: "test" },
    { mode: "execute", inputs: { base_url: "https://example.com", api_credential_ref: "x" } },
  );
  assert.equal(run.status, "failed");
  assert.match(run.error ?? "", /untrusted|UNSIGNED|Refusing execute/i);

  const allowed = await runSkillArchive(
    compiled.packageBytes,
    {
      host: "test",
      consent: async () => ({ allowed: true, actor: "tester", at: new Date().toISOString() }),
      verifyAssertion: async () => ({ passed: true }),
    },
    {
      mode: "execute",
      allow_untrusted: true,
      inputs: { base_url: "https://example.com", api_credential_ref: "x" },
    },
  );
  // May succeed or fail on other gates; must not fail the trust gate.
  assert.notEqual(allowed.error, "Refusing execute of open/untrusted package without --allow-untrusted");
  if (allowed.status === "failed") {
    assert.doesNotMatch(allowed.error ?? "", /Refusing execute:.*UNSIGNED/i);
  }
});

// PHASE 4: bundled-script / progressive-disclosure semantics — a `tool`
// step invoking an `exec`-class capability backed by a bundled script
// under resources/scripts/, exactly the ingest.ts / docs/RESOURCES.md
// pattern. This is also the regression fixture for the exec deny-by-default
// gap this phase found and fixed (assertCapabilityAllowed previously had
// no branch for side_effect_class="exec" at all, unlike read/write/
// destructive/network — see the PHASE 4 comment in runtime/src/index.ts).
function bundledScriptSource(): SkillSource {
  return {
    kind: "skill_source",
    id: "src_bundled_script",
    hash: "sha256:" + "d".repeat(64),
    title: "Bundled lint script",
    contract: {
      kind: "skill_contract",
      contract_version: "0.5",
      skill_kind: "procedure",
      title: "Bundled lint script",
      intent: "Run a bundled lint script against reviewed changelog copy.",
      sensitivity: "private",
      triggers: { status: "specified", items: [{ id: "t1", description: "A changelog draft is ready to lint." }] },
      inputs: { status: "none", reason: "No runtime inputs beyond the bundled script." },
      preconditions: { status: "none", reason: "None." },
      steps: {
        status: "specified",
        items: [
          {
            id: "lint",
            title: "Run lint script",
            kind: "tool",
            capability: "run_lint",
          },
          { id: "emit", title: "Emit result", kind: "emit", output: "result", from: "lint" },
        ],
      },
      branches: { status: "none", reason: "None." },
      human_decisions: { status: "none", reason: "None." },
      capabilities: {
        status: "specified",
        items: [
          {
            name: "run_lint",
            description: "Run resources/scripts/lint.py against the draft.",
            side_effect_class: "exec",
            fallback: "ask_human",
            required: true,
          },
        ],
      },
      permissions: {
        status: "specified",
        items: [
          {
            id: "p_exec",
            side_effect_class: "exec",
            description: "Run the bundled lint script.",
            consent: "explicit_human",
          },
        ],
      },
      forbidden_actions: { status: "none", reason: "None." },
      outputs: {
        status: "specified",
        items: [{ name: "result", description: "Lint result", schema: { type: "string" }, required: true }],
      },
      recovery: { status: "not_applicable", reason: "The script has no destructive side effects." },
      verification: {
        status: "specified",
        items: [{ id: "v1", assertion: "Lint completed.", check: "human", required: true }],
      },
      corrections: { status: "none", reason: "None." },
      provenance: {
        evidence: { status: "none", reason: "None." },
        limitations: { status: "none", reason: "None." },
        human_review: {
          status: "reviewed",
          actor: "test-human",
          at: "2026-07-13T00:00:00.000Z",
          scope: ["complete contract"],
        },
      },
    },
    sections: [],
    steering: [],
    prompts: [],
    code_refs: [],
    parents: [],
    agent: { host: "cursor" },
    journey: { summary: "Bundled-script fixture.", redacted: true, sensitivity: "private" },
    inputs_declared: "none",
    sensitivity: "private",
    created_at: "2026-07-13T00:00:00.000Z",
    actor: { id: "test-agent" },
    source_protocol_version: PROTOCOL_VERSION,
  };
}

test("PHASE 4: a tool step backed by a bundled exec-class script refuses without a declared permission, dry-runs once one is declared", async () => {
  const compiledNoPerm = compileSkillSource(
    { ...bundledScriptSource(), contract: { ...bundledScriptSource().contract!, permissions: { status: "none", reason: "Deliberately omitted for this fixture." } } },
    { profile: "continuity" },
  );
  const runDenied = await runSkillArchive(compiledNoPerm.packageBytes, { host: "test" }, { mode: "dry_run" });
  assert.equal(runDenied.status, "failed");
  assert.match(runDenied.error ?? "", /Denied: capability run_lint uses exec but no matching permission is declared/);

  const compiled = compileSkillSource(bundledScriptSource(), { profile: "continuity" });
  const withResources = {
    ...compiled.files,
    resources: { "scripts/lint.py": "print('ok')\n" },
  };
  const packageBytes = packSkill(withResources);
  const unpacked = unpackSkill(packageBytes);
  assert.ok(Object.keys(unpacked.raw.resources ?? {}).includes("scripts/lint.py"));

  // The overall run may still fail on the unrelated auto-injected verify
  // step (contract.verification's check:"human" item, with no
  // verifyAssertion callback supplied here) — that's not what this fixture
  // is testing. What matters is that the `lint` tool step itself, which
  // was the one denied above, now succeeds once the exec permission exists.
  const runAllowed = await runSkillArchive(packageBytes, { host: "test" }, { mode: "dry_run" });
  const toolStep = runAllowed.steps.find((s) => s.step_id === "lint");
  assert.equal(toolStep?.status, "succeeded");
  assert.equal(runAllowed.steps.find((s) => s.step_id === "emit")?.status, "succeeded");
});
