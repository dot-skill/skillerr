import { existsSync, readFileSync } from "node:fs";
import type { RedactionFinding, RedactionReport } from "@skillerr/protocol";
import { canonicalize, sha256Digest } from "./hash.js";

/**
 * Deterministic secret scrubber. Pure function of (content, rule set,
 * provided secret values): no network, no model calls, no randomness, no
 * timestamps inside the hashed/reported body. Re-running with the same
 * inputs yields a byte-identical RedactionReport (see rulesDigest()).
 *
 * The scrubber's job is secrets, full stop. It never claims to catch
 * proprietary/PII/business-sensitive content, that's a human review call
 * (see docs/SCRUBBING.md and the Phase 2 review-before-mint surface this
 * report is designed to feed, not built yet).
 */

const SCRUBBER_VERSION = "1";

// Bundler-tracing-safe literal path, same discipline as
// @skillerr/protocol's schemas.ts: a dynamically-built path is a documented
// way to get ENOENT in a serverless/bundled deployment despite working
// fine locally.
const RULES_URL = new URL("../scrub-rules.json", import.meta.url);

interface RawRule {
  id: string;
  label: string;
  pattern: string;
  flags?: string;
}

interface CompiledRule {
  id: string;
  label: string;
  re: RegExp;
}

let cachedRuleSet: { rulesVersion: string; rulesDigest: string; rules: CompiledRule[] } | undefined;

function loadRuleSet(): { rulesVersion: string; rulesDigest: string; rules: CompiledRule[] } {
  if (!cachedRuleSet) {
    const raw = readFileSync(RULES_URL, "utf8");
    const parsed = JSON.parse(raw) as { rules_version: string; rules: RawRule[] };
    cachedRuleSet = {
      rulesVersion: parsed.rules_version,
      // Digest over the canonicalized rule table, not the raw file bytes,
      // so incidental whitespace/formatting changes to scrub-rules.json
      // don't silently change the pinned digest every implementation
      // relies on for reproducibility.
      rulesDigest: sha256Digest(canonicalize(parsed)),
      rules: parsed.rules.map((r) => ({ id: r.id, label: r.label, re: new RegExp(r.pattern, r.flags ?? "g") })),
    };
  }
  return cachedRuleSet;
}

export interface ScrubUnit {
  id: string;
  text: string;
}

export type ScrubInput = string | ScrubUnit[];

export interface ScrubCustomRule {
  id: string;
  label: string;
  /** Regex pattern (string form) — mutually exclusive with `literal`. */
  pattern?: string;
  flags?: string;
  /** Exact literal string to treat as a denylisted secret. */
  literal?: string;
}

export interface ScrubOptions {
  /** Restrict to a subset of built-in rule ids. Default: all rules. */
  rules?: string[];
  /** File paths to load candidate secret values from (env-match layer, opt-in). */
  secretsFrom?: string[];
  /** Project-supplied literal/regex denylist, always high-confidence. */
  customRules?: ScrubCustomRule[];
  /** Shannon-entropy threshold (bits/char) above which a candidate token is flagged needs_review. */
  entropyThreshold?: number;
  /** "auto" (default) redacts high-confidence findings in the output; "report-only" never rewrites content. */
  mode?: "auto" | "report-only";
}

export interface ScrubResult {
  scrubbed: string | ScrubUnit[];
  report: RedactionReport;
}

const DEFAULT_ENTROPY_THRESHOLD = 3.5;
const ENTROPY_TOKEN_RE = /[A-Za-z0-9+/_=-]{20,}/g;
const ENV_KEY_RE = /[A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD|PASSWD|CREDENTIAL|API)[A-Z0-9_]*/;
const MIN_ENV_SECRET_LENGTH = 8;

function shannonEntropy(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Recognizable digests/ids that legitimately look high-entropy but are not
 * secrets — a skillerr package is full of sha256 digests, skill_ids, and
 * UUIDs; flagging every one of them as needs_review would make the report
 * useless noise instead of a signal. Mirrors the reasoning already
 * established for redactSecrets()'s hex-digest skip.
 */
function looksLikeRecognizedId(token: string, precedingContext: string): boolean {
  if (/^[0-9a-fA-F]+$/.test(token)) return true;
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i.test(token)) return true;
  if (/^skl_[0-9a-fA-F]+$/.test(token)) return true;
  if (/sha(256|1|512):$/i.test(precedingContext)) return true;
  return false;
}

