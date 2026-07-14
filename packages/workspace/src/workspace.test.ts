/**
 * Package-local unit tests for @skillerr/workspace, run directly against
 * this package. The full propose -> stage -> checkpoint/compile lifecycle
 * is covered end-to-end by @skillerr/cli's conformance and adversarial
 * suites; this file targets a few isolated primitives package-locally
 * (Tier 3: root npm test only ran @skillerr/cli).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import {
  requireAgentHost,
  initWorkspace,
  loadWorkspaceContract,
  saveWorkspaceContract,
  proposeSection,
  stage,
  compileWorkspace,
} from "./index.js";
import type { BenchmarkReport, SkillContract } from "@skillerr/protocol";

test("requireAgentHost: throws for denylisted/missing hosts, returns a valid one", () => {
  assert.throws(() => requireAgentHost("human"), /AI agent provenance required/);
  assert.throws(() => requireAgentHost(undefined), /AI agent provenance required/);
  assert.equal(requireAgentHost("cursor"), "cursor");
});

test("loadWorkspaceContract: absent file is a silent {} (no error) — no contract authored yet", async () => {
  const dir = mkdtempSync(join(tmpdir(), "skill-ws-unit-"));
  await initWorkspace(dir, { title: "Unit" });
  const result = await loadWorkspaceContract(dir);
  assert.deepEqual(result, {});
});

test("saveWorkspaceContract + loadWorkspaceContract: round-trips a valid contract", async () => {
  const dir = mkdtempSync(join(tmpdir(), "skill-ws-unit-"));
  await initWorkspace(dir, { title: "Unit" });
  const contract: SkillContract = {
    kind: "skill_contract",
    contract_version: "1.0",
    skill_kind: "knowledge",
    title: "Unit contract",
    intent: "Round-trip test.",
    sensitivity: "private",
    triggers: { status: "none", reason: "none" },
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
      human_review: { status: "not_reviewed" },
    },
  };
  await saveWorkspaceContract(dir, contract);
  const result = await loadWorkspaceContract(dir);
  assert.deepEqual(result.contract, contract);
  assert.equal(result.error, undefined);
});

test("loadWorkspaceContract: a file that doesn't look like a SkillContract is a loud error, not a silent miss", async () => {
  const dir = mkdtempSync(join(tmpdir(), "skill-ws-unit-"));
  await initWorkspace(dir, { title: "Unit" });
  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync(join(dir, ".skill"), { recursive: true });
  writeFileSync(join(dir, ".skill", "contract.json"), "not json{{{");
  const result = await loadWorkspaceContract(dir);
  assert.equal(result.contract, undefined);
  assert.match(result.error ?? "", /not valid JSON/);
});

test("PHASE 2: compileWorkspace seals a pre-written .skill/benchmark.json into provenance/benchmark.json, and its absence changes nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "skill-ws-unit-"));
  await initWorkspace(dir, { title: "Eval attach unit" });
  await proposeSection(dir, { title: "Note", body: "Body text.", host: "cursor" });
  await stage(dir, "all");

  const withoutBenchmark = await compileWorkspace(dir, { profile: "continuity", host: "cursor" });
  assert.equal(withoutBenchmark.compile.files.provenance?.benchmark, undefined);

  const benchmark: BenchmarkReport = {
    kind: "benchmark_report",
    skill_id: "skl_placeholder",
    host: "cursor",
    created_at: "2026-07-13T00:00:00.000Z",
    cases: [
      {
        id: "e1",
        prompt: "test prompt",
        executable: true,
        duration_ms: 5,
        assertions: [
          { id: "a1", assertion: 'contains: "x"', check: "runtime", status: "pass" },
        ],
      },
    ],
    summary: { total_cases: 1, total_assertions: 1, pass: 1, fail: 0, partial: 0, pending_human: 0 },
  };
  writeFileSync(join(dir, ".skill", "benchmark.json"), JSON.stringify(benchmark, null, 2));

  const withBenchmark = await compileWorkspace(dir, { profile: "continuity", host: "cursor" });
  assert.deepEqual(withBenchmark.compile.files.provenance?.benchmark, benchmark);
  // The seal must actually be in the repacked bytes, not just the in-memory files object.
  const { unpackSkill } = await import("@skillerr/core");
  const unpacked = unpackSkill(withBenchmark.compile.packageBytes);
  assert.deepEqual(unpacked.raw.provenance?.benchmark, benchmark);
});
