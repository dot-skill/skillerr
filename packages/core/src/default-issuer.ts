import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { sha256Hex } from "./hash.js";
import { createEd25519Signer, derivePublicKeyPem, type IssuerSigner } from "./signer.js";
import { defaultTrustStorePath, pinKeyToTrustStore } from "./trust-store.js";

/**
 * A per-user, persistent Ed25519 issuer key so the frictionless publish
 * path can produce a public transparency URL with zero setup. The public
 * Rekor log needs a signing key but NO login/OIDC (that's only the
 * `--keyless`/Fulcio path), so a locally-generated key is enough to anchor.
 *
 * This key is the user's own identity: reused across mints (stable issuer),
 * stored 0600, and its public half is pinned in the user's own trust store
 * so their own `skill verify-trust` earns verified_issuer. Third parties
 * still have to pin it to trust it: a self-generated key is not a
 * publicly-known identity, exactly as documented for verified_issuer.
 */

export function skillerrHomeDir(): string {
  return join(homedir(), ".skillerr");
}

export function defaultIssuerKeyPath(): string {
  return join(skillerrHomeDir(), "issuer-key.pem");
}

/** Stable, deterministic key id derived from the public key, so it never drifts. */
export function issuerKeyIdFor(publicKeyPem: string): string {
  return `skillerr-issuer-${sha256Hex(publicKeyPem).slice(0, 12)}`;
}

export interface ResolvedIssuer {
  key_id: string;
  private_key_pem: string;
  public_key_pem: string;
  key_path: string;
  /** True when this call generated a brand-new key (first run). */
  created: boolean;
  /** True when the public key was newly pinned to the trust store this call. */
  pinned: boolean;
}

export function generateEd25519KeyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return { privateKeyPem: privateKey as unknown as string, publicKeyPem: publicKey as unknown as string };
}

/** Load the default issuer key if it already exists, without creating one. */
export function loadDefaultIssuer(keyPath: string = defaultIssuerKeyPath()): ResolvedIssuer | undefined {
  if (!existsSync(keyPath)) return undefined;
  const private_key_pem = readFileSync(keyPath, "utf8");
  const public_key_pem = derivePublicKeyPem(private_key_pem);
  return {
    key_id: issuerKeyIdFor(public_key_pem),
    private_key_pem,
    public_key_pem,
    key_path: keyPath,
    created: false,
    pinned: false,
  };
}

/**
 * Load the default issuer key, generating and persisting one on first use.
 * On creation, also pins the public key in the user's own trust store.
 */
export function loadOrCreateDefaultIssuer(
  opts: { keyPath?: string; trustStorePath?: string } = {},
): ResolvedIssuer {
  const keyPath = opts.keyPath ?? defaultIssuerKeyPath();
  const existing = loadDefaultIssuer(keyPath);
  if (existing) {
    // Pin is idempotent, so re-pin defensively (e.g. if the store was reset).
    const { added } = pinKeyToTrustStore(
      {
        key_id: existing.key_id,
        public_key_pem: existing.public_key_pem,
        algorithm: "ed25519",
        comment: "Auto-provisioned skillerr issuer key (this machine).",
      },
      opts.trustStorePath ?? defaultTrustStorePath(),
    );
    return { ...existing, pinned: added };
  }

  const { privateKeyPem, publicKeyPem } = generateEd25519KeyPair();
  mkdirSync(dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, privateKeyPem, { mode: 0o600 });
  const key_id = issuerKeyIdFor(publicKeyPem);
  const { added } = pinKeyToTrustStore(
    {
      key_id,
      public_key_pem: publicKeyPem,
      algorithm: "ed25519",
      comment: "Auto-provisioned skillerr issuer key (this machine).",
    },
    opts.trustStorePath ?? defaultTrustStorePath(),
  );
  return {
    key_id,
    private_key_pem: privateKeyPem,
    public_key_pem: publicKeyPem,
    key_path: keyPath,
    created: true,
    pinned: added,
  };
}

export function signerFromIssuer(issuer: ResolvedIssuer): IssuerSigner {
  return createEd25519Signer(issuer.private_key_pem, issuer.key_id);
}