function parseEnvStyleValues(text: string, into: Map<string, string>): void {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";") || trimmed.startsWith("[")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (ENV_KEY_RE.test(key.toUpperCase()) && value.length >= MIN_ENV_SECRET_LENGTH) {
      into.set(value, key);
    }
  }
}

/**
 * Loads candidate secret values to compare against, each mapped to the key
 * NAME it came from (never persisted anywhere beyond this function call's
 * local scope — only the key name is ever reported, per RedactionFinding's
 * matched_key). Supports .env-style KEY=VALUE files (also covers ini-style
 * credentials files, same line-based shape) and whole-file PEM key blocks
 * (~/.ssh/id_*, etc), which report matched_key as the file's basename.
 */
function loadSecretValues(paths: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (const path of paths) {
    if (!existsSync(path)) continue;
    let content: string;
    try {
      content = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    parseEnvStyleValues(content, values);
    const trimmed = content.trim();
    if (trimmed.includes("-----BEGIN ") && trimmed.includes("PRIVATE KEY-----") && trimmed.length >= MIN_ENV_SECRET_LENGTH) {
      values.set(trimmed, path.split(/[/\\]/).pop() ?? path);
    }
  }
  return values;
}

function envValuesFromProcessEnv(): Map<string, string> {
  const values = new Map<string, string>();
  for (const [key, value] of Object.entries(process.env)) {
    if (!value || value.length < MIN_ENV_SECRET_LENGTH) continue;
    if (ENV_KEY_RE.test(key.toUpperCase())) values.set(value, key);
  }
  return values;
}

interface ClaimedRange {
  start: number;
  end: number;
}

function overlaps(a: ClaimedRange, start: number, end: number): boolean {
  return start < a.end && end > a.start;
}

/**
 * Runs the full four-layer scrub over one unit's text. Returns the
 * (possibly rewritten) text plus the findings for this unit, in
 * left-to-right match order. `placeholderFor` is shared across all units
 * in a single scrub() call so the "same value -> same token" guarantee
 * holds document-wide, not just per-unit.
 */
function scrubUnit(
  unit: ScrubUnit,
  activeRules: CompiledRule[],
  customRules: CompiledRule[],
  secretValues: Map<string, string>,
  entropyThreshold: number,
  mode: "auto" | "report-only",
  placeholderFor: (ruleId: string, value: string) => string,
  nextFindingId: () => string,
): { text: string; findings: RedactionFinding[] } {
  const text = unit.text;
  const claimed: ClaimedRange[] = [];
  const findings: RedactionFinding[] = [];
  const replacements: Array<{ start: number; end: number; placeholder: string }> = [];

  const claim = (start: number, end: number) => {
    if (claimed.some((c) => overlaps(c, start, end))) return false;
    claimed.push({ start, end });
    return true;
  };

  // Layer 1 (highest confidence): exact/trimmed matches against known
  // secret VALUES supplied via secretsFrom/process env. Runs first so it
  // wins any span conflict against a generic pattern rule.
  if (secretValues.size > 0) {
    // Longest values first so a longer secret isn't partially shadowed by
    // a shorter one that happens to be a substring of it.
    const sorted = [...secretValues.entries()].sort((a, b) => b[0].length - a[0].length);
    for (const [value, keyName] of sorted) {
      let searchFrom = 0;
      while (true) {
        const idx = text.indexOf(value, searchFrom);
        if (idx === -1) break;
        searchFrom = idx + value.length;
        const start = idx;
        const end = idx + value.length;
        if (!claim(start, end)) continue;
        const placeholder = placeholderFor("env_match", value);
        findings.push({
          id: nextFindingId(),
          rule_id: "env_match",
          label: ".env-style secret value",
          source: "env-match",
          confidence: "high",
          location: { unit: unit.id, span: [start, end] },
          placeholder,
          matched_key: keyName,
        });
        replacements.push({ start, end, placeholder });
      }
    }
  }

  // Layer 2: known-format pattern rules + custom rules (also high
  // confidence, always auto-redacted regardless of mode's effect on
  // output text — "auto"/"report-only" only controls whether the text
  // itself gets rewritten, findings are identical either way).
  for (const rule of [...activeRules, ...customRules]) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text))) {
      const start = m.index;
      const end = start + m[0].length;
      if (m[0].length === 0) {
        rule.re.lastIndex += 1;
        continue;
      }
      if (!claim(start, end)) continue;
      const placeholder = placeholderFor(rule.id, m[0]);
      findings.push({
        id: nextFindingId(),
        rule_id: rule.id,
        label: rule.label,
        source: activeRules.includes(rule) ? "pattern" : "custom",
        confidence: "high",
        location: { unit: unit.id, span: [start, end] },
        placeholder,
      });
      replacements.push({ start, end, placeholder });
    }
  }

  // Layer 3: high-entropy candidate tokens, needs_review only, never
  // auto-redacted, never claims a span (so it can't shadow anything, and
  // running it last means it naturally skips spans layers 1-2 already
  // explained).
  ENTROPY_TOKEN_RE.lastIndex = 0;
  let em: RegExpExecArray | null;
  while ((em = ENTROPY_TOKEN_RE.exec(text))) {
    const token = em[0];
    const start = em.index;
    const end = start + token.length;
    if (claimed.some((c) => overlaps(c, start, end))) continue;
    const precedingContext = text.slice(Math.max(0, start - 8), start);
    if (looksLikeRecognizedId(token, precedingContext)) continue;
    if (shannonEntropy(token) < entropyThreshold) continue;
    findings.push({
      id: nextFindingId(),
      rule_id: "high_entropy",
      label: "High-entropy token",
      source: "entropy",
      confidence: "needs_review",
      location: { unit: unit.id, span: [start, end] },
      placeholder: null,
    });
  }

  findings.sort((a, b) => (a.location.span?.[0] ?? 0) - (b.location.span?.[0] ?? 0));

  if (mode === "report-only" || replacements.length === 0) {
    return { text, findings };
  }
  replacements.sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const r of replacements) {
    out += text.slice(cursor, r.start) + r.placeholder;
    cursor = r.end;
  }
  out += text.slice(cursor);
  return { text: out, findings };
}

