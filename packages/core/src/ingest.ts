import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import type {
  ContractCapability,
  ContractPermission,
  ContractPrecondition,
  ContractTrigger,
  SkillContract,
  VerificationAssertion,
} from "@skillerr/protocol";
import { PROTOCOL_VERSION, type SkillSection, type SkillSource } from "@skillerr/protocol";
import { sha256Digest } from "./hash.js";

/**
 * PHASE 1: forward `SKILL.md` -> `.skill` ingest. Distinct from the existing
 * `toSkillMdAdapter` export (that's the lossy reverse — markdown is never
 * the protocol's source of truth). This is the on-ramp: read an existing
 * skill-creator-style folder and produce a *continuity* SkillSource/
 * SkillContract, never a claimed-complete release. Every field this can't
 * honestly derive is left `status:"none"`/`"not_applicable"` with a reason,
 * or flagged in `IngestReport.notes` — never silently guessed as complete.
 */

export interface IngestOptions {
  /** Agent host recorded on the resulting SkillSource — see SkillSource.agent.host. */
  host?: string;
  /** Overrides Date.now() for deterministic re-ingest tests. */
  now?: () => string;
}

export interface IngestReport {
  source_path: string;
  found: {
    name: boolean;
    description: boolean;
    sections: number;
    scripts: number;
    references: number;
    assets: number;
    evals: number;
    license: boolean;
    compatibility: boolean;
    metadata_keys: number;
    allowed_tools: number;
  };
  /** Human-readable notes on every heuristic/lossy decision this pass made. */
  notes: string[];
}

export interface IngestResult {
  source: SkillSource;
  contract: SkillContract;
  /** Raw bytes to inject into SkillPackageFiles.resources / .assets after compiling. */
  resources: Record<string, Uint8Array>;
  assets: Record<string, Uint8Array>;
  report: IngestReport;
}

export type FrontmatterValue = string | Record<string, string>;

interface ParsedSkillMd {
  frontmatter: Record<string, FrontmatterValue>;
  body: string;
}

/**
 * Minimal frontmatter parser scoped to how skill-creator/Agent Skills
 * SKILL.md files actually use YAML: flat `key: value` pairs, a block
 * scalar (`key: |` / `key: >`) for a long description, one level of
 * nested `key:\n  child: value` maps (the `metadata` field in the wild),
 * and dotted top-level keys (`metadata.internal: true`, an alternate form
 * some tools emit for the same thing), both land in the same nested slot.
 * This is intentionally not a general YAML parser (no anchors, no lists,
 * no multi-doc, no depth beyond one level), scope matched to the real
 * input shape rather than adding a dependency for generality this format
 * never needs.
 */
