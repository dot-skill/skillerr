import assert from "node:assert/strict";
import { test } from "node:test";
import type { BenchmarkReport, SkillManifest } from "@skillerr/protocol";
import { buildSkillAssessment } from "./score-adapter.js";

function manifest(overrides: Partial<SkillManifest> = {}): SkillManifest {
  return {
    kind: "dot-skill",
    id: "skl_test",
    version: "1.0.0",
    title: "Test",
    description: "Test skill",
    container_version: "1.0",
    protocol_version: "1.0.0",
    entrypoint: "s1",
    inputs: [],
    outputs: [],
    capabilities: [],
    permissions: [],
    policy: {
      require_signatures: false,
      require_minted: false,
      require_anchor: false,
      max_runtime_ms: 600000,
      max_tool_calls: 200,
      allow_network: false,
      consent_for: [],
      fail_on_unsupported_step: true,
      trust_profile: "open",
    },
    content: [],
    package_digest: "sha256:" + "a".repeat(64),
    manifest_digest: "sha256:" + "b".repeat(64),
    provenance_mode: "full",
    completeness: { kind: "completeness_report", profile: "release", complete: true, present: [], missing: [], hints: [] },
    ...overrides,
  };
}

function benchmark(overrides: Partial<BenchmarkReport> = {}): BenchmarkReport {
  return {
    kind: "benchmark_report",
    skill_id: "skl_test",
    host: "cursor",
    created_at: "2026-07-13T00:00:00.000Z",
    cases: [
      {
        id: "e1",
        prompt: "test prompt",
        executable: true,
        duration_ms: 10,
        assertions: [
          { id: "a1", assertion: 'contains: "x"', check: "runtime", status: "pass" },
          { id: "a2", assertion: "manual check", check: "human", status: "pending_human" },
        ],
      },
    ],
    summary: { total_cases: 1, total_assertions: 2, pass: 1, fail: 0, partial: 0, pending_human: 1 },
    ...overrides,
  };
}

test("buildSkillAssessment: a natively-authored, validated skill gets 'observed' structural/provenance evidence", () => {
  const assessment = buildSkillAssessment({ manifest: manifest(), valid: true });
  const structural = assessment.evidence.find((e) => e.id === "structural_completeness")!;
  const provenance = assessment.evidence.find((e) => e.id === "provenance_integrity")!;
  assert.equal(structural.kind, "observed");
  assert.equal(structural.status, "pass");
  assert.equal(provenance.kind, "observed");
  assert.equal(provenance.status, "pass");
});

test("buildSkillAssessment: a SKILL.md-ingested skill's structural/provenance evidence is tiered self-reported, not observed — not a quality judgment, an honesty one", () => {
  const assessment = buildSkillAssessment({
    manifest: manifest(),
    valid: true,
    provenanceSource: { source_refs: [{ product: "skill-md-ingest", kind: "automated_ingest", id: "SKILL.md" }] },
  });
  const structural = assessment.evidence.find((e) => e.id === "structural_completeness")!;
  const provenance = assessment.evidence.find((e) => e.id === "provenance_integrity")!;
  // Same status (still structurally complete/digested) — only the *evidentiary weight* changes.
  assert.equal(structural.status, "pass");
  assert.equal(structural.kind, "self-reported");
  assert.equal(provenance.kind, "self-reported");
});

test("buildSkillAssessment: an unrelated source_refs entry (e.g. a different adapter) does not trigger the self-reported tier", () => {
  const assessment = buildSkillAssessment({
    manifest: manifest(),
    valid: true,
    provenanceSource: { source_refs: [{ product: "some-other-adapter", kind: "x", id: "y" }] },
  });
  const structural = assessment.evidence.find((e) => e.id === "structural_completeness")!;
  assert.equal(structural.kind, "observed");
});

test("buildSkillAssessment: benchmark assertions map to validationEvidence receipts with the right status translation", () => {
  const assessment = buildSkillAssessment({ manifest: manifest(), valid: true, benchmark: benchmark() });
  const passReceipt = assessment.evidence.find((e) => e.id === "validation_e1_a1")!;
  const pendingReceipt = assessment.evidence.find((e) => e.id === "validation_e1_a2")!;
  assert.equal(passReceipt.status, "pass");
  assert.equal(passReceipt.kind, "observed");
  // pending_human has no equivalent EvidenceStatus in skill-score's vocabulary —
  // "unknown" is the honest mapping (never silently dropped or counted as a pass).
  assert.equal(pendingReceipt.status, "unknown");
});

test("buildSkillAssessment: per-case executability becomes its own observed receipt, independent of assertion grading", () => {
  const assessment = buildSkillAssessment({ manifest: manifest(), valid: true, benchmark: benchmark() });
  const exec = assessment.evidence.find((e) => e.id === "executability_e1")!;
  assert.equal(exec.status, "pass");
  assert.equal(exec.kind, "observed");
});

test("buildSkillAssessment: real usage data becomes an efficiency receipt with the actual token count, never estimated", () => {
  const withUsage = benchmark({
    cases: [
      {
        id: "e1",
        prompt: "p",
        executable: true,
        duration_ms: 5,
        total_tokens: 342,
        assertions: [],
      },
    ],
  });
  const assessment = buildSkillAssessment({ manifest: manifest(), valid: true, benchmark: withUsage });
  const efficiency = assessment.evidence.find((e) => e.id === "efficiency_tokens");
  assert.equal(efficiency?.value, 342);
  assert.equal(assessment.metrics?.tokens, 342);
});

test("buildSkillAssessment: no benchmark at all still produces a valid assessment with structural/provenance evidence only", () => {
  const assessment = buildSkillAssessment({ manifest: manifest(), valid: true });
  assert.equal(assessment.evidence.length, 2);
  assert.equal(assessment.metrics, undefined);
});