export function rulesDigest(): string {
  return loadRuleSet().rulesDigest;
}

/**
 * Combines findings from several independent scrub() calls (compile.ts
 * runs one per field as content is built up, not one pass over the whole
 * document) into a single sealed RedactionReport. Note: `findings[].id`
 * gets renumbered here to stay unique across the merge, and per-field
 * placeholder numbering ("same value -> same token") is only guaranteed
 * *within* the field that produced it, not globally across every merged
 * field, since each source scrub() call has its own local state. See
 * docs/SCRUBBING.md.
 */
export function mergeRedactionReports(reports: RedactionReport[]): RedactionReport {
  const { rulesVersion, rulesDigest: digest } = loadRuleSet();
  const findings: RedactionFinding[] = [];
  let scannedUnits = 0;
  let scannedChars = 0;
  let seq = 0;
  for (const report of reports) {
    scannedUnits += report.scanned.units;
    scannedChars += report.scanned.chars;
    for (const f of report.findings) {
      findings.push({ ...f, id: `f${++seq}` });
    }
  }
  const by_rule: Record<string, number> = {};
  let highConfidence = 0;
  let needsReview = 0;
  for (const f of findings) {
    by_rule[f.rule_id] = (by_rule[f.rule_id] ?? 0) + 1;
    if (f.confidence === "high") highConfidence += 1;
    else needsReview += 1;
  }
  return {
    kind: "redaction_report",
    scrubber_version: SCRUBBER_VERSION,
    rules_version: rulesVersion,
    rules_digest: digest,
    scanned: { units: scannedUnits, chars: scannedChars },
    findings,
    summary: {
      total: findings.length,
      high_confidence: highConfidence,
      needs_review: needsReview,
      by_rule,
    },
  };
}

