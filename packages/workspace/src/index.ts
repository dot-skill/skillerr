/**
 * Local skill workspace — git-like working tree for `.skill`.
 *
 * Layout:
 *   .skill/
 *     config.json
 *     sections/<id>.json       # proposed units (AI agent)
 *     index.json               # staged ids
 *     HEAD.json                # last compiled package
 *     objects/<id>.skill       # continuity drafts / release packages
 */

import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type {
  CompletenessReport,
  GenerationUsage,
  SectionType,
  SkillCompileProfile,
  SkillContract,
  SkillSource,
  SkillSection,
} from "@skillerr/protocol";
import { isValidAgentHost, PROTOCOL_VERSION } from "@skillerr/protocol";
import {
  compileSkillSource,
  approveCompilation,
  mintSkillPackage,
  packSkill,
  redactSecrets,
  CompileRefusalError,
  type CompileResult,
} from "@skillerr/core";
import type { BenchmarkReport } from "@skillerr/protocol";

export const WORKSPACE_DIR = ".skill";

export interface WorkspaceSection {
  kind: "section";
  id: string;
  type: SectionType;
  title: string;
  body: string;
  fidelity: "exact" | "synthesize";
  created_at: string;
  updated_at: string;
  /** Always agent-authored in valid workflows. */
  source: "agent";
  meta?: Record<string, unknown>;
}

export interface WorkspaceIndex {
  staged: string[];
  updated_at: string;
}

export interface WorkspaceConfig {
  version: 1;
  title?: string;
  default_stage_all: boolean;
  created_at: string;
  journey_summary?: string;
  open_questions?: string[];
}

export interface WorkspaceHead {
  package_path?: string;
  package_digest?: string;
  skill_id?: string;
  mint_status?: "draft" | "minted";
  compile_profile?: SkillCompileProfile;
  updated_at: string;
}

function id(prefix: string): string {
  return `${prefix}_${createHash("sha256").update(randomUUID()).digest("hex").slice(0, 12)}`;
}

export function requireAgentHost(host?: string): string {
  const h = host ?? process.env.SKILL_HOST;
  if (!isValidAgentHost(h)) {
    throw new Error(
      "AI agent provenance required. Set SKILL_HOST=cursor|ollama|lmstudio|llama-cpp|custom-agent|… " +
        "(not human/cli/shell/manual). Env alone never yields verified_issuer trust.",
    );
  }
  return h!;
}

