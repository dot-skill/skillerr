import { createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import type { IssuerClass } from "@skillerr/protocol";

/**
 * PROTO-2 / RFC 0001: pluggable issuer signer.
 *
 * mintSkillPackage's default path (no `signer` supplied) stays exactly what
 * it always was — HMAC-SHA256 against `issuer_secret` (public-dev key when
 * absent). This module is the *alternative* path: a real asymmetric signer
 * so `verified_issuer` trust can mean "signed by a key I pinned, that
 * whoever forged this seal never held" instead of "shares my HMAC secret."
 */
export interface IssuerSigner {
  sig_alg: "ed25519-v1";
  key_id: string;
  issuer_class: Extract<IssuerClass, "configured_ed25519">;
  sign(payloadDigest: string): string;
}

/**
 * `privateKeyPem` is a standard PKCS8 PEM (e.g. from
 * `openssl genpkey -algorithm ed25519`). Node's Ed25519 support signs raw
 * bytes directly — no digest algorithm is passed to `sign()` (Ed25519 does
 * its own internal hashing), which is why this takes the payload digest
 * *string* and signs its UTF-8 bytes, matching how the HMAC path signs the
 * same string today.
 */
export function createEd25519Signer(privateKeyPem: string, keyId: string): IssuerSigner {
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error(
      `Signer key_id "${keyId}" is not an Ed25519 private key (got "${key.asymmetricKeyType}"). ` +
        `Generate one with: openssl genpkey -algorithm ed25519`,
    );
  }
  return {
    sig_alg: "ed25519-v1",
    key_id: keyId,
    issuer_class: "configured_ed25519",
    sign(payloadDigest: string): string {
      const sig = cryptoSign(null, Buffer.from(payloadDigest, "utf8"), key);
      return sig.toString("base64");
    },
  };
}

/**
 * `publicKeyPem` is a standard SPKI PEM (e.g. from
 * `openssl pkey -in issuer.pem -pubout`). Returns false (never throws) on
 * any malformed key/signature input — a verifier must always be able to
 * classify a bad signature as "verification failed," not crash.
 */
export function verifyEd25519Signature(
  publicKeyPem: string,
  payloadDigest: string,
  sigBase64: string,
): boolean {
  try {
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519") return false;
    return cryptoVerify(null, Buffer.from(payloadDigest, "utf8"), key, Buffer.from(sigBase64, "base64"));
  } catch {
    return false;
  }
}

/**
 * Derives the SPKI PEM public key from a PKCS8 PEM private key — used when
 * a caller only has `--signer-key` (private) but needs the public half too,
 * e.g. for transparency-log anchoring (see transparency.ts).
 */
export function derivePublicKeyPem(privateKeyPem: string): string {
  const privateKey = createPrivateKey(privateKeyPem);
  const publicKey = createPublicKey(privateKey as unknown as string);
  return publicKey.export({ format: "pem", type: "spki" }) as string;
}
