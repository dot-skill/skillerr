import { zipSync, strToU8, strFromU8, Unzip, UnzipInflate } from "fflate";
import type { UnzipFile } from "fflate";
import type {
  KnowledgeItem,
  SkillManifest,
  SkillPackageFiles,
  Workflow,
  CompilationReport,
} from "@skillerr/protocol";
import { packageDigestFromContent, sealedManifestDigest, sha256Digest } from "./hash.js";
import {
  assertSafePaths,
  MAX_COMPRESSION_RATIO,
  MAX_ENTRIES,
  MAX_UNCOMPRESSED_BYTES,
  normalizePath,
} from "./paths.js";

/**
 * SEC-J: fixed zip entry mtime so packing the same content twice is
 * byte-identical. Zip's DOS-date encoding only represents 1980–2099, so
 * this can't be the Unix epoch (1970) — 1980-01-01 is the earliest
 * representable date and the conventional choice for reproducible zips.
 */
const EPOCH = new Date("1980-01-01T00:00:00Z");

/** Every unsafe-zip refusal gets a distinct, machine-readable code (SEC-D/E, feeds SEC-L fixtures). */
export class UnsafeZipError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "UnsafeZipError";
    this.code = code;
  }
}

function concatChunks(chunks: Uint8Array[], totalLength: number): Uint8Array {
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Streaming unzip with limits enforced incrementally during decompression,
 * not after it.
 *
 * SEC-D: `unzipSync` returns a plain object, so a crafted archive with two
 * entries of the same name (e.g. two `skill.json`) silently last-one-wins
 * before any duplicate check ever runs — a parser-differential attack.
 * fflate's streaming `Unzip` calls `onfile` for each local file header as
 * it's parsed, in archive order, *before* decompressing that entry's data —
 * duplicates are caught immediately, and the duplicate's payload is never
 * even decompressed.
 *
 * SEC-E: feeding the archive to the decoder in fixed-size chunks (rather
 * than one `unzipSync` call) means `ondata` fires incrementally as bytes
 * decode, so entry-count/uncompressed-size/ratio limits can abort mid-stream
 * — a zip bomb never gets fully inflated into memory before the DoS is
 * caught.
 */
function unzipWithLimits(archive: Uint8Array): Record<string, Uint8Array> {
  const seenNames = new Set<string>();
  const result: Record<string, Uint8Array> = {};
  let totalUncompressed = 0;
  let entryCount = 0;
  let aborted: UnsafeZipError | undefined;

  const reader = new Unzip();
  reader.register(UnzipInflate);
  reader.onfile = (file: UnzipFile) => {
    if (aborted) return;
    if (seenNames.has(file.name)) {
      aborted = new UnsafeZipError("duplicate_entry", `Duplicate zip entry: ${file.name}`);
      return;
    }
    seenNames.add(file.name);
    entryCount += 1;
    if (entryCount > MAX_ENTRIES) {
      aborted = new UnsafeZipError("too_many_entries", `Too many zip entries: ${entryCount}`);
      return;
    }
    const chunks: Uint8Array[] = [];
    let fileBytes = 0;
    file.ondata = (err, chunk, final) => {
      if (aborted) return;
      if (err) {
        aborted =
          err instanceof UnsafeZipError
            ? err
            : new UnsafeZipError("inflate_error", err instanceof Error ? err.message : String(err));
        return;
      }
      if (chunk && chunk.length) {
        fileBytes += chunk.length;
        totalUncompressed += chunk.length;
        chunks.push(chunk);
        if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
          aborted = new UnsafeZipError(
            "uncompressed_size_exceeded",
            "Uncompressed size exceeds limit",
          );
          file.terminate();
          return;
        }
        const ratio = archive.byteLength > 0 ? totalUncompressed / archive.byteLength : 0;
        if (ratio > MAX_COMPRESSION_RATIO && totalUncompressed > 1_000_000) {
          aborted = new UnsafeZipError(
            "suspicious_compression_ratio",
            "Suspicious compression ratio",
          );
          file.terminate();
          return;
        }
      }
      if (final && !aborted) {
        result[file.name] = concatChunks(chunks, fileBytes);
      }
    };
    file.start();
  };

  const CHUNK_SIZE = 64 * 1024;
  if (archive.length === 0) {
    reader.push(archive, true);
  } else {
    for (let offset = 0; offset < archive.length && !aborted; offset += CHUNK_SIZE) {
      const end = Math.min(offset + CHUNK_SIZE, archive.length);
      reader.push(archive.subarray(offset, end), end >= archive.length);
    }
  }
  if (aborted) throw aborted;
  return result;
}

function toBytes(data: string | Uint8Array): Uint8Array {
  return typeof data === "string" ? strToU8(data) : data;
}

function textEncode(obj: unknown): Uint8Array {
  return strToU8(JSON.stringify(obj, null, 2) + "\n");
}

export interface PackOptions {
  recomputeDigests?: boolean;
}