/**
 * scrub(): the one entry point for every deterministic redaction path in
 * skillerr. Identical (content, rules_digest, secretsFrom-values) always
 * yields an identical report — no timestamps in the findings, no
 * non-deterministic ordering.
 */
export function scrub(input: ScrubInput, opts: ScrubOptions = {}): ScrubResult {
  const { rulesVersion, rulesDigest: digest, rules } = loadRuleSet();
  const activeRules = opts.rules ? rules.filter((r) => opts.rules!.includes(r.id)) : rules;
  const customRules: CompiledRule[] = (opts.customRules ?? []).map((c) => ({
    id: c.id,
    label: c.label,
    re: c.literal !== undefined
      ? new RegExp(c.literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")
      : new RegExp(c.pattern!, c.flags ?? "g"),
  }));
  const mode = opts.mode ?? "auto";
  const entropyThreshold = opts.entropyThreshold ?? DEFAULT_ENTROPY_THRESHOLD;

  const secretValues = new Map<string, string>();
  if (opts.secretsFrom && opts.secretsFrom.length > 0) {
    for (const [v, k] of loadSecretValues(opts.secretsFrom)) secretValues.set(v, k);
    for (const [v, k] of envValuesFromProcessEnv()) secretValues.set(v, k);
  }

  const units: ScrubUnit[] = typeof input === "string" ? [{ id: "input", text: input }] : input;

  const placeholderMap = new Map<string, string>();
  const ruleCounters = new Map<string, number>();
  const placeholderFor = (ruleId: string, value: string): string => {
    const key = `${ruleId} ${value}`;
    const existing = placeholderMap.get(key);
    if (existing) return existing;
    const n = (ruleCounters.get(ruleId) ?? 0) + 1;
    ruleCounters.set(ruleId, n);
    const placeholder = `{{redacted:${ruleId}#${n}}}`;
    placeholderMap.set(key, placeholder);
    return placeholder;
  };

  let findingSeq = 0;
  const nextFindingId = () => `f${++findingSeq}`;

  const allFindings: RedactionFinding[] = [];
  let totalChars = 0;
  const outUnits: ScrubUnit[] = units.map((unit) => {
    totalChars += unit.text.length;
    const { text, findings } = scrubUnit(
      unit,
      activeRules,
      customRules,
      secretValues,
      entropyThreshold,
      mode,
      placeholderFor,
      nextFindingId,
    );
    allFindings.push(...findings);
    return { id: unit.id, text };
  });

  const by_rule: Record<string, number> = {};
  let highConfidence = 0;
  let needsReview = 0;
  for (const f of allFindings) {
    by_rule[f.rule_id] = (by_rule[f.rule_id] ?? 0) + 1;
    if (f.confidence === "high") highConfidence += 1;
    else needsReview += 1;
  }

  const report: RedactionReport = {
    kind: "redaction_report",
    scrubber_version: SCRUBBER_VERSION,
    rules_version: rulesVersion,
    rules_digest: digest,
    scanned: { units: units.length, chars: totalChars },
    findings: allFindings,
    summary: {
      total: allFindings.length,
      high_confidence: highConfidence,
      needs_review: needsReview,
      by_rule,
    },
  };

  const scrubbed: string | ScrubUnit[] = typeof input === "string" ? (outUnits[0]?.text ?? "") : outUnits;
  return { scrubbed, report };
}

/**
 * Backward-compatible shim: the pre-Phase-1 signature every existing
 * compile.ts callsite already uses. Delegates to scrub() so there is only
 * one redaction engine, not two. `onRedact` (when given) fires once per
 * high-confidence finding with the finding's placeholder, matching the
 * existing callers' use (a bare count, never the actual secret value —
 * scrub() never exposes raw matched text outside its own local scope
 * either, so this stays true to "never store secret values" even for the
 * legacy call path).
 */
export function redactSecrets(text: string, onRedact?: (match: string) => void): string {
  const { scrubbed, report } = scrub(text, { mode: "auto" });
  if (onRedact) {
    for (const finding of report.findings) {
      if (finding.confidence === "high") onRedact(finding.placeholder ?? "");
    }
  }
  return scrubbed as string;
}