function parseFrontmatter(raw: string): ParsedSkillMd {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { frontmatter: {}, body: normalized };
  }
  const end = normalized.indexOf("\n---\n", 4);
  const endAlt = normalized.indexOf("\n---", 4);
  const closeIdx = end !== -1 ? end : endAlt;
  if (closeIdx === -1) return { frontmatter: {}, body: normalized };
  const block = normalized.slice(4, closeIdx);
  const body = normalized.slice(closeIdx + (end !== -1 ? 5 : 4)).replace(/^\n/, "");

  const frontmatter: Record<string, FrontmatterValue> = {};
  const asNestedMap = (key: string): Record<string, string> => {
    const existing = frontmatter[key];
    if (existing && typeof existing === "object") return existing;
    const created: Record<string, string> = {};
    frontmatter[key] = created;
    return created;
  };
  const lines = block.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_.-]*):\s?(.*)$/);
    if (!m) continue;
    const rawKey = m[1]!;
    const rest = m[2]!.trim();
    const dot = rawKey.indexOf(".");

    if (rest === "") {
      // Nested-block form: `metadata:` followed by 2-space-indented `key: value` children.
      const children: Record<string, string> = {};
      let j = i + 1;
      while (j < lines.length && /^ {2}\S/.test(lines[j]!)) {
        const cm = lines[j]!.match(/^ {2}([A-Za-z_][A-Za-z0-9_.-]*):\s?(.*)$/);
        if (cm) children[cm[1]!] = cm[2]!.trim().replace(/^["']|["']$/g, "");
        j++;
      }
      if (Object.keys(children).length > 0) {
        i = j - 1;
        const target = dot === -1 ? asNestedMap(rawKey) : asNestedMap(rawKey.slice(0, dot));
        Object.assign(target, children);
        continue;
      }
      // Empty value, no indented children, fall through to plain-key handling below.
    }

    if (rest === "|" || rest === ">") {
      const collected: string[] = [];
      let j = i + 1;
      while (j < lines.length && (lines[j]!.startsWith("  ") || lines[j]!.trim() === "")) {
        collected.push(lines[j]!.replace(/^ {1,2}/, ""));
        j++;
      }
      i = j - 1;
      const value = rest === "|" ? collected.join("\n").trim() : collected.join(" ").trim();
      if (dot === -1) frontmatter[rawKey] = value;
      else asNestedMap(rawKey.slice(0, dot))[rawKey.slice(dot + 1)] = value;
    } else {
      const value = rest.replace(/^["']|["']$/g, "");
      if (dot === -1) frontmatter[rawKey] = value;
      else asNestedMap(rawKey.slice(0, dot))[rawKey.slice(dot + 1)] = value;
    }
  }
  return { frontmatter, body };
}

function asString(v: FrontmatterValue | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/**
 * Description -> candidate trigger phrases. Heuristic and lossy by nature —
 * the full raw description is always kept as trigger t1 so nothing derived
 * here can be *lost*, only supplemented.
 */
function deriveTriggers(description: string): ContractTrigger[] {
  const trimmed = description.trim();
  if (!trimmed) {
    return [
      {
        id: "t1",
        description:
          "No description found in SKILL.md frontmatter — author real trigger phrases before release.",
      },
    ];
  }
  const triggers: ContractTrigger[] = [{ id: "t1", description: trimmed }];
  const match = trimmed.match(/\buse (?:this skill )?when\b[:,]?\s*(.+)$/i);
  if (match) {
    const clause = match[1]!.replace(/\.$/, "");
    const parts = clause
      .split(/,\s*(?:or\s+)?|\s+or\s+/i)
      .map((s) => s.trim())
      .filter((s) => s.split(/\s+/).length >= 2);
    parts.forEach((p, i) => {
      triggers.push({ id: `t${i + 2}`, description: p.charAt(0).toUpperCase() + p.slice(1) });
    });
  }
  return triggers;
}

/** Body markdown -> one section per `## ` heading, preserving exact text. */
function splitIntoSections(body: string, fallbackTitle: string): Array<{ title: string; body: string }> {
  const withoutH1 = body.replace(/^#\s+.*\n+/, "");
  const headingRe = /^##\s+(.+)$/gm;
  const matches = [...withoutH1.matchAll(headingRe)];
  if (matches.length === 0) {
    const trimmed = withoutH1.trim();
    return trimmed ? [{ title: fallbackTitle, body: trimmed }] : [];
  }
  const sections: Array<{ title: string; body: string }> = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const start = m.index! + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : withoutH1.length;
    sections.push({ title: m[1]!.trim(), body: withoutH1.slice(start, end).trim() });
  }
  return sections;
}

/** A relative path is only friendlier than the absolute one up to a point. */
function friendlyPath(p: string): string {
  const rel = relative(process.cwd(), p);
  const upSegments = rel.split(/[/\\]/).filter((s) => s === "..").length;
  return upSegments > 2 ? p : rel;
}

function listFiles(dir: string, exts?: string[]): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (!exts || exts.includes(extname(entry.name).toLowerCase())) out.push(full);
    }
  };
  walk(dir);
  return out;
}

interface EvalAssertion {
  description?: string;
  assertion?: string;
  check?: "runtime" | "capability" | "human";
}
interface EvalEntry {
  prompt?: string;
  name?: string;
  id?: string;
  assertions?: Array<string | EvalAssertion>;
}

function parseEvalsJson(raw: string): EvalEntry[] {
  const data = JSON.parse(raw) as unknown;
  const arr = Array.isArray(data)
    ? data
    : Array.isArray((data as { evals?: unknown })?.evals)
      ? (data as { evals: unknown[] }).evals
      : [];
  return arr as EvalEntry[];
}

export interface SkillMdCandidate {
  path: string;
  source: "manifest" | "catalog";
}