export function buildFileMap(pkg: SkillPackageFiles): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  files["workflow.json"] = textEncode(pkg.workflow);
  for (const item of pkg.knowledge) {
    files[`knowledge/${item.id}.json`] = textEncode(item);
  }
  if (pkg.prompts) {
    for (const [name, body] of Object.entries(pkg.prompts)) {
      files[`prompts/${normalizePath(name)}`] = toBytes(body);
    }
  }
  if (pkg.resources) {
    for (const [name, body] of Object.entries(pkg.resources)) {
      files[`resources/${normalizePath(name)}`] = toBytes(body);
    }
  }
  if (pkg.artifacts) {
    for (const [name, body] of Object.entries(pkg.artifacts)) {
      files[`artifacts/${normalizePath(name)}`] = toBytes(body);
    }
  }
  if (pkg.assets) {
    for (const [name, body] of Object.entries(pkg.assets)) {
      files[`assets/${normalizePath(name)}`] = toBytes(body);
    }
  }
  if (pkg.provenance?.recipe) {
    files["provenance/recipe.json"] = textEncode(pkg.provenance.recipe);
  }
  if (pkg.provenance?.source) {
    files["provenance/source.json"] = textEncode(pkg.provenance.source);
  }
  if (pkg.provenance?.journey) {
    files["provenance/journey.json"] = textEncode(pkg.provenance.journey);
  }
  if (pkg.provenance?.generation_usage) {
    files["provenance/generation_usage.json"] = textEncode(pkg.provenance.generation_usage);
  }
  if (pkg.provenance?.proof) {
    files["provenance/proof.json"] = textEncode(pkg.provenance.proof);
  }
  if (pkg.provenance?.compilation_report) {
    files["provenance/compilation_report.json"] = textEncode(
      pkg.provenance.compilation_report,
    );
  }
  if (pkg.provenance?.benchmark) {
    files["provenance/benchmark.json"] = textEncode(pkg.provenance.benchmark);
  }
  if (pkg.provenance?.score) {
    files["provenance/score.json"] = textEncode(pkg.provenance.score);
  }
  if (pkg.attestation && !pkg.signatures?.["creation.dsse.json"]) {
    files["signatures/creation.attestation.json"] = textEncode(pkg.attestation);
  }
  if (pkg.signatures) {
    for (const [name, body] of Object.entries(pkg.signatures)) {
      files[`signatures/${normalizePath(name)}`] = textEncode(body);
    }
  }
  if (pkg.anchors) {
    pkg.anchors.forEach((anchor, i) => {
      const path = `signatures/anchors/${i}-${anchor.kind}.json`;
      if (!files[path]) files[path] = textEncode(anchor);
    });
  }
  return files;
}

/**
 * Content index covers every file except `skill.json` and `signatures/**`.
 * `package_digest` is the digest of that index (RFC8785 JCS + SHA-256).
 */
export function finalizeManifest(
  base: Omit<SkillManifest, "content" | "package_digest" | "manifest_digest"> &
    Partial<Pick<SkillManifest, "content" | "package_digest" | "manifest_digest">>,
  files: Record<string, Uint8Array>,
): SkillManifest {
  const content = Object.keys(files)
    .filter((p) => p !== "skill.json" && !p.startsWith("signatures/"))
    .sort()
    .map((path) => ({
      path,
      digest: sha256Digest(files[path]!),
      bytes: files[path]!.byteLength,
    }));
  const withoutDigest = {
    ...base,
    mint: base.mint ?? { mint_status: "draft" },
    content,
    package_digest: packageDigestFromContent(content),
  } as SkillManifest;
  // SEC-F: a self-digest over the same claim set as sealed_manifest_digest,
  // computed here so every package — draft or minted — has an integrity
  // binding over permissions/capabilities/policy, not only minted ones.
  return { ...withoutDigest, manifest_digest: sealedManifestDigest(withoutDigest) };
}

export function packSkill(pkg: SkillPackageFiles, _opts: PackOptions = {}): Uint8Array {
  const files = buildFileMap(pkg);
  const manifest = finalizeManifest(pkg.manifest, files);
  files["skill.json"] = textEncode(manifest);
  assertSafePaths(Object.keys(files));
  if (Object.keys(files).length > MAX_ENTRIES) {
    throw new Error(`Too many entries: ${Object.keys(files).length}`);
  }
  let total = 0;
  for (const bytes of Object.values(files)) total += bytes.byteLength;
  if (total > MAX_UNCOMPRESSED_BYTES) {
    throw new Error(`Package too large: ${total} bytes`);
  }
  // SEC-J: deterministic zip. Sorted entry order (buildFileMap's own
  // insertion order isn't a promised contract) and a fixed per-entry mtime
  // — fflate defaults mtime to wall-clock, so packing byte-identical
  // content twice previously produced different archives every time.
  // Single compression level (6, uniform) and forward-slash paths
  // (normalizePath already guarantees this) round out determinism.
  const deterministic: Record<string, [Uint8Array, { level: 6; mtime: Date }]> = {};
  for (const path of Object.keys(files).sort()) {
    deterministic[path] = [files[path]!, { level: 6, mtime: EPOCH }];
  }
  return zipSync(deterministic);
}

