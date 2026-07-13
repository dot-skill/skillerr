import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * PROTO-2 / RFC 0001: local, hand-editable pinned-key store for verifying
 * configured_ed25519 attestations. Mirrors the existing
 * `~/.skillerr/registry/` convention (local-first, no network dependency).
 * Never auto-loaded by @skillerr/core's verify path — a caller (the CLI, a
 * host) must load and pass it explicitly, so core stays free of implicit
 * filesystem/env lookups beyond what MintOptions/VerifyMintTrustOptions
 * already accept.
 */
export interface TrustStoreKey {
  key_id: string;
  public_key_pem: string;
  algorithm: "ed25519";
  allowed_hosts?: string[];
  not_before?: string;
  not_after?: string;
  comment?: string;
}

export interface TrustStore {
  version: 1;
  keys: TrustStoreKey[];
}

export function defaultTrustStorePath(): string {
  return join(homedir(), ".skillerr", "trust-store.json");
}

/** Missing file is a valid, empty trust store — not an error (no keys pinned yet). */
export function loadTrustStore(path: string = defaultTrustStorePath()): TrustStore {
  if (!existsSync(path)) return { version: 1, keys: [] };
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (
    typeof raw !== "object" ||
    raw === null ||
    (raw as { version?: unknown }).version !== 1 ||
    !Array.isArray((raw as { keys?: unknown }).keys)
  ) {
    throw new Error(`Invalid trust store at ${path}: expected {"version": 1, "keys": [...]}`);
  }
  return raw as TrustStore;
}