interface PluginManifestShape {
  plugins?: Array<{ name?: string; source?: string; skills?: string[] }>;
}

/**
 * Multi-skill discovery for a folder that has no direct SKILL.md of its
 * own. Read-only, no ingest side effects, callers pick a candidate and
 * re-run `ingestSkillMd` on it directly. Scoped to the two conventions
 * verified against vercel-labs/skills' real docs: a plugin manifest
 * (`.claude-plugin/marketplace.json` or `plugin.json`, `skills` entries are
 * directory paths with `/SKILL.md` implied) and a flat `skills/<name>/`
 * catalog folder. Deliberately does not walk `.curated/`/`.experimental/`/
 * `.system/` nested catalog variants, out of scope here.
 */
export function discoverSkillMdCandidates(inputPath: string): SkillMdCandidate[] {
  if (!existsSync(inputPath) || !statSync(inputPath).isDirectory()) return [];

  for (const manifestName of ["marketplace.json", "plugin.json"]) {
    const manifestPath = join(inputPath, ".claude-plugin", manifestName);
    if (!existsSync(manifestPath)) continue;
    try {
      const data = JSON.parse(readFileSync(manifestPath, "utf8")) as PluginManifestShape;
      const candidates: SkillMdCandidate[] = [];
      for (const plugin of data.plugins ?? []) {
        for (const skillDir of plugin.skills ?? []) {
          if (typeof skillDir !== "string") continue;
          const skillMdPath = join(inputPath, skillDir, "SKILL.md");
          if (existsSync(skillMdPath)) candidates.push({ path: skillMdPath, source: "manifest" });
        }
      }
      return candidates;
    } catch {
      // Malformed manifest, treat as no candidates rather than throwing;
      // the caller falls back to the bare "no SKILL.md found" error.
      return [];
    }
  }

  const skillsDir = join(inputPath, "skills");
  if (existsSync(skillsDir) && statSync(skillsDir).isDirectory()) {
    const candidates: SkillMdCandidate[] = [];
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillMdPath = join(skillsDir, entry.name, "SKILL.md");
      if (existsSync(skillMdPath)) candidates.push({ path: skillMdPath, source: "catalog" });
    }
    return candidates;
  }

  return [];
}

