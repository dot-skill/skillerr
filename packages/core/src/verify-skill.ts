import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { TrustState } from "@skillerr/protocol";
import { sha256Digest, packageDigestFromContent } from "./hash.js";
import { unpackSkill } from "./pack.js";
import { verifyMintTrust, type VerifyMintTrustOptions } from "./mint.js";

/**
 * PART B4: a lightweight check for a *plain* Agent Skills folder, one
 * that was never ingested/sealed by skillerr at all, e.g. right after
 * `npx skills add owner/repo`. There is no established protocol
 * convention for attaching a detached seal to an arbitrary folder, so
 * this is deliberately narrow: report the folder's own content digest and
 * its executable surface (scripts/*) unconditionally, and, only if the
 * caller points at (or a sibling `<dir>.skill` supplies) an actual sealed
 * `.skill`, report that package's own attestation integrity honestly.
 *
 * This never claims the sealed package's digest *matches* the plain
 * folder's current files: a `.skill` archive and a plain Agent Skills
 * folder have structurally different content layouts (workflow.json,
 * knowledge/*.json, etc. have no folder equivalent), so a byte-exact
 * comparison isn't a well-defined operation here. What IS checked, and
 * reported as such, is whether the attestation itself is validly signed
 * and internally unmodified since sealing.
 */

export interface VerifySkillReport {
  dir: string;
  folder_digest: string;
  files: number;
  /** scripts/* paths, unconditionally flagged as executable surface, sealed or not. */
  executable_surface: string[];
  attestation:
    | {
        found: false;
        note: string;
      }
    | {
        found: true;
        source: string;
        skill_id: string;
        title: string;
        trust_state: TrustState;
        issuer_class?: string;
        note: string;
      };
}

function walkFolder(dir: string): Array<{ path: string; bytes: Uint8Array }> {
  const out: Array<{ path: string; bytes: Uint8Array }> = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push({ path: relative(dir, full).split("\\").join("/"), bytes: readFileSync(full) });
    }
  };
  walk(dir);
  return out;
}

export interface VerifySkillOptions {
  /** Explicit sidecar path. Falls back to a sibling `<dir>.skill` if omitted. */
  attestationPath?: string;
  trustOptions?: VerifyMintTrustOptions;
}

export function verifySkillFolder(dir: string, opts: VerifySkillOptions = {}): VerifySkillReport {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`Not a folder: ${dir}`);
  }
  const files = walkFolder(dir);
  const content = files
    .map((f) => ({ path: f.path, digest: sha256Digest(f.bytes) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const folderDigest = packageDigestFromContent(content);
  const executableSurface = files
    .map((f) => f.path)
    .filter((p) => p.startsWith("scripts/"))
    .sort();

  const attestationPath = opts.attestationPath ?? `${dir}.skill`;
  if (!existsSync(attestationPath)) {
    return {
      dir,
      folder_digest: folderDigest,
      files: files.length,
      executable_surface: executableSurface,
      attestation: {
        found: false,
        note:
          "No attestation found for this folder, nothing cryptographic to check. scripts/* (if any, listed above) are unverified executable surface. Pass --attestation <file.skill> if you have one, or run `skill ingest` + `skill mint` to seal this folder yourself.",
      },
    };
  }

  const bytes = readFileSync(attestationPath);
  const unpacked = unpackSkill(new Uint8Array(bytes));
  const result = verifyMintTrust(new Uint8Array(bytes), "open", opts.trustOptions);

  return {
    dir,
    folder_digest: folderDigest,
    files: files.length,
    executable_surface: executableSurface,
    attestation: {
      found: true,
      source: attestationPath,
      skill_id: unpacked.manifest.id,
      title: unpacked.manifest.contract?.title ?? unpacked.manifest.title,
      trust_state: result.trust_state,
      issuer_class: result.attestation?.issuer_class,
      note:
        "This confirms the attestation itself is validly signed and unmodified since sealing. It does NOT prove this folder's current files are byte-identical to what was sealed (a plain folder and a .skill archive have different content layouts, so that comparison isn't well-defined here). Compare skill_id/title above by hand, or re-run `skill export-skill` and diff.",
    },
  };
}
