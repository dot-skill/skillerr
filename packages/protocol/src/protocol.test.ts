/**
 * Package-local unit tests for @skillerr/protocol's pure functions. Before
 * Tier 3, this package had zero direct test coverage of its own — it was
 * only ever exercised indirectly through @skillerr/core and @skillerr/cli.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidAgentHost, FORBIDDEN_AGENT_HOSTS } from "./source.js";
import { assessSkillContract, scaffoldSkillContract, explainContractAssessment } from "./authoring.js";
import { recipeToSkillSource } from "./recipe.js";
import type { Recipe } from "./recipe.js";
import { isValidHostPattern, isValidPathPattern } from "./grammar.js";

test("isValidAgentHost: denylists human/cli/shell-style hosts, allows real agent hosts", () => {
  assert.equal(isValidAgentHost("cursor"), true);
  assert.equal(isValidAgentHost("ollama"), true);
  assert.equal(isValidAgentHost("custom-agent"), true);
  for (const forbidden of FORBIDDEN_AGENT_HOSTS) {
    if (!forbidden) continue;
    assert.equal(isValidAgentHost(forbidden), false, `expected "${forbidden}" to be forbidden`);
  }
  assert.equal(isValidAgentHost(undefined), false);
  assert.equal(isValidAgentHost(""), false);
  // Case/whitespace-insensitive denylist matching.
  assert.equal(isValidAgentHost("  Human  "), false);
});

test("scaffoldSkillContract: placeholder values fail assessment on purpose", () => {
  const scaffold = scaffoldSkillContract();
  const assessment = assessSkillContract(scaffold, "continuity");
  assert.equal(assessment.complete, false);
  assert.ok(assessment.issues.length > 0);
  const explanation = explainContractAssessment(assessment);
  assert.equal(explanation.complete, false);
  assert.equal(explanation.fixes.length, assessment.issues.length);
});

test("assessSkillContract: release requires triggers/steps/verification to be specified, not just none/not_applicable", () => {
  const bare = {
    kind: "skill_contract",
    contract_version: "1.0",
    skill_kind: "knowledge",
    title: "x",
    intent: "x",
    sensitivity: "private",
    triggers: { status: "none", reason: "no reason needed for this test" },
    inputs: { status: "none", reason: "none" },
    preconditions: { status: "none", reason: "none" },
    steps: { status: "none", reason: "none" },
    branches: { status: "none", reason: "none" },
    human_decisions: { status: "none", reason: "none" },
    capabilities: { status: "none", reason: "none" },
    permissions: { status: "none", reason: "none" },
    forbidden_actions: { status: "none", reason: "none" },
    outputs: { status: "none", reason: "none" },
    recovery: { status: "none", reason: "none" },
    verification: { status: "none", reason: "none" },
    corrections: { status: "none", reason: "none" },
    provenance: {
      evidence: { status: "none", reason: "none" },
      limitations: { status: "none", reason: "none" },
      human_review: { status: "reviewed", actor: "a", at: "2026-07-13T00:00:00.000Z", scope: ["x"] },
    },
  };
  const continuity = assessSkillContract(bare, "continuity");
  assert.equal(continuity.complete, true, JSON.stringify(continuity.issues));

  const release = assessSkillContract(bare, "release");
  assert.equal(release.complete, false);
  const profileRequiredFields = release.issues.filter((i) => i.code === "profile_required").map((i) => i.field);
  assert.ok(profileRequiredFields.includes("triggers"));
  assert.ok(profileRequiredFields.includes("steps"));
  assert.ok(profileRequiredFields.includes("verification"));
});

test("recipeToSkillSource: maps a legacy recipe into a protocol-native SkillSource", () => {
  const recipe: Recipe = {
    kind: "recipe",
    id: "rcp_test",
    hash: "sha256:" + "a".repeat(64),
    title: "Legacy recipe",
    summary: "Do the thing with {{base_url}}",
    journey_summary: "Human+agent designed this.",
    ingredients: [
      {
        id: "ing_1",
        revision: 1,
        type: "integration",
        title: "Call the API",
        body: "Call {{base_url}}",
        attachments: [],
        code_refs: [],
        sensitivity: "private",
      },
    ],
    steering: [],
    prompts: [],
    code_refs: [],
    parents: [],
    provenance: { hosts: ["cursor"], models: ["test-model"], session_ids: [] },
    visibility_intent: "private",
    baked_at: "2026-07-13T00:00:00.000Z",
    baker: { id: "test-agent" },
    source_protocol_version: "1.0.0",
  };
  const source = recipeToSkillSource(recipe, { agent: { host: "cursor" } });
  assert.equal(source.kind, "skill_source");
  assert.equal(source.title, recipe.title);
  assert.equal(source.sections.length, 1);
  assert.equal(source.sections[0]!.body, "Call {{base_url}}");
  assert.equal(source.agent.host, "cursor");
  // The {{base_url}} placeholder must be detected so downstream compile
  // knows an input needs to be inferred.
  assert.equal(source.inputs_declared, "inferred");
});

test("PROTO-5: isValidHostPattern accepts exact hosts and *.suffix wildcards, rejects URLs/ports/embedded wildcards", () => {
  assert.equal(isValidHostPattern("example.com"), true);
  assert.equal(isValidHostPattern("api.example.com"), true);
  assert.equal(isValidHostPattern("localhost"), true);
  assert.equal(isValidHostPattern("*.example.com"), true);
  assert.equal(isValidHostPattern("{{registry_host}}"), true);

  assert.equal(isValidHostPattern("https://example.com"), false, "full URL");
  assert.equal(isValidHostPattern("example.com:8080"), false, "port");
  assert.equal(isValidHostPattern("*"), false, "bare wildcard");
  assert.equal(isValidHostPattern("ex*.com"), false, "embedded wildcard");
  assert.equal(isValidHostPattern("*.evil.com/*"), false, "wildcard with path");
  assert.equal(isValidHostPattern(""), false);
  assert.equal(isValidHostPattern(undefined), false);
});

test("PROTO-5: isValidPathPattern accepts absolute normalized paths, rejects traversal/relative/backslashes", () => {
  assert.equal(isValidPathPattern("/data"), true);
  assert.equal(isValidPathPattern("/data/"), true);
  assert.equal(isValidPathPattern("/home/user/project"), true);
  assert.equal(isValidPathPattern("/"), true);
  assert.equal(isValidPathPattern("{{workspace_root}}"), true);

  assert.equal(isValidPathPattern("data"), false, "relative");
  assert.equal(isValidPathPattern("../etc/passwd"), false, "traversal");
  assert.equal(isValidPathPattern("/data/../etc"), false, "embedded traversal");
  assert.equal(isValidPathPattern("C:\\evil"), false, "backslashes");
  assert.equal(isValidPathPattern("/data//sub"), false, "empty segment");
  assert.equal(isValidPathPattern("/data/./sub"), false, "dot segment");
  assert.equal(isValidPathPattern(""), false);
});

test("PROTO-5: assessSkillContract rejects a malformed host/path permission pattern", () => {
  const contract = {
    kind: "skill_contract",
    contract_version: "1.0",
    skill_kind: "integration",
    title: "x",
    intent: "x",
    sensitivity: "private",
    triggers: { status: "none", reason: "none" },
    inputs: { status: "none", reason: "none" },
    preconditions: { status: "none", reason: "none" },
    steps: { status: "none", reason: "none" },
    branches: { status: "none", reason: "none" },
    human_decisions: { status: "none", reason: "none" },
    capabilities: { status: "none", reason: "none" },
    permissions: {
      status: "specified",
      items: [
        {
          id: "bad_net",
          side_effect_class: "network",
          description: "x",
          hosts: ["https://evil.com/?q=example.com"],
          consent: "none",
        },
      ],
    },
    forbidden_actions: { status: "none", reason: "none" },
    outputs: { status: "none", reason: "none" },
    recovery: { status: "none", reason: "none" },
    verification: { status: "none", reason: "none" },
    corrections: { status: "none", reason: "none" },
    provenance: {
      evidence: { status: "none", reason: "none" },
      limitations: { status: "none", reason: "none" },
      human_review: { status: "not_reviewed" },
    },
  };
  const assessment = assessSkillContract(contract, "continuity");
  assert.equal(assessment.complete, false);
  assert.ok(
    assessment.issues.some((i) => i.field === "permissions" && i.message.includes("invalid host pattern")),
  );
});

test("assessSkillContract: a plain string item is flagged, not silently accepted as complete", () => {
  // Regression for a real bug: declaration.items' JSON Schema type is
  // (object | string), but every consumer downstream (compile.ts's
  // permissions/inputs/branches/human_decisions mapping, hash.ts's sort by
  // .name) assumes an object. A string item used to pass validateItems
  // silently (it bailed out on non-object items instead of flagging them),
  // so contract-check reported "complete" on a contract that then crashed
  // at compile/mint time. Every field sharing this shape has the same bug;
  // permissions is the field the crash was originally reported against.
  const contract = {
    kind: "skill_contract",
    contract_version: "1.0",
    skill_kind: "integration",
    title: "x",
    intent: "x",
    sensitivity: "private",
    triggers: { status: "none", reason: "none" },
    inputs: { status: "none", reason: "none" },
    preconditions: { status: "none", reason: "none" },
    steps: { status: "none", reason: "none" },
    branches: { status: "none", reason: "none" },
    human_decisions: { status: "none", reason: "none" },
    capabilities: { status: "none", reason: "none" },
    permissions: { status: "specified", items: ["read files in the project directory"] },
    forbidden_actions: { status: "none", reason: "none" },
    outputs: { status: "none", reason: "none" },
    recovery: { status: "none", reason: "none" },
    verification: { status: "none", reason: "none" },
    corrections: { status: "none", reason: "none" },
    provenance: {
      evidence: { status: "none", reason: "none" },
      limitations: { status: "none", reason: "none" },
      human_review: { status: "not_reviewed" },
    },
  };
  const assessment = assessSkillContract(contract, "continuity");
  assert.equal(assessment.complete, false);
  assert.ok(
    assessment.issues.some(
      (i) => i.field === "permissions" && i.message.includes("must be an object"),
    ),
  );
});
