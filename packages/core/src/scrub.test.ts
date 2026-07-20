/**
 * Phase 1.5: determinism vectors + per-layer coverage for the deterministic
 * secret scrubber (docs/SCRUBBING.md). fixtures/scrub/vectors.json pins the
 * exact (input, options) -> (scrubbed, report) shape produced by the current
 * rule table; a re-run must match byte-for-byte, and any intentional rule
 * change updates the fixture deliberately rather than drifting silently.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { scrub, redactSecrets, rulesDigest, mergeRedactionReports } from "./scrub.js";
import type { RedactionReport } from "@skillerr/protocol";

interface Vector {
  name: string;
  input: string;
  mode: "auto" | "report-only";
  customRules?: Array<{ id: string; label: string; pattern?: string; flags?: string; literal?: string }>;
  scrubbed: string;
  report: RedactionReport;
}

function loadVectors(): { rules_digest: string; vectors: Vector[] } {
  const vectorsPath = fileURLToPath(new URL("../../../fixtures/scrub/vectors.json", import.meta.url));
  return JSON.parse(readFileSync(vectorsPath, "utf8"));
}

test("SEC-SCRUB: determinism vectors match pinned scrub() output exactly", () => {
  const { rules_digest, vectors } = loadVectors();
  assert.equal(rulesDigest(), rules_digest, "rules_digest drifted from the pinned fixture value");
  assert.ok(vectors.length >= 15, "expected the full scrub vector set");
  for (const v of vectors) {
    const result = scrub(v.input, { mode: v.mode, customRules: v.customRules });
    assert.deepEqual(result.scrubbed, v.scrubbed, `scrubbed mismatch for vector "${v.name}"`);
    assert.deepEqual(result.report, v.report, `report mismatch for vector "${v.name}"`);
  }
});

test("SEC-SCRUB: re-running the same vector twice is byte-identical", () => {
  const { vectors } = loadVectors();
  for (const v of vectors) {
    const a = scrub(v.input, { mode: v.mode, customRules: v.customRules });
    const b = scrub(v.input, { mode: v.mode, customRules: v.customRules });
    assert.deepEqual(a, b, `non-deterministic output for vector "${v.name}"`);
  }
});

test("SEC-SCRUB: each known-format rule fires at high confidence and is auto-redacted", () => {
  const { vectors } = loadVectors();
  const knownFormatRules = [
    "openai_key",
    "anthropic_key",
    "github_token",
    "aws_access_key_id",
    "gcp_api_key",
    "slack_token",
    "stripe_live_key",
    "db_uri_credential",
    "bearer_token",
    "env_style_secret_value",
    "jwt",
    "private_key_block",
  ];
  for (const ruleId of knownFormatRules) {
    const v = vectors.find((x) => x.name === ruleId);
    assert.ok(v, `no vector for rule "${ruleId}"`);
    assert.equal(v!.report.summary.high_confidence, 1, `rule "${ruleId}" did not fire high-confidence`);
    assert.equal(v!.report.findings[0]!.rule_id, ruleId);
    assert.equal(v!.report.findings[0]!.confidence, "high");
    assert.ok(v!.scrubbed.includes(v!.report.findings[0]!.placeholder!), `"${ruleId}" placeholder missing from scrubbed output`);
  }
});

test("SEC-SCRUB: high entropy is flagged needs_review, never auto-redacted", () => {
  const { vectors } = loadVectors();
  const v = vectors.find((x) => x.name === "entropy_flagged_not_removed")!;
  assert.equal(v.report.findings.length, 1);
  assert.equal(v.report.findings[0]!.source, "entropy");
  assert.equal(v.report.findings[0]!.confidence, "needs_review");
  assert.equal(v.report.findings[0]!.placeholder, null);
  // report-only or not, entropy findings never rewrite text.
  assert.equal(v.scrubbed, v.input);
});

test("SEC-SCRUB: entropy layer skips recognized digests/ids, not just anything high-entropy", () => {
  const { vectors } = loadVectors();
  for (const name of [
    "entropy_skips_hex_digest",
    "entropy_skips_uuid",
    "entropy_skips_skl_id",
    "entropy_skips_sha256_prefixed",
  ]) {
    const v = vectors.find((x) => x.name === name)!;
    assert.equal(v.report.findings.length, 0, `"${name}" should produce no findings`);
    assert.equal(v.scrubbed, v.input);
  }
});

test("SEC-SCRUB: same value reuses the same placeholder token within one scrub() call", () => {
  const { vectors } = loadVectors();
  const v = vectors.find((x) => x.name === "multi_secret_document")!;
  const openaiFindings = v.report.findings.filter((f) => f.rule_id === "openai_key");
  assert.equal(openaiFindings.length, 2);
  assert.equal(openaiFindings[0]!.placeholder, openaiFindings[1]!.placeholder);
  assert.equal((v.scrubbed.match(/\{\{redacted:openai_key#1\}\}/g) ?? []).length, 2);
});

test("SEC-SCRUB: custom denylist rule redacts at high confidence", () => {
  const { vectors } = loadVectors();
  const v = vectors.find((x) => x.name === "custom_denylist_literal")!;
  assert.equal(v.report.findings[0]!.source, "custom");
  assert.equal(v.report.findings[0]!.confidence, "high");
  assert.ok(!v.scrubbed.includes("xyzzy-plugh-internal"));
});

test("SEC-SCRUB: report-only mode finds without rewriting", () => {
  const { vectors } = loadVectors();
  const v = vectors.find((x) => x.name === "report_only_does_not_rewrite")!;
  assert.equal(v.scrubbed, v.input);
  assert.equal(v.report.summary.high_confidence, 1);
});

test("SEC-SCRUB: env-match redacts exact and trimmed values, reports key name only, never the value", () => {
  const dir = mkdtempSync(join(tmpdir(), "skillerr-scrub-envmatch-"));
  try {
    const secretValue = "s3cr3t-plant-value-XYZ789";
    const envPath = join(dir, ".env");
    writeFileSync(envPath, `MY_API_KEY=${secretValue}\nUNRELATED=short\n`);

    const input = `config uses key "${secretValue}" and also "  ${secretValue}  " trimmed`;
    const { scrubbed, report } = scrub(input, { secretsFrom: [envPath] });

    assert.ok(!(scrubbed as string).includes(secretValue), "raw secret value leaked into scrubbed output");
    const envFindings = report.findings.filter((f) => f.source === "env-match");
    assert.equal(envFindings.length, 2, "expected both exact and trimmed occurrences matched");
    for (const f of envFindings) {
      assert.equal(f.matched_key, "MY_API_KEY");
      assert.equal(f.confidence, "high");
      assert.ok(!JSON.stringify(f).includes(secretValue), "finding leaked the raw secret value");
    }
    assert.ok(!JSON.stringify(report).includes(secretValue), "report JSON leaked the raw secret value");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SEC-SCRUB: env-match is opt-in only, no secretsFrom means no env-match layer runs", () => {
  const secretValue = "s3cr3t-plant-value-XYZ789";
  const { report } = scrub(`value is ${secretValue}`, {});
  assert.equal(report.findings.filter((f) => f.source === "env-match").length, 0);
});

test("SEC-SCRUB: privacy guard — a planted fake secret never appears anywhere in the report", () => {
  const dir = mkdtempSync(join(tmpdir(), "skillerr-scrub-privacy-"));
  try {
    const plantedSecret = "PLANTED-FAKE-SECRET-value-9f8e7d6c5b4a";
    const envPath = join(dir, "credentials");
    writeFileSync(envPath, `AWS_SECRET_ACCESS_KEY=${plantedSecret}\n`);

    const input = `# notes\nsecret on file: ${plantedSecret}\nand an unrelated openai key sk-abcdefghijklmnopqrstuvwx`;
    const { scrubbed, report } = scrub(input, { secretsFrom: [envPath] });

    const reportJson = JSON.stringify(report);
    assert.ok(!reportJson.includes(plantedSecret), "planted secret leaked into the RedactionReport");
    assert.ok(!(scrubbed as string).includes(plantedSecret), "planted secret leaked into the scrubbed output");
    assert.ok(reportJson.includes("AWS_SECRET_ACCESS_KEY"), "matched key name should still be reported");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SEC-SCRUB: redactSecrets() backward-compat shim delegates to scrub() and never exposes raw values", () => {
  const calls: string[] = [];
  const out = redactSecrets("key: sk-abcdefghijklmnopqrstuvwx end", (m) => calls.push(m));
  assert.equal(out, "key: {{redacted:openai_key#1}} end");
  assert.deepEqual(calls, ["{{redacted:openai_key#1}}"]);
});

test("SEC-SCRUB: redactSecrets() with no onRedact callback still redacts", () => {
  assert.equal(redactSecrets("key: sk-abcdefghijklmnopqrstuvwx end"), "key: {{redacted:openai_key#1}} end");
  assert.equal(redactSecrets("nothing secret here"), "nothing secret here");
});

test("SEC-SCRUB: mergeRedactionReports sums scanned stats and renumbers findings uniquely", () => {
  const a = scrub("field a: sk-abcdefghijklmnopqrstuvwx", {}).report;
  const b = scrub("field b: sk-ant-abcdefghijklmnopqrstuvwx", {}).report;
  const merged = mergeRedactionReports([a, b]);
  assert.equal(merged.scanned.units, a.scanned.units + b.scanned.units);
  assert.equal(merged.scanned.chars, a.scanned.chars + b.scanned.chars);
  assert.equal(merged.findings.length, 2);
  assert.deepEqual(
    merged.findings.map((f) => f.id),
    ["f1", "f2"],
  );
  assert.equal(merged.summary.total, 2);
  assert.equal(merged.summary.high_confidence, 2);
  assert.equal(merged.summary.by_rule.openai_key, 1);
  assert.equal(merged.summary.by_rule.anthropic_key, 1);
});

test("SEC-SCRUB: mergeRedactionReports of zero reports yields an empty, well-formed report", () => {
  const merged = mergeRedactionReports([]);
  assert.equal(merged.scanned.units, 0);
  assert.equal(merged.scanned.chars, 0);
  assert.equal(merged.findings.length, 0);
  assert.equal(merged.summary.total, 0);
});

test("SEC-SCRUB: ScrubUnit[] input scrubs each unit independently, reports its own unit id", () => {
  const { report, scrubbed } = scrub(
    [
      { id: "section-1", text: "leaked: sk-abcdefghijklmnopqrstuvwx" },
      { id: "section-2", text: "clean text, nothing to redact" },
    ],
    {},
  );
  assert.equal(report.scanned.units, 2);
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0]!.location.unit, "section-1");
  assert.deepEqual(scrubbed, [
    { id: "section-1", text: "leaked: {{redacted:openai_key#1}}" },
    { id: "section-2", text: "clean text, nothing to redact" },
  ]);
});