export interface UnpackResult {
  files: Record<string, Uint8Array>;
  manifest: SkillManifest;
  workflow: Workflow;
  knowledge: KnowledgeItem[];
  compilation_report?: CompilationReport;
  raw: SkillPackageFiles;
}

export function unpackSkill(archive: Uint8Array): UnpackResult {
  if (archive.byteLength > MAX_UNCOMPRESSED_BYTES * 2) {
    throw new UnsafeZipError("archive_too_large", "Archive too large to unpack");
  }
  // Duplicate-entry rejection and entry-count/size/ratio limits are enforced
  // incrementally inside unzipWithLimits (SEC-D/E) — never after the fact.
  const unzipped = unzipWithLimits(archive);
  const paths = Object.keys(unzipped);
  assertSafePaths(paths);

  const skillJson = unzipped["skill.json"];
  if (!skillJson) throw new Error("Missing skill.json");
  const workflowJson = unzipped["workflow.json"];
  if (!workflowJson) throw new Error("Missing workflow.json");

  const manifest = JSON.parse(strFromU8(skillJson)) as SkillManifest;
  const workflow = JSON.parse(strFromU8(workflowJson)) as Workflow;
  const knowledge: KnowledgeItem[] = [];
  for (const [path, data] of Object.entries(unzipped)) {
    if (path.startsWith("knowledge/") && path.endsWith(".json")) {
      knowledge.push(JSON.parse(strFromU8(data)) as KnowledgeItem);
    }
  }

  let compilation_report: CompilationReport | undefined;
  if (unzipped["provenance/compilation_report.json"]) {
    compilation_report = JSON.parse(
      strFromU8(unzipped["provenance/compilation_report.json"]!),
    ) as CompilationReport;
  }

  const prompts: Record<string, string> = {};
  const resources: Record<string, Uint8Array> = {};
  const artifacts: Record<string, Uint8Array> = {};
  const assets: Record<string, Uint8Array> = {};
  const signatures: Record<string, unknown> = {};
  for (const [path, data] of Object.entries(unzipped)) {
    if (path.startsWith("prompts/")) prompts[path.slice("prompts/".length)] = strFromU8(data);
    if (path.startsWith("resources/")) resources[path.slice("resources/".length)] = data;
    if (path.startsWith("artifacts/")) artifacts[path.slice("artifacts/".length)] = data;
    if (path.startsWith("assets/")) assets[path.slice("assets/".length)] = data;
    if (path.startsWith("signatures/") && path.endsWith(".json")) {
      signatures[path.slice("signatures/".length)] = JSON.parse(strFromU8(data));
    }
  }

  const creation = signatures["creation.dsse.json"] as
    | { attestation?: import("@skillerr/protocol").CreationAttestation }
    | undefined;
  const attestation =
    creation?.attestation ??
    (signatures["creation.attestation.json"] as
      | import("@skillerr/protocol").CreationAttestation
      | undefined);
  const anchorsFromSig = Object.entries(signatures)
    .filter(([k]) => k.startsWith("anchors/"))
    .map(([, v]) => v as import("@skillerr/protocol").PermanenceAnchor);

  const raw: SkillPackageFiles = {
    manifest,
    workflow,
    knowledge,
    prompts,
    artifacts,
    resources,
    assets,
    provenance: {
      recipe: unzipped["provenance/recipe.json"]
        ? JSON.parse(strFromU8(unzipped["provenance/recipe.json"]))
        : undefined,
      source: unzipped["provenance/source.json"]
        ? JSON.parse(strFromU8(unzipped["provenance/source.json"]))
        : undefined,
      journey: unzipped["provenance/journey.json"]
        ? JSON.parse(strFromU8(unzipped["provenance/journey.json"]))
        : undefined,
      generation_usage: unzipped["provenance/generation_usage.json"]
        ? JSON.parse(strFromU8(unzipped["provenance/generation_usage.json"]))
        : undefined,
      proof: unzipped["provenance/proof.json"]
        ? JSON.parse(strFromU8(unzipped["provenance/proof.json"]))
        : undefined,
      compilation_report,
      benchmark: unzipped["provenance/benchmark.json"]
        ? JSON.parse(strFromU8(unzipped["provenance/benchmark.json"]))
        : undefined,
      score: unzipped["provenance/score.json"]
        ? JSON.parse(strFromU8(unzipped["provenance/score.json"]))
        : undefined,
    },
    signatures,
    attestation,
    anchors: manifest.anchors?.length ? manifest.anchors : anchorsFromSig,
  };

  return { files: unzipped, manifest, workflow, knowledge, compilation_report, raw };
}
