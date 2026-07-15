import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { SkillPackageFiles } from "@skillerr/protocol";

/**
 * PART B3: the reverse of `skill ingest`, takes a compiled/minted
 * `.skill` package and materializes a spec-valid Agent Skills folder
 * (`SKILL.md` + `scripts/`/`references/`/`assets/`). This is the fidelity
 * path: it restores license/compatibility/metadata/allowed-tools from the
 * `extensions.agentskills.*` slot B1's ingest wrote, and reconstructs the
 * body from knowledge sections (`## <title>` per item) rather than
 * `toSkillMdAdapter`'s workflow-step dump. `toSkillMdAdapter` remains the
 * quick single-file lossy export; this is the folder round-trip.
 */

export interface ExportReport {
  name: string;
  description_truncated: boolean;
  scripts: number;
  references: number;
  assets: number;
  license: boolean;
  compatibility: boolean;
  metadata_keys: number;
  allowed_tools: number;
  /** Non-fatal issues worth a human's attention, never silent. */
  warnings: string[];
}

export interface ExportResult {
  outDir: string;
  report: ExportReport;
}

const NAME_MAX = 64;
const DESCRIPTION_MAX = 1024;

/**
 * Agent Skills spec-valid slug: lowercase a-z0-9 and hyphens only, no
 * leading/trailing/consecutive hyphen, at most 64 characters. Constructed
 * so the result is always valid by construction (never emits something
 * that then needs a separate validation pass to catch).
 */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, NAME_MAX)
    .replace(/-+$/g, "");
}

/** Bare unquoted scalar when safe, otherwise a JSON string (valid YAML scalar too). */
function yamlScalar(value: string): string {
  if (/^[\w./-]+$/.test(value) && !/^(true|false|null)$/i.test(value)) return value;
  return JSON.stringify(value);
}

function writeFile(path: string, data: Uint8Array | string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof data === "string" ? data : Buffer.from(data));
}

/**
 * Derives the same spec-valid name `exportAgentSkillFolder` would use,
 * without writing anything, lets `--agent <host>` compute the target
 * directory up front, before the folder exists.
 */
export function deriveAgentSkillName(pkg: SkillPackageFiles): string {
  const titleSource = (pkg.manifest.contract?.title ?? pkg.manifest.title ?? "").trim();
  const name = slugify(titleSource);
  if (!name) {
    throw new Error(
      `Cannot export: no valid Agent Skills "name" could be derived from title "${titleSource}" (empty after slugifying to [a-z0-9-]). Give this skill a real title before exporting.`,
    );
  }
  return name;
}

export function exportAgentSkillFolder(pkg: SkillPackageFiles, outDir: string): ExportResult {
  const warnings: string[] = [];
  const manifest = pkg.manifest;

  const titleSource = (manifest.contract?.title ?? manifest.title ?? "").trim();
  const name = slugify(titleSource);
  if (!name) {
    throw new Error(
      `Cannot export: no valid Agent Skills "name" could be derived from title "${titleSource}" (empty after slugifying to [a-z0-9-]). Give this skill a real title before exporting.`,
    );
  }

  let description = (manifest.contract?.intent ?? manifest.intent ?? manifest.description ?? "").trim();
  let descriptionTruncated = false;
  if (description.length > DESCRIPTION_MAX) {
    description = description.slice(0, DESCRIPTION_MAX).trim();
    descriptionTruncated = true;
    warnings.push(`description truncated to ${DESCRIPTION_MAX} characters for Agent Skills frontmatter compliance.`);
  }
  if (!description) {
    throw new Error(
      'Cannot export: no intent/description available to populate the required Agent Skills "description" frontmatter field. Author one before exporting.',
    );
  }

  const outBase = basename(outDir);
  if (outBase !== name) {
    warnings.push(
      `Output directory basename "${outBase}" does not match the derived skill name "${name}": the Agent Skills spec requires them to match. Rename the directory, or use --agent <host> to have skillerr place it correctly.`,
    );
  }

  const agentskills = (manifest.extensions?.agentskills ?? {}) as Record<string, unknown>;
  const license = manifest.license;
  const compatibility = typeof agentskills.compatibility === "string" ? agentskills.compatibility : undefined;
  const metadata =
    agentskills.metadata && typeof agentskills.metadata === "object"
      ? (agentskills.metadata as Record<string, unknown>)
      : undefined;
  const allowedTools = Array.isArray(agentskills.allowed_tools)
    ? (agentskills.allowed_tools as unknown[]).filter((t): t is string => typeof t === "string")
    : [];

  const frontmatter: string[] = ["---", `name: ${name}`, `description: ${yamlScalar(description)}`];
  if (license) frontmatter.push(`license: ${yamlScalar(license)}`);
  if (compatibility) frontmatter.push(`compatibility: ${yamlScalar(compatibility)}`);
  if (allowedTools.length) frontmatter.push(`allowed-tools: ${allowedTools.join(" ")}`);
  const metadataKeys = metadata ? Object.keys(metadata) : [];
  if (metadataKeys.length) {
    frontmatter.push("metadata:");
    for (const key of metadataKeys) frontmatter.push(`  ${key}: ${yamlScalar(String(metadata![key]))}`);
  }
  frontmatter.push("---", "");

  const bodyLines: string[] = [`# ${titleSource}`, ""];
  for (const item of pkg.knowledge) {
    bodyLines.push(`## ${item.title}`, "", item.body.trim(), "");
  }
  const skillMd = `${frontmatter.join("\n")}${bodyLines.join("\n").replace(/\n+$/, "\n")}`;

  mkdirSync(outDir, { recursive: true });
  writeFile(join(outDir, "SKILL.md"), skillMd);

  let scripts = 0;
  let references = 0;
  for (const [path, data] of Object.entries(pkg.resources ?? {})) {
    if (path.startsWith("scripts/")) scripts++;
    else if (path.startsWith("references/")) references++;
    else continue;
    writeFile(join(outDir, path), data);
  }

  let assets = 0;
  for (const [path, data] of Object.entries(pkg.assets ?? {})) {
    assets++;
    writeFile(join(outDir, "assets", path), data);
  }

  return {
    outDir,
    report: {
      name,
      description_truncated: descriptionTruncated,
      scripts,
      references,
      assets,
      license: !!license,
      compatibility: !!compatibility,
      metadata_keys: metadataKeys.length,
      allowed_tools: allowedTools.length,
      warnings,
    },
  };
}

/** `--agent <host>` convenience: known Agent Skills install directory prefixes. */
export const AGENT_SKILLS_INSTALL_DIRS: Record<string, string> = {
  claude: ".claude/skills",
  cursor: ".cursor/skills",
};

export function resolveAgentSkillsDir(agent: string, name: string): string {
  const prefix = AGENT_SKILLS_INSTALL_DIRS[agent] ?? ".agents/skills";
  return join(prefix, name);
}