export function ingestSkillMd(inputPath: string, opts: IngestOptions = {}): IngestResult {
  const now = opts.now ?? (() => new Date().toISOString());
  const notes: string[] = [];

  const stat = statSync(inputPath);
  const skillMdPath = stat.isDirectory() ? join(inputPath, "SKILL.md") : inputPath;
  const folder = stat.isDirectory() ? inputPath : join(inputPath, "..");
  if (!existsSync(skillMdPath)) {
    throw new Error(`No SKILL.md found at ${skillMdPath}`);
  }
  const raw = readFileSync(skillMdPath, "utf8");
  const { frontmatter, body } = parseFrontmatter(raw);

  const nameValue = asString(frontmatter.name);
  const descriptionValue = asString(frontmatter.description);
  const nameFound = !!nameValue && nameValue.trim().length > 0;
  const descriptionFound = !!descriptionValue && descriptionValue.trim().length > 0;

  const h1Match = body.match(/^#\s+(.+)$/m);
  const title = nameFound
    ? nameValue!.trim()
    : h1Match
      ? h1Match[1]!.trim()
      : basename(folder);
  if (!nameFound) {
    notes.push(
      `No frontmatter "name" — derived title "${title}" from ${h1Match ? "the body's first heading" : "the folder name"}. Review before release.`,
    );
  }

  const description = descriptionFound ? descriptionValue!.trim() : "";
  if (!descriptionFound) {
    notes.push('No frontmatter "description" — intent and triggers need manual authoring.');
  }
  const triggers = deriveTriggers(description);
  if (triggers.length > 1) {
    notes.push(
      `Derived ${triggers.length - 1} candidate trigger phrase(s) from the description by splitting a "use when ..." clause — heuristic, review before release.`,
    );
  }

  const sectionSpecs = splitIntoSections(body, title);
  const sections: SkillSection[] = sectionSpecs.map((s, i) => ({
    id: `sec_${i + 1}`,
    revision: 1,
    type: "reference",
    title: s.title,
    body: s.body,
    attachments: [],
    code_refs: [],
    sensitivity: "shareable_redacted",
    authored_by: "agent",
  }));
  if (sectionSpecs.length === 0) {
    notes.push("SKILL.md body had no content to map to knowledge sections.");
  }

  // scripts/* -> resources/ + one stub capability each, never auto-authorized.
  const scriptsDir = join(folder, "scripts");
  const scriptFiles = listFiles(scriptsDir);
  const resources: Record<string, Uint8Array> = {};
  const capabilities: ContractCapability[] = [];
  for (const file of scriptFiles) {
    const rel = relative(scriptsDir, file).split("\\").join("/");
    resources[`scripts/${rel}`] = readFileSync(file);
    const stem = basename(file, extname(file));
    capabilities.push({
      name: `run_${stem.replace(/[^a-zA-Z0-9_]/g, "_")}`,
      description: `Bundled script imported from scripts/${rel} (SKILL.md ingest). Requires explicit permission/consent wiring before this can execute — ingest never auto-authorizes it.`,
      side_effect_class: "exec",
      fallback: "ask_human",
      required: false,
    });
  }
  if (scriptFiles.length) {
    notes.push(
      `Imported ${scriptFiles.length} script(s) as stub capabilities (fallback=ask_human, required=false) — none are wired into a workflow step or authorized to execute.`,
    );
  }

  // references/*.md -> resources/references/ — Phase 4 formalizes progressive-disclosure load metadata.
  const referencesDir = join(folder, "references");
  const referenceFiles = listFiles(referencesDir);
  for (const file of referenceFiles) {
    const rel = relative(referencesDir, file).split("\\").join("/");
    resources[`references/${rel}`] = readFileSync(file);
  }
  if (referenceFiles.length) {
    notes.push(
      `Imported ${referenceFiles.length} reference file(s) under resources/references/. Progressive-disclosure load semantics (on_demand pointers) are formalized separately — see docs/RESOURCES.md.`,
    );
  }

  // assets/* -> container assets/.
  const assetsDir = join(folder, "assets");
  const assetFiles = listFiles(assetsDir);
  const assets: Record<string, Uint8Array> = {};
  for (const file of assetFiles) {
    const rel = relative(assetsDir, file).split("\\").join("/");
    assets[rel] = readFileSync(file);
  }

  // license -> SkillSource.license/license_url (+ a bundled LICENSE* file, if any).
  const licenseValue = asString(frontmatter.license);
  let licenseUrl: string | undefined;
  for (const candidate of ["LICENSE", "LICENSE.md", "LICENSE.txt"]) {
    const p = join(folder, candidate);
    if (existsSync(p)) {
      licenseUrl = friendlyPath(p);
      break;
    }
  }
  if (licenseValue) {
    notes.push(
      `Frontmatter "license: ${licenseValue}" mapped to SkillSource.license${licenseUrl ? ` (license_url set from bundled ${licenseUrl})` : ", no bundled LICENSE/LICENSE.md/LICENSE.txt found for license_url"}.`,
    );
  }

  // compatibility -> one human-check precondition + extensions.agentskills.compatibility, verbatim.
  const compatibilityValue = asString(frontmatter.compatibility);
  const preconditionItems: ContractPrecondition[] = [];
  if (compatibilityValue) {
    preconditionItems.push({
      id: "p1",
      assertion: `Agent Skills "compatibility" constraint from source SKILL.md: ${compatibilityValue}`,
      check: "human",
      on_failure:
        "Do not run this skill on a host outside the declared compatibility constraint without human review.",
    });
    notes.push(
      'Frontmatter "compatibility" mapped to one precondition (check=human) and extensions.agentskills.compatibility.',
    );
  }

  // allowed-tools -> extensions.agentskills.allowed_tools + one proposed permission per tool, never auto-authorized.
  const allowedToolsValue = asString(frontmatter["allowed-tools"]);
  const allowedTools = allowedToolsValue ? allowedToolsValue.split(/\s+/).filter(Boolean) : [];
  const permissionItems: ContractPermission[] = allowedTools.map((tool, i) => ({
    id: `perm_${i + 1}`,
    side_effect_class: "exec",
    description: `Agent Skills "allowed-tools" entry "${tool}" imported from SKILL.md frontmatter. Requires explicit human consent before use, ingest never auto-authorizes it, same deny-by-default posture as bundled scripts/*.`,
    consent: "explicit_human",
  }));
  if (allowedTools.length) {
    notes.push(
      `Imported ${allowedTools.length} allowed-tools entr${allowedTools.length === 1 ? "y" : "ies"} as proposed permission(s) (consent=explicit_human) and extensions.agentskills.allowed_tools, none are auto-authorized.`,
    );
  }

  // metadata (nested map) -> extensions.agentskills.metadata.*, verbatim, unactioned.
  const metadataMap =
    frontmatter.metadata && typeof frontmatter.metadata === "object" ? frontmatter.metadata : undefined;
  const metadataKeyCount = metadataMap ? Object.keys(metadataMap).length : 0;
  if (metadataKeyCount) {
    notes.push(
      `Imported ${metadataKeyCount} metadata ${metadataKeyCount === 1 ? "key" : "keys"} to extensions.agentskills.metadata.* verbatim, not interpreted or acted on by ingest.`,
    );
  }

  // Any other unrecognized frontmatter key (context, hooks, ...) -> extensions.agentskills.<key>, passthrough only.
  const knownFrontmatterKeys = new Set([
    "name",
    "description",
    "license",
    "compatibility",
    "allowed-tools",
    "metadata",
  ]);
  const passthroughExtensions: Record<string, FrontmatterValue> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (knownFrontmatterKeys.has(key)) continue;
    passthroughExtensions[key] = value;
  }
  if (Object.keys(passthroughExtensions).length) {
    notes.push(
      `Passed through unrecognized frontmatter key(s) [${Object.keys(passthroughExtensions).join(", ")}] to extensions.agentskills.* verbatim, never interpreted or acted on.`,
    );
  }

  const agentskillsExtensions: Record<string, unknown> = { ...passthroughExtensions };
  if (compatibilityValue) agentskillsExtensions.compatibility = compatibilityValue;
  if (allowedTools.length) agentskillsExtensions.allowed_tools = allowedTools;
  if (metadataMap && metadataKeyCount) agentskillsExtensions.metadata = metadataMap;
  const extensions = Object.keys(agentskillsExtensions).length
    ? { agentskills: agentskillsExtensions }
    : undefined;

  // evals/evals.json -> contract.verification.items.
  const evalsPath = join(folder, "evals", "evals.json");
  const verificationItems: VerificationAssertion[] = [
    {
      id: "v1",
      assertion: "The imported guidance was followed and produced a coherent, on-topic result.",
      check: "human",
      required: true,
    },
  ];
  let evalsFound = 0;
  if (existsSync(evalsPath)) {
    try {
      const entries = parseEvalsJson(readFileSync(evalsPath, "utf8"));
      let n = 1;
      for (const entry of entries) {
        const assertions = entry.assertions ?? [];
        for (const a of assertions) {
          n++;
          const text = typeof a === "string" ? a : (a.assertion ?? a.description ?? "");
          if (!text.trim()) continue;
          const check = typeof a === "object" ? a.check : undefined;
          verificationItems.push({
            id: `v${n}`,
            assertion: entry.prompt ? `${entry.prompt} — ${text}` : text,
            check: check ?? "human",
            required: true,
          });
          evalsFound++;
        }
      }
      if (evalsFound) {
        notes.push(
          `Mapped ${evalsFound} assertion(s) from evals/evals.json into contract.verification.items (default check="human" where the source didn't specify one). A native eval/benchmark loop is a separate phase — see docs/EVAL.md.`,
        );
      }
    } catch (e) {
      notes.push(
        `evals/evals.json exists but could not be parsed (${e instanceof Error ? e.message : String(e)}) — skipped, not mapped.`,
      );
    }
  }

  const nowIso = now();
  const contract: SkillContract = {
    kind: "skill_contract",
    contract_version: "1.0",
    skill_kind: "knowledge",
    title,
    intent: description || `Imported from SKILL.md at ${friendlyPath(skillMdPath)}; intent needs authoring.`,
    sensitivity: "private",
    triggers: { status: "specified", items: triggers },
    inputs: {
      status: "none",
      reason:
        "SKILL.md has no structured input schema. Declare inputs manually if this skill needs runtime inputs from the caller.",
    },
    preconditions: preconditionItems.length
      ? { status: "specified", items: preconditionItems }
      : {
          status: "none",
          reason: "Not specified in SKILL.md; add explicit preconditions if this skill requires prerequisite state.",
        },
    steps: {
      status: "specified",
      items: [
        {
          id: "s1",
          title: "Apply the imported guidance",
          kind: "instruct",
          instruction:
            "Follow the guidance captured in the imported knowledge sections when this skill's triggers apply.",
        },
        { id: "s2", title: "Emit outcome", kind: "emit", output: "result", from: "s1" },
      ],
    },
    branches: { status: "none", reason: "Not specified in SKILL.md." },
    human_decisions: { status: "none", reason: "Not specified in SKILL.md." },
    capabilities: capabilities.length
      ? { status: "specified", items: capabilities }
      : { status: "none", reason: "No bundled scripts found under scripts/." },
    permissions: permissionItems.length
      ? { status: "specified", items: permissionItems }
      : {
          status: "none",
          reason:
            "No permissions declared by ingest. If imported capabilities require network/filesystem/secret access, author explicit permissions before release, ingest never infers or auto-authorizes them.",
        },
    forbidden_actions: { status: "none", reason: "Not specified in SKILL.md." },
    outputs: {
      status: "specified",
      items: [
        {
          name: "result",
          description: "Outcome of applying the imported skill guidance.",
          schema: { type: "string" },
          required: true,
        },
      ],
    },
    recovery: {
      status: "not_applicable",
      reason: "Imported knowledge skill has no declared side effects to recover by default.",
    },
    verification: { status: "specified", items: verificationItems },
    corrections: { status: "none", reason: "Not specified in SKILL.md." },
    provenance: {
      evidence: {
        status: "specified",
        items: [
          {
            id: "e1",
            kind: "source",
            ref: friendlyPath(skillMdPath),
            supports: ["intent", "triggers"],
          },
        ],
      },
      limitations: {
        status: "specified",
        items: [
          "Imported via automated SKILL.md ingest: trigger phrases, the step sequence, and section boundaries are heuristically derived and have not been human-reviewed.",
        ],
      },
      human_review: { status: "not_reviewed" },
    },
  };

  const hash = sha256Digest(raw);
  const source: SkillSource = {
    kind: "skill_source",
    id: `src_${sha256Digest(raw).slice(7, 19)}`,
    hash,
    title,
    intent: contract.intent,
    contract,
    sections,
    steering: [],
    prompts: [],
    code_refs: [],
    parents: [],
    agent: { host: opts.host ?? "skill-ingest" },
    journey: {
      summary: `Imported from SKILL.md at ${friendlyPath(skillMdPath)} via \`skill ingest\`.`,
      redacted: false,
      sensitivity: "private",
    },
    inputs_declared: "none",
    sensitivity: "private",
    created_at: nowIso,
    actor: { id: "skill-ingest" },
    source_protocol_version: PROTOCOL_VERSION,
    license: licenseValue,
    license_url: licenseUrl,
    extensions,
    // A structured, reliably-detectable marker that this source came from
    // automated SKILL.md ingest — not free text buried in
    // provenance.limitations. Downstream evidence/scoring tooling (e.g.
    // @skillerr/skill-score's benchmark adapter) can check
    // source_refs.some(r => r.product === "skill-md-ingest") to honestly
    // tier structural/provenance evidence as self-reported rather than
    // observed, since triggers/steps/section boundaries here are
    // heuristically derived, not human-authored from scratch.
    source_refs: [{ product: "skill-md-ingest", kind: "automated_ingest", id: friendlyPath(skillMdPath), hash }],
  };

  const report: IngestReport = {
    source_path: skillMdPath,
    found: {
      name: nameFound,
      description: descriptionFound,
      sections: sections.length,
      scripts: scriptFiles.length,
      references: referenceFiles.length,
      assets: assetFiles.length,
      evals: evalsFound,
      license: !!licenseValue,
      compatibility: !!compatibilityValue,
      metadata_keys: metadataKeyCount,
      allowed_tools: allowedTools.length,
    },
    notes,
  };

  return { source, contract, resources, assets, report };
}
