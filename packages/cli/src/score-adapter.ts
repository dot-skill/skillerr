import type { BenchmarkReport, SkillManifest } from "@skillerr/protocol";

/**
 * PHASE 3: maps a packed .skill's manifest + provenance/benchmark.json into
 * the input shape @skillerr/skill-score's scoreSkill() expects
 * (schema/assessment.schema.json in that repo). Deliberately duck-typed
 * here rather than importing @skillerr/skill-score's TS types directly —
 * this package only needs a *dynamic*, optional dependency on the scorer
 * (see cli.ts's `score` case), so the adapter itself stays buildable even
 * when the scorer isn't installed.
 */

export type EvidenceKind = "observed" | "verified-external" | "self-reported";
export type EvidenceStatus = "pass" | "partial" | "fail" | "unknown";

export interface EvidenceReceipt {
  id: string;
  dimension: string;
  kind: EvidenceKind;
  status: EvidenceStatus;
  value?: number;
  source: string;
  observedAt?: string;
  digest?: string;
  note?: string;
}

export interface SkillAssessment {
  protocolVersion: "0.1";
  artifact: {
    id: string;
    valid: boolean;
    parseable: boolean;
    containsSecrets?: boolean;
    dangerousBehavior?: boolean;
  };
  evidence: EvidenceReceipt[];
  metrics?: {
    usefulOutcomes?: number;
    tokens?: number;
    computeSeconds?: number;
  };
}

function gradeToStatus(status: string): EvidenceStatus {
  if (status === "pass") return "pass";
  if (status === "fail") return "fail";
  if (status === "partial") return "partial";
  return "unknown"; // pending_human
}

/**
 * A skill's structural/provenance evidence can only honestly be "observed"
 * (produced by this protocol's own validated compile/pack machinery) when
 * its source wasn't itself heuristically reconstructed. An automated
 * SKILL.md ingest (see ingest.ts's `source_refs` marker,
 * `product: "skill-md-ingest"`) derived triggers, the step sequence, and
 * section boundaries by pattern-matching prose — real, useful, but not the
 * same evidentiary weight as a human/agent authoring a contract from
 * scratch. Tiering it as self-reported (the same 0.25 multiplier
 * self-claims get) rather than observed (1.0) is not a penalty on
 * ingested skills specifically — it's the same honesty rule this whole
 * protocol already applies everywhere else (BUG-2/BUG-3, SEC-I): a claim
 * this codebase cannot independently verify is never scored as if it had
 * been. Ingest stays fully mintable either way — this only affects score
 * confidence, never a mint/compile gate.
 */
function isIngestDerived(provenanceSource: unknown): boolean {
  const refs = (provenanceSource as { source_refs?: Array<{ product?: string }> } | undefined)
    ?.source_refs;
  return Array.isArray(refs) && refs.some((r) => r?.product === "skill-md-ingest");
}

export function buildSkillAssessment(input: {
  manifest: SkillManifest;
  benchmark?: BenchmarkReport;
  provenanceSource?: unknown;
  valid: boolean;
}): SkillAssessment {
  const { manifest, benchmark, provenanceSource, valid } = input;
  const structuralKind: EvidenceKind = isIngestDerived(provenanceSource)
    ? "self-reported"
    : "observed";

  const evidence: EvidenceReceipt[] = [];

  evidence.push({
    id: "structural_completeness",
    dimension: "structuralCompleteness",
    kind: structuralKind,
    status: manifest.completeness?.complete ? "pass" : "partial",
    source: "manifest.completeness",
  });

  evidence.push({
    id: "provenance_integrity",
    dimension: "provenanceIntegrity",
    kind: structuralKind,
    status: manifest.manifest_digest ? "pass" : "unknown",
    source: "manifest.manifest_digest",
    digest: manifest.manifest_digest,
  });

  let totalTokens = 0;
  let hasTokens = false;
  if (benchmark) {
    for (const c of benchmark.cases) {
      evidence.push({
        id: `executability_${c.id}`,
        dimension: "executability",
        kind: "observed",
        status: c.executable ? "pass" : "fail",
        source: `skill eval (dry_run): ${c.id}`,
        observedAt: benchmark.created_at,
      });
      for (const a of c.assertions) {
        evidence.push({
          id: `validation_${c.id}_${a.id}`,
          dimension: "validationEvidence",
          kind: "observed",
          status: gradeToStatus(a.status),
          source: `skill eval: ${c.id}/${a.id} (${a.check})`,
          observedAt: benchmark.created_at,
          note: a.detail,
        });
      }
      if (typeof c.total_tokens === "number") {
        totalTokens += c.total_tokens;
        hasTokens = true;
      }
    }
    if (hasTokens) {
      evidence.push({
        id: "efficiency_tokens",
        dimension: "efficiency",
        kind: "observed",
        status: "pass",
        value: totalTokens,
        source: "skill eval --usage",
      });
    }
  }

  return {
    protocolVersion: "0.1",
    artifact: {
      id: manifest.id,
      valid,
      parseable: true,
    },
    evidence,
    metrics: hasTokens ? { tokens: totalTokens } : undefined,
  };
}
