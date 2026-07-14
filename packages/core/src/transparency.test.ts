/**
 * PHASE E: transparency-log anchoring. `anchorToRekor` is tested against an
 * injected stub Witness — no live network call in the automated suite.
 * `verifyRekorAnchor`'s positive path is tested against
 * fixtures/transparency/rekor-anchor.json, a REAL bundle captured from a
 * genuine (approved, throwaway-key) submission to the public Rekor log —
 * see docs/TRANSPARENCY.md. Rekor entries are permanent, so this fixture
 * stays valid forever; it is not a synthetic mock of the verification math.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { fileURLToPath } from "node:url";
import { TrustedRoot } from "@sigstore/protobuf-specs";
import type { Witness } from "@sigstore/sign";
import type { TransparencyLogEntry } from "@sigstore/bundle";
import { createEd25519Signer } from "./signer.js";
import { anchorToRekor, verifyRekorAnchor } from "./transparency.js";
import type { PermanenceAnchor } from "@skillerr/protocol";

const fixturePath = fileURLToPath(
  new URL("../../../fixtures/transparency/rekor-anchor.json", import.meta.url),
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  digest: string;
  publicKeyPem: string;
  keyId: string;
  anchor: Omit<PermanenceAnchor, "package_digest">;
  trustedRootJSON: unknown;
};
const capturedTrustedRoot = TrustedRoot.fromJSON(fixture.trustedRootJSON);

function stubWitness(entry: Partial<TransparencyLogEntry> = {}): Witness {
  return {
    async testify() {
      return {
        tlogEntries: [
          {
            logIndex: "42",
            integratedTime: "1700000000",
            logId: { keyId: Buffer.from("stub-log-id") },
            kindVersion: { kind: "dsse", version: "0.0.1" },
            canonicalizedBody: Buffer.from("{}"),
            ...entry,
          } as TransparencyLogEntry,
        ],
      };
    },
  };
}

test("PHASE E: anchorToRekor builds a transparency_log PermanenceAnchor from a witness response", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const signer = createEd25519Signer(privateKey, "test-issuer-key");
  const digest = "sha256:" + "d".repeat(64);

  const { anchor } = await anchorToRekor(digest, signer, publicKey, {
    witness: stubWitness(),
    rekorUrl: "https://example-rekor.test",
  });

  assert.equal(anchor.kind, "transparency_log");
  assert.equal(anchor.located_at, "https://example-rekor.test");
  assert.equal(anchor.issuer, "test-issuer-key");
  assert.equal(anchor.anchored_at, new Date(1700000000 * 1000).toISOString());
  assert.ok(anchor.receipt, "receipt must be present");
});

test("PHASE E: anchorToRekor defaults to the public Rekor URL when none is given", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const signer = createEd25519Signer(privateKey, "test-issuer-key-2");
  const { anchor } = await anchorToRekor("sha256:" + "e".repeat(64), signer, publicKey, {
    witness: stubWitness(),
  });
  assert.equal(anchor.located_at, "https://rekor.sigstore.dev");
});

test("PHASE E: anchorToRekor throws (never reports false success) when the witness returns no entry", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const signer = createEd25519Signer(privateKey, "test-issuer-key-3");
  const emptyWitness: Witness = { async testify() { return { tlogEntries: [] }; } };
  await assert.rejects(
    () => anchorToRekor("sha256:" + "f".repeat(64), signer, publicKey, { witness: emptyWitness }),
    /no transparency log entry/,
  );
});

test("PHASE E: verifyRekorAnchor accepts a real captured Rekor bundle (fixture, no live network)", async () => {
  const result = await verifyRekorAnchor(
    { ...fixture.anchor, package_digest: fixture.digest } as PermanenceAnchor,
    fixture.digest,
    fixture.publicKeyPem,
    { trustedRoot: capturedTrustedRoot },
  );
  assert.equal(result.ok, true);
  assert.equal(result.log_index, "2168036243");
  assert.equal(result.log_id, "c0d23d6ad406973f9559f3ba2d1ca01f84147d8ffc5b8445c224f98b9591801d");
});

test("PHASE E: verifyRekorAnchor rejects when the digest doesn't match what was actually anchored", async () => {
  const result = await verifyRekorAnchor(
    { ...fixture.anchor, package_digest: fixture.digest } as PermanenceAnchor,
    "sha256:" + "0".repeat(64),
    fixture.publicKeyPem,
    { trustedRoot: capturedTrustedRoot },
  );
  assert.equal(result.ok, false);
});

test("PHASE E: verifyRekorAnchor rejects when the public key doesn't match the anchor's signer", async () => {
  const { publicKey: wrongKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const result = await verifyRekorAnchor(
    { ...fixture.anchor, package_digest: fixture.digest } as PermanenceAnchor,
    fixture.digest,
    wrongKey,
    { trustedRoot: capturedTrustedRoot },
  );
  assert.equal(result.ok, false);
});

test("PHASE E: verifyRekorAnchor rejects a non-transparency_log anchor kind without touching the network", async () => {
  const result = await verifyRekorAnchor(
    { kind: "registry", package_digest: "sha256:x", located_at: "x", anchored_at: "x", issuer: "x" },
    "sha256:x",
    "not-a-real-key",
  );
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /Not a transparency_log anchor/);
});
