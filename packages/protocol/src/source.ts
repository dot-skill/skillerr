/**
 * Protocol-native source for the skill compiler.
 *
 * Products (Skillerr, etc.) may use their own words (ingredient, recipe, bake).
 * Adapters map those into SkillSource / SkillSection before compile.
 */

import type { SkillContract, SkillCandidate } from "./contract.js";
import type { GenerationUsage, JourneyProvenance, PackageSensitivity } from "./types.js";

export type SectionType =
  | "prompt"
  | "decision"
  | "architecture"
  | "diagram"
  | "integration"
  | "resource"
  | "reference"
  | "lesson"
  | "requirement"
  | "tradeoff"
  | "risk"
  | "question"
  | "implementation_note"
  | "config"
  | "correction_note"
  | "doc"
  | "message"
  | "handoff"
  | "code"
  | "intent"
  | "workflow_note";

export type SectionAuthor = "agent" | "human_via_agent";

export interface CodeRef {
  forge?: string;
  repo: string;
  commit?: string;
  path?: string;
  range?: string;
  pr?: number;
}

export interface Attachment {
  id: string;
  kind: "diagram" | "image" | "config" | "file" | "other";
  title?: string;
  content?: string;
  uri?: string;
  mediaType?: string;
}

export interface PersonRef {
  id: string;
  display_name?: string;
}

export type SteeringVerb = "affirm" | "correct" | "reject";
export type CaptureFidelity = "exact" | "synthesize";

export interface SkillSection {
  id: string;
  revision: number;
  type: SectionType;
  title: string;
  body: string;
  attachments: Attachment[];
  code_refs: CodeRef[];
  /** Never embed secret values — sensitivity guides redaction. */
  sensitivity: PackageSensitivity;
  /** Declared authoring path for this section. */
  authored_by: SectionAuthor;
}

export interface SteeringEvent {
  kind: "steering";
  id: string;
  session_id: string;
  verb: SteeringVerb;
  target_kind: "section" | "turn" | "other" | "ingredient";
  target_id: string;
  note?: string;
  actor: PersonRef;
  at: string;
}

export interface PromptVersion {
  kind: "prompt";
  id: string;
  lineage_id: string;
  version: number;
  body: string;
  origin: "user" | "ai_generated" | "imported";
  parent_version?: number;
  session_id?: string;
  created_at: string;
}

/** Required AI agent identity for any compile path. */
export interface AgentContext {
  /** Host/app that ran the agent: cursor | ollama | lmstudio | custom-agent | … */
  host: string;
  /** Model provider/runtime family; provider-neutral and local-friendly. */
  provider?: string;
  model?: string;
  runtime?: string;
  /** Where inference ran. This is provenance, not proof. */
  deployment?: "local" | "hosted" | "hybrid" | "unknown";
  /** Optional endpoint identifier. Must not contain credentials. */
  endpoint?: string;
  session_ids?: string[];
}

/**
 * Protocol input to the compiler.
 * Products adapt their capture model into this shape.
 */
export interface SkillSource {
  kind: "skill_source";
  id: string;
  hash: string;
  title: string;
  summary?: string;
  intent?: string;
  /**
   * 0.5 source of truth for transferable semantics. A missing contract marks
   * a 0.4-compatible text source and is release-lossy.
   */
  contract?: SkillContract;
  /**
   * Set by an adapter (e.g. workspace) when a contract was found on disk but
   * could not be parsed/used, so `!contract` never silently means "not
   * authored" when it actually means "authored but broken". Compilers must
   * surface this distinctly (contract_unparsable vs contract_missing).
   */
  contract_load_error?: string;
  /** Optional extraction candidates. Segmentation belongs to an adapter/AI, not the compiler. */
  candidates?: SkillCandidate[];
  sections: SkillSection[];
  steering: SteeringEvent[];
  prompts: PromptVersion[];
  code_refs: CodeRef[];
  parents: string[];
  agent: AgentContext;
  journey: JourneyProvenance;
  generation_usage?: GenerationUsage;
  /** Explicitly declare that the source needs no runtime inputs. */
  inputs_declared?: "inferred" | "none";
  sensitivity: PackageSensitivity;
  created_at: string;
  actor: PersonRef;
  source_protocol_version: string;
  /** Optional product-specific source refs (e.g. Skillerr recipe id). */
  source_refs?: Array<{ product: string; kind: string; id: string; hash?: string }>;
  /** SPDX license identifier (e.g. "MIT") or "UNLICENSED" — carried through to the manifest, see its own doc comment for what this does and doesn't prove. */
  license?: string;
  license_url?: string;
}

/**
 * Hosts that are not valid AI agent runtimes for skill creation / mint.
 * Humans exporting SKILL_HOST=cli|shell|manual must never mint as an agent.
 */
export const FORBIDDEN_AGENT_HOSTS = new Set([
  "",
  "human",
  "manual",
  "none",
  "cli",
  "user",
  "shell",
  "bash",
  "zsh",
  "sh",
  "fish",
  "powershell",
  "pwsh",
  "cmd",
  "terminal",
  "console",
  "tty",
  "stdin",
  "keyboard",
  "local-shell",
  "human-cli",
  "operator",
]);

export function isValidAgentHost(host: string | undefined | null): boolean {
  if (!host) return false;
  return !FORBIDDEN_AGENT_HOSTS.has(host.trim().toLowerCase());
}

/**
 * Process / mint markers that indicate an agent runtime path (not a bare human shell).
 * These are still spoofable by a determined local process — residual risk remains —
 * but a human who only exports SKILL_HOST=cursor without any agent context fails this check.
 */
export const AGENT_RUNTIME_MARKER_ENVS = [
  "CURSOR_AGENT",
  "CURSOR_TRACE_ID",
  "COMPOSER_SESSION_ID",
  "SKILL_AGENT_INVOCATION",
  "SKILL_SESSION_ID",
  "CLAUDE_CODE_ENTRYPOINT",
  "AIDER_ACTIVE",
] as const;

export function detectAgentRuntimeMarkers(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const found: string[] = [];
  for (const key of AGENT_RUNTIME_MARKER_ENVS) {
    const v = env[key];
    if (v !== undefined && String(v).trim() !== "") found.push(key);
  }
  return found;
}

export function hasAgentRuntimeEvidence(
  evidence?: { markers?: string[]; session_id?: string } | null,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (evidence?.session_id && evidence.session_id.trim()) return true;
  if (evidence?.markers?.some((m) => m.trim())) return true;
  return detectAgentRuntimeMarkers(env).length > 0;
}
