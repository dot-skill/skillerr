import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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

export function saveTrustStore(store: TrustStore, path: string = defaultTrustStorePath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2) + "\n");
}

/**
 * Pin a public key in the trust store if its `key_id` isn't already present.
 * Idempotent, and returns whether it added a new entry. Used to auto-pin a
 * user's own auto-provisioned issuer key so their own `skill verify-trust`
 * earns verified_issuer (third parties still have to pin it themselves,
 * which is the whole point of a trust store.
 */
export function pinKeyToTrustStore(
  key: TrustStoreKey,
  path: string = defaultTrustStorePath(),
): { added: boolean } {
  const store = loadTrustStore(path);
  if (store.keys.some((k) => k.key_id === key.key_id)) return { added: false };
  store.keys.push(key);
  saveTrustStore(store, path);
  return { added: true };
}