export function findWorkspaceRoot(start = process.cwd()): string | undefined {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, WORKSPACE_DIR, "config.json"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function requireWorkspace(cwd = process.cwd()): string {
  const root = findWorkspaceRoot(cwd);
  if (!root) {
    throw new Error(`Not a skill workspace (or any parent). Run: skill init`);
  }
  return root;
}

function paths(root: string) {
  const base = join(root, WORKSPACE_DIR);
  return {
    base,
    config: join(base, "config.json"),
    index: join(base, "index.json"),
    head: join(base, "HEAD.json"),
    sections: join(base, "sections"),
    /** @deprecated migrated from ingredients/ */
    ingredientsLegacy: join(base, "ingredients"),
    objects: join(base, "objects"),
    contract: join(base, "contract.json"),
    benchmark: join(base, "benchmark.json"),
  };
}

export interface ContractLoadResult {
  contract?: SkillContract;
  error?: string;
}

/**
 * Load the workspace's authored `.skill/contract.json`, if any.
 *
 * Absence is a normal, silent state (no contract authored yet). A present
 * but broken file is never silently dropped — callers get `error` and must
 * surface it (compile refusal on release, a loud report entry on
 * continuity) instead of quietly falling back to the legacy text path.
 */
export async function loadWorkspaceContract(root: string): Promise<ContractLoadResult> {
  const file = paths(root).contract;
  if (!existsSync(file)) return {};
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (e) {
    return { error: `.skill/contract.json could not be read: ${(e as Error).message}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { error: `.skill/contract.json is not valid JSON: ${(e as Error).message}` };
  }
  const candidate = parsed as { kind?: unknown; contract_version?: unknown };
  if (candidate.kind !== "skill_contract" || candidate.contract_version !== "1.0") {
    return {
      error:
        '.skill/contract.json does not look like a SkillContract (expected kind="skill_contract", contract_version="1.0")',
    };
  }
  return { contract: parsed as SkillContract };
}

/** Write an authored contract to `.skill/contract.json` (the authoring path for BUG-1). */
export async function saveWorkspaceContract(root: string, contract: SkillContract): Promise<void> {
  await mkdir(paths(root).base, { recursive: true });
  await writeFile(paths(root).contract, JSON.stringify(contract, null, 2) + "\n");
}

export async function initWorkspace(
  cwd = process.cwd(),
  opts: { title?: string } = {},
): Promise<{ root: string; created: boolean }> {
  const root = resolve(cwd);
  const p = paths(root);
  if (existsSync(p.config)) {
    return { root, created: false };
  }
  await mkdir(p.sections, { recursive: true });
  await mkdir(p.objects, { recursive: true });
  const config: WorkspaceConfig = {
    version: 1,
    title: opts.title,
    default_stage_all: true,
    created_at: new Date().toISOString(),
  };
  const index: WorkspaceIndex = { staged: [], updated_at: new Date().toISOString() };
  const head: WorkspaceHead = { updated_at: new Date().toISOString() };
  await writeFile(p.config, JSON.stringify(config, null, 2) + "\n");
  await writeFile(p.index, JSON.stringify(index, null, 2) + "\n");
  await writeFile(p.head, JSON.stringify(head, null, 2) + "\n");
  await writeFile(
    join(p.base, "README"),
    "Open .skill workspace. AI agent: skill propose → skill checkpoint|compile → skill mint.\nHuman reviews/stages; only agents create.\n",
  );
  return { root, created: true };
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export async function loadConfig(root: string): Promise<WorkspaceConfig> {
  return readJson(paths(root).config);
}

export async function saveConfig(root: string, config: WorkspaceConfig): Promise<void> {
  await writeFile(paths(root).config, JSON.stringify(config, null, 2) + "\n");
}

export async function loadIndex(root: string): Promise<WorkspaceIndex> {
  return readJson(paths(root).index);
}

export async function loadHead(root: string): Promise<WorkspaceHead> {
  const p = paths(root).head;
  if (!existsSync(p)) return { updated_at: new Date().toISOString() };
  return readJson(p);
}

async function listSectionFiles(root: string): Promise<WorkspaceSection[]> {
  const p = paths(root);
  const dirs = [p.sections, p.ingredientsLegacy].filter((d) => existsSync(d));
  const out: WorkspaceSection[] = [];
  const seen = new Set<string>();
  for (const dir of dirs) {
    const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      const raw = await readJson<WorkspaceSection & { kind?: string; source?: string }>(
        join(dir, f),
      );
      // Sections on disk are only ever agent-authored via proposeSection,
      // which always writes source:"agent". A file that declares a
      // different source was placed there some other way (e.g. a human
      // editing/adding it directly) — that must be rejected, not silently
      // relabeled as agent-authored (BUG-2 provenance washing).
      if (raw.source !== undefined && raw.source !== "agent") {
        throw new Error(
          `Section file ${join(dir, f)} declares source="${raw.source}", not "agent". ` +
            `Workspace sections must be agent-authored (skill propose); this file was not ` +
            `written by this workspace and will not be silently relabeled. Remove or fix it.`,
        );
      }
      const section: WorkspaceSection = {
        kind: "section",
        id: raw.id,
        type: raw.type,
        title: raw.title,
        body: raw.body,
        fidelity: raw.fidelity ?? "exact",
        created_at: raw.created_at,
        updated_at: raw.updated_at,
        source: "agent",
        meta: raw.meta,
      };
      if (!seen.has(section.id)) {
        seen.add(section.id);
        out.push(section);
      }
    }
  }
  return out.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function listSections(root: string): Promise<WorkspaceSection[]> {
  return listSectionFiles(root);
}

/** @deprecated use listSections */
export const listIngredients = listSections;

export async function proposeSection(
  root: string,
  input: {
    title: string;
    body: string;
    type?: SectionType;
    fidelity?: "exact" | "synthesize";
    id?: string;
    host?: string;
  },
): Promise<WorkspaceSection> {
  requireAgentHost(input.host);
  const section: WorkspaceSection = {
    kind: "section",
    id: input.id ?? id("sec"),
    type: input.type ?? "implementation_note",
    title: input.title,
    body: input.body,
    fidelity: input.fidelity ?? "exact",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    source: "agent",
  };
  await mkdir(paths(root).sections, { recursive: true });
  await writeFile(
    join(paths(root).sections, `${section.id}.json`),
    JSON.stringify(section, null, 2) + "\n",
  );
  const config = await loadConfig(root);
  if (config.default_stage_all) {
    await stage(root, [section.id]);
  }
  return section;
}

/** @deprecated use proposeSection */
export const proposeIngredient = proposeSection;

export async function proposeMany(
  root: string,
  items: Array<{
    title: string;
    body: string;
    type?: SectionType;
    fidelity?: "exact" | "synthesize";
  }>,
  host?: string,
): Promise<WorkspaceSection[]> {
  requireAgentHost(host);
  const out: WorkspaceSection[] = [];
  for (const item of items) {
    out.push(await proposeSection(root, { ...item, host }));
  }
  return out;
}

export async function setJourney(
  root: string,
  journey: { summary: string; open_questions?: string[] },
): Promise<WorkspaceConfig> {
  const config = await loadConfig(root);
  config.journey_summary = redactSecrets(journey.summary);
  config.open_questions = journey.open_questions?.map((q) => redactSecrets(q));
  await saveConfig(root, config);
  return config;
}

export async function stage(root: string, ids: string[] | "all"): Promise<WorkspaceIndex> {
  const all = await listSections(root);
  const byId = new Map(all.map((i) => [i.id, i]));
  const index = await loadIndex(root);
  const add = ids === "all" ? all.map((i) => i.id) : ids;
  for (const secId of add) {
    if (!byId.has(secId)) throw new Error(`Unknown section: ${secId}`);
    if (!index.staged.includes(secId)) index.staged.push(secId);
  }
  index.updated_at = new Date().toISOString();
  await writeFile(paths(root).index, JSON.stringify(index, null, 2) + "\n");
  return index;
}

export async function unstage(root: string, ids: string[] | "all"): Promise<WorkspaceIndex> {
  const index = await loadIndex(root);
  if (ids === "all") index.staged = [];
  else index.staged = index.staged.filter((x) => !ids.includes(x));
  index.updated_at = new Date().toISOString();
  await writeFile(paths(root).index, JSON.stringify(index, null, 2) + "\n");
  return index;
}

export interface StatusResult {
  root: string;
  title?: string;
  unstaged: WorkspaceSection[];
  staged: WorkspaceSection[];
  head: WorkspaceHead;
  completeness?: CompletenessReport;
  journey_summary?: string;
  agent_host_ok: boolean;
}

export async function status(root: string): Promise<StatusResult> {
  const config = await loadConfig(root);
  const index = await loadIndex(root);
  const all = await listSections(root);
  const stagedSet = new Set(index.staged);
  const staged = all.filter((i) => stagedSet.has(i.id));
  // Only the well-understood "no agent host declared yet" case is skipped —
  // `agent_host_ok` below already reports it. Any other failure (corrupted
  // section/contract file, a rejected non-agent section, …) must propagate;
  // a blanket catch here would silently swallow errors this module is
  // elsewhere careful to make loud (see BUG-2's listSectionFiles rejection).
  const agentHostOk = isValidAgentHost(process.env.SKILL_HOST);
  let completeness: CompletenessReport | undefined;
  if (staged.length && agentHostOk) {
    const source = await toSkillSource(root, staged, "status", "continuity");
    const { assessCompleteness } = await import("@skillerr/core");
    completeness = assessCompleteness(source, {
      profile: "release",
      hasWorkflowAction: staged.some((s) =>
        ["integration", "prompt", "implementation_note", "workflow_note", "code"].includes(
          s.type,
        ),
      ),
      hasKnowledge: staged.length > 0,
      hasInputsDeclared: true,
      pendingApprovals: [],
    });
  }
  return {
    root,
    title: config.title,
    staged,
    unstaged: all.filter((i) => !stagedSet.has(i.id)),
    head: await loadHead(root),
    completeness,
    journey_summary: config.journey_summary,
    agent_host_ok: isValidAgentHost(process.env.SKILL_HOST),
  };
}

async function toSkillSource(
  root: string,
  staged: WorkspaceSection[],
  title: string,
  profile: SkillCompileProfile,
  usage?: GenerationUsage,
  hostOverride?: string,
): Promise<SkillSource> {
  const host = requireAgentHost(hostOverride);
  const config = await loadConfig(root);
  const contractResult = await loadWorkspaceContract(root);
  const sections: SkillSection[] = staged.map((i) => ({
    id: i.id,
    revision: 1,
    type: i.type,
    title: i.title,
    body: i.body,
    attachments: [],
    code_refs: [],
    sensitivity: "shareable_redacted",
    authored_by: "agent",
  }));
  const sid = id("src");
  const hash =
    "sha256:" +
    createHash("sha256")
      .update(title + staged.map((s) => s.body).join(""))
      .digest("hex");
  return {
    kind: "skill_source",
    id: sid,
    hash,
    title,
    summary: config.journey_summary ?? title,
    intent: config.title ?? title,
    contract: contractResult.contract,
    contract_load_error: contractResult.error,
    sections,
    steering: [],
    prompts: [],
    code_refs: [],
    parents: [],
    agent: {
      host,
      provider: process.env.SKILL_PROVIDER,
      model: process.env.SKILL_MODEL,
      runtime: process.env.SKILL_AGENT_RUNTIME ?? "@skillerr/cli",
      deployment: (process.env.SKILL_DEPLOYMENT as
        | "local"
        | "hosted"
        | "hybrid"
        | "unknown"
        | undefined) ?? "unknown",
      endpoint: process.env.SKILL_ENDPOINT
        ? redactSecrets(process.env.SKILL_ENDPOINT)
        : undefined,
      session_ids: process.env.SKILL_SESSION_ID ? [process.env.SKILL_SESSION_ID] : [],
    },
    journey: {
      summary:
        config.journey_summary ??
        `Human+AI work on "${title}" (${staged.length} sections). Profile=${profile}.`,
      open_questions: config.open_questions,
      decisions: staged.filter((s) => s.type === "decision").map((s) => s.title),
      redacted: true,
      sensitivity: "shareable_redacted",
    },
    generation_usage: usage,
    inputs_declared: "none",
    sensitivity: "shareable_redacted",
    created_at: new Date().toISOString(),
    // Authorship reflects the agent that generated this source, never a
    // fabricated "human" default. A human semantic reviewer belongs in
    // contract.provenance.human_review, not here — see BUG-2.
    actor: { id: process.env.SKILL_ACTOR ?? `agent:${host}` },
    source_protocol_version: PROTOCOL_VERSION,
  };
}

function loadWorkspaceIdentity(): { name: string; version: string } {
  const metadata = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { name?: unknown; version?: unknown };
  if (typeof metadata.name !== "string" || typeof metadata.version !== "string") {
    throw new Error("Invalid @skillerr/workspace package metadata");
  }
  return { name: metadata.name, version: metadata.version };
}

const WORKSPACE_IDENTITY = loadWorkspaceIdentity();

export interface CompileWorkspaceOptions {
  title?: string;
  summary?: string;
  message?: string;
  add_all?: boolean;
  approve?: boolean;
  mint?: boolean;
  profile?: SkillCompileProfile;
  host?: string;
  agent_runtime?: string;
  agent_version?: string;
  generation_usage?: GenerationUsage;
  input_tokens?: number;
  output_tokens?: number;
}

export interface CompileWorkspaceResult {
  source: SkillSource;
  compile: CompileResult;
  package_path: string;
  minted?: boolean;
  package_digest: string;
  profile: SkillCompileProfile;
}

/**
 * Continuity checkpoint — partial OK, privacy-scrubbed handoff draft.
 */
export async function checkpoint(
  root: string,
  opts: CompileWorkspaceOptions = {},
): Promise<CompileWorkspaceResult> {
  return compileWorkspace(root, { ...opts, profile: "continuity", mint: false });
}

/**
 * Compile staged sections → `.skill`.
 * release profile refuses if incomplete; continuity allows partial.
 */
export async function compileWorkspace(
  root: string,
  opts: CompileWorkspaceOptions = {},
): Promise<CompileWorkspaceResult> {
  requireAgentHost(opts.host);
  const profile: SkillCompileProfile = opts.profile ?? "release";

  if (opts.add_all !== false) {
    await stage(root, "all");
  }
  const st = await status(root);
  if (st.staged.length === 0) {
    throw new Error(
      "Nothing staged. Agent must propose sections first (`skill propose`), then `skill add`.",
    );
  }

  // opts.message is a compile message, not a title, it must never silently
  // override a title the workspace already has configured (loadConfig).
  // It only stands in for a title when neither an explicit opts.title nor
  // a configured workspace title exists.
  const title =
    opts.title ?? (await loadConfig(root)).title ?? opts.message ?? st.staged[0]!.title;

  if (opts.summary) {
    await setJourney(root, { summary: opts.summary, open_questions: undefined });
  }

  const usage: GenerationUsage | undefined =
    opts.generation_usage ??
    (opts.input_tokens || opts.output_tokens
      ? {
          input_tokens: opts.input_tokens,
          output_tokens: opts.output_tokens,
          total_tokens: (opts.input_tokens ?? 0) + (opts.output_tokens ?? 0),
          reported_by: "agent",
          captured_at: new Date().toISOString(),
          host: process.env.SKILL_HOST,
          model: process.env.SKILL_MODEL,
        }
      : parseUsageFromEnv());

  const source = await toSkillSource(root, st.staged, title, profile, usage, opts.host);

  let compiled: CompileResult;
  try {
    compiled = compileSkillSource(source, {
      title,
      description: opts.summary ?? opts.message,
      profile,
      approve_inferred_inputs: opts.approve === true,
      approve_permissions: opts.approve === true,
      generation_usage: usage,
      provenance_mode: profile === "continuity" ? "redacted" : "full",
    });
  } catch (e) {
    if (e instanceof CompileRefusalError) {
      throw e;
    }
    throw e;
  }

  // PHASE 2: if `skill eval --attach` wrote .skill/benchmark.json before
  // this compile, seal it into provenance/benchmark.json — never fabricate
  // one; absence just means no eval ran yet, which is the common case.
  if (existsSync(paths(root).benchmark)) {
    const benchmark = JSON.parse(
      readFileSync(paths(root).benchmark, "utf8"),
    ) as BenchmarkReport;
    compiled = {
      ...compiled,
      files: {
        ...compiled.files,
        provenance: { ...compiled.files.provenance, benchmark },
      },
    };
    compiled.packageBytes = packSkill(compiled.files);
  }

  if (opts.approve === true) {
    compiled = approveCompilation(compiled, { inputs: ["*"], permissions: true });
  }

  let bytes = compiled.packageBytes;
  let minted = false;
  if (opts.mint) {
    if (profile !== "release") {
      throw new Error("Mint only allowed with --profile release (not continuity drafts).");
    }
    const agentRuntime =
      process.env.SKILL_AGENT_RUNTIME ?? opts.agent_runtime ?? WORKSPACE_IDENTITY.name;
    const agentVersion =
      process.env.SKILL_AGENT_VERSION ??
      opts.agent_version ??
      (agentRuntime === WORKSPACE_IDENTITY.name ? WORKSPACE_IDENTITY.version : "unknown");
    const sealed = mintSkillPackage(compiled.files, {
      host: requireAgentHost(opts.host),
      provider: process.env.SKILL_PROVIDER,
      model: process.env.SKILL_MODEL,
      deployment: (process.env.SKILL_DEPLOYMENT as
        | "local"
        | "hosted"
        | "hybrid"
        | "unknown"
        | undefined) ?? "unknown",
      endpoint: process.env.SKILL_ENDPOINT
        ? redactSecrets(process.env.SKILL_ENDPOINT)
        : undefined,
      // Only pass explicit actor evidence — never fabricate one. mint()
      // records attested:false and an empty actors list when this is unset.
      actors: process.env.SKILL_ACTOR ? [process.env.SKILL_ACTOR] : undefined,
      agent_runtime: agentRuntime,
      agent_version: agentVersion,
    });
    bytes = sealed.packageBytes;
    compiled = { ...compiled, files: sealed.files, packageBytes: sealed.packageBytes };
    minted = true;
  }

  const digest = compiled.files.manifest.package_digest;
  const outName = `${compiled.files.manifest.id}.skill`;
  const package_path = join(paths(root).objects, outName);
  await writeFile(package_path, bytes);

  const head: WorkspaceHead = {
    package_path,
    package_digest: digest,
    skill_id: compiled.files.manifest.id,
    mint_status: minted ? "minted" : "draft",
    compile_profile: profile,
    updated_at: new Date().toISOString(),
  };
  await writeFile(paths(root).head, JSON.stringify(head, null, 2) + "\n");
  await writeFile(join(root, outName), bytes);

  return {
    source,
    compile: compiled,
    package_path,
    minted,
    package_digest: digest,
    profile,
  };
}

/** @deprecated use compileWorkspace — Skillerr product term */
export async function bake(
  root: string,
  opts: CompileWorkspaceOptions & { publish?: boolean } = {},
): Promise<CompileWorkspaceResult & { published?: boolean }> {
  if (opts.publish) {
    throw new Error(
      "publish is not part of the open protocol happy path. Share the .skill file, or use a product registry later.",
    );
  }
  return compileWorkspace(root, opts);
}

function parseUsageFromEnv(): GenerationUsage | undefined {
  const input = process.env.SKILL_INPUT_TOKENS
    ? Number(process.env.SKILL_INPUT_TOKENS)
    : undefined;
  const output = process.env.SKILL_OUTPUT_TOKENS
    ? Number(process.env.SKILL_OUTPUT_TOKENS)
    : undefined;
  if (input == null && output == null) return undefined;
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: (input ?? 0) + (output ?? 0),
    reported_by: "agent",
    captured_at: new Date().toISOString(),
    host: process.env.SKILL_HOST,
    model: process.env.SKILL_MODEL,
  };
}

export async function discardSection(root: string, sectionId: string): Promise<void> {
  const p = paths(root);
  for (const dir of [p.sections, p.ingredientsLegacy]) {
    const file = join(dir, `${sectionId}.json`);
    if (existsSync(file)) await unlink(file);
  }
  await unstage(root, [sectionId]);
}

/** @deprecated */
export const discardIngredient = discardSection;

/** Load a continuity/release package for agent handoff resume. */
export async function loadSkillHandoff(packagePath: string): Promise<{
  skill_id: string;
  title: string;
  intent?: string;
  journey?: unknown;
  generation_usage?: unknown;
  completeness?: CompletenessReport;
  compile_profile?: SkillCompileProfile;
  knowledge: Array<{ id: string; title: string; type: string }>;
  open_questions?: string[];
  mint_status?: string;
}> {
  const { unpackSkill } = await import("@skillerr/core");
  const bytes = new Uint8Array(await readFile(resolve(packagePath)));
  const u = unpackSkill(bytes);
  const journey = u.raw.provenance?.journey as
    | { summary?: string; open_questions?: string[] }
    | undefined;
  return {
    skill_id: u.manifest.id,
    title: u.manifest.title,
    intent: u.manifest.intent,
    journey: u.raw.provenance?.journey,
    generation_usage: u.raw.provenance?.generation_usage,
    completeness: u.manifest.completeness,
    compile_profile: u.manifest.compile_profile,
    knowledge: u.knowledge.map((k) => ({ id: k.id, title: k.title, type: k.type })),
    open_questions: journey?.open_questions,
    mint_status: u.manifest.mint?.mint_status,
  };
}
