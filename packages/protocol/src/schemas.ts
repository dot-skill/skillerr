/**
 * PROTO-7: JSON Schemas for every container file, loadable at runtime so
 * `skill validate` can schema-check each entry instead of only checking
 * the hand-written required-field lists validate.ts already had. Paths
 * are resolved relative to this module's own compiled location (not the
 * caller's), so this works the same whether @skillerr/protocol is a
 * workspace symlink or an installed npm package.
 *
 * Each `new URL(literal, import.meta.url)` call below uses an inline
 * string literal, not a variable, on purpose: bundlers that statically
 * trace file dependencies (e.g. Vercel's @vercel/nft, used to decide
 * which files ship with a serverless function) only recognize this
 * asset-reference pattern when the path is a literal at the call site.
 * Reading the literal out of a lookup object first (as an earlier
 * version of this file did) defeats that analysis and silently drops
 * these schema files from bundled deployments.
 */
import { readFileSync } from "node:fs";

const SCHEMA_URLS = {
  "skill-contract": new URL("../skill-contract.schema.json", import.meta.url),
  "skill-manifest": new URL("../skill-manifest.schema.json", import.meta.url),
  workflow: new URL("../workflow.schema.json", import.meta.url),
  "knowledge-item": new URL("../knowledge-item.schema.json", import.meta.url),
  "creation-attestation": new URL("../creation-attestation.schema.json", import.meta.url),
  "anchor-statement": new URL("../skill-anchor-statement.schema.json", import.meta.url),
} as const;

export type SchemaName = keyof typeof SCHEMA_URLS;

export function loadSchema(name: SchemaName): Record<string, unknown> {
  const text = readFileSync(SCHEMA_URLS[name], "utf8");
  return JSON.parse(text) as Record<string, unknown>;
}
