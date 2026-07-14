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
import { anchorToRekor, verifyRekorAnchor, rekorSearchUrl, mintKeylessAnchor, verifyKeylessAnchor } from "./transparency.js";
import type { PermanenceAnchor } from "@skillerr/protocol";
import type { Signer as SigstoreSigner } from "@sigstore/sign";

// Synthetic test-only CA + leaf cert (openssl-generated, not Fulcio's real
// root) — see fixtures/transparency/keyless-test-pki.json for how it was
// made. Sufficient to test mintKeylessAnchor's own cert-parsing logic and
// verifyKeylessAnchor's pre-crypto checks (digest match, anchor kind,
// cert presence). NOT sufficient to test the full crypto positive path
// (cert chaining to a trusted CA, Rekor inclusion proof) — that needs a
// real Fulcio+Rekor round trip, which needs a real ambient CI OIDC token
// (only available inside an actual GitHub Actions run) and isn't
// fabricated here, the same way verifyRekorAnchor's positive-path test
// uses a real captured bundle rather than a synthetic one.
const keylessFixturePath = fileURLToPath(
  new URL("../../../fixtures/transparency/keyless-test-pki.json", import.meta.url),
);
const keylessFixture = JSON.parse(readFileSync(keylessFixturePath, "utf8")) as {
  leaf_cert_der_base64: string;
  leaf_private_key_pem: string;
  owner_identity: string;
};
const keylessLeafCertPem = [
  "-----BEGIN CERTIFICATE-----",
  ...(keylessFixture.leaf_cert_der_base64.match(/.{1,64}/g) ?? []),
  "-----END CERTIFICATE-----",
  "",
].join("\n");

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

  const { anchor, log_index } = await anchorToRekor(digest, signer, publicKey, {
    witness: stubWitness(),
    rekorUrl: "https://example-rekor.test",
  });

  assert.equal(anchor.kind, "transparency_log");
  assert.equal(anchor.located_at, "https://example-rekor.test");
  assert.equal(anchor.issuer, "test-issuer-key");
  assert.equal(anchor.anchored_at, new Date(1700000000 * 1000).toISOString());
  assert.ok(anchor.receipt, "receipt must be present");
  assert.equal(log_index, "42");
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

test("PHASE E: rekorSearchUrl builds a search.sigstore.dev link for an anchor on the public Rekor instance", () => {
  const url = rekorSearchUrl(fixture.anchor as PermanenceAnchor, "2168036243");
  assert.equal(url, "https://search.sigstore.dev/?logIndex=2168036243");
});

test("PHASE E: rekorSearchUrl returns undefined for a self-hosted (non-public) Rekor instance", () => {
  const url = rekorSearchUrl(
    { kind: "transparency_log", located_at: "https://rekor.example-internal.corp" },
    "2168036243",
  );
  assert.equal(url, undefined);
});

test("PHASE E: rekorSearchUrl returns undefined when there's no log index (e.g. verification failed before an entry was found)", () => {
  const url = rekorSearchUrl(fixture.anchor as PermanenceAnchor, undefined);
  assert.equal(url, undefined);
});

test("PHASE E: rekorSearchUrl returns undefined for a non-transparency_log anchor kind", () => {
  const url = rekorSearchUrl({ kind: "registry", located_at: "https://rekor.sigstore.dev" }, "123");
  assert.equal(url, undefined);
});

test("PHASE E: rekorSearchUrl also builds a link for a keyless_identity anchor on the public Rekor instance", () => {
  const url = rekorSearchUrl({ kind: "keyless_identity", located_at: "https://rekor.sigstore.dev" }, "999");
  assert.equal(url, "https://search.sigstore.dev/?logIndex=999");
});

function stubFulcioSigner(): SigstoreSigner {
  return {
    async sign(data: Buffer) {
      const { createSign } = await import("node:crypto");
      const signature = createSign("sha256").update(data).sign(keylessFixture.leaf_private_key_pem);
      return {
        signature,
        key: { $case: "x509Certificate", certificate: keylessLeafCertPem },
      };
    },
  };
}

test("PHASE E: mintKeylessAnchor builds a keyless_identity PermanenceAnchor and extracts the owner identity from the cert", async () => {
  const digest = "sha256:" + "a".repeat(64);
  const { anchor, log_index, owner_identity } = await mintKeylessAnchor(digest, {
    signer: stubFulcioSigner(),
    witness: stubWitness(),
    rekorUrl: "https://example-rekor.test",
    fulcioUrl: "https://example-fulcio.test",
  });
  assert.equal(anchor.kind, "keyless_identity");
  assert.equal(anchor.located_at, "https://example-rekor.test");
  assert.equal(anchor.issuer, "https://example-fulcio.test");
  assert.ok(anchor.receipt, "receipt must be present");
  assert.equal(log_index, "42");
  assert.equal(owner_identity, keylessFixture.owner_identity);
  assert.equal(anchor.extensions?.owner_identity, keylessFixture.owner_identity);
});

test("PHASE E: mintKeylessAnchor throws (never reports false success) when the witness returns no entry", async () => {
  const emptyWitness: Witness = { async testify() { return { tlogEntries: [] }; } };
  await assert.rejects(
    () =>
      mintKeylessAnchor("sha256:" + "b".repeat(64), {
        signer: stubFulcioSigner(),
        witness: emptyWitness,
      }),
    /no transparency log entry/,
  );
});

test("PHASE E: verifyKeylessAnchor rejects a non-keyless_identity anchor kind without touching the network", async () => {
  const result = await verifyKeylessAnchor(
    { kind: "transparency_log", package_digest: "sha256:x", located_at: "x", anchored_at: "x", issuer: "x" },
    "sha256:x",
  );
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /Not a keyless_identity anchor/);
});

test("PHASE E: verifyKeylessAnchor rejects when the digest doesn't match what was actually anchored", async () => {
  const digest = "sha256:" + "c".repeat(64);
  // bundleFromJSON structurally requires an inclusionProof.checkpoint to
  // accept a v0.3 bundle at all (checked before any crypto happens) — the
  // digest-mismatch check this test targets runs right after that parse,
  // so the stub just needs to satisfy that structural gate, not be a real
  // (cryptographically verifiable) proof.
  const { anchor } = await mintKeylessAnchor(digest, {
    signer: stubFulcioSigner(),
    witness: stubWitness({
      inclusionProof: {
        logIndex: "42",
        rootHash: Buffer.from("stub-root-hash"),
        treeSize: "1",
        hashes: [],
        checkpoint: { envelope: "stub-checkpoint" },
      },
    }),
  });
  const result = await verifyKeylessAnchor(
    { ...anchor, package_digest: digest } as PermanenceAnchor,
    "sha256:" + "0".repeat(64),
  );
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /does not match/);
});

test("PHASE E: verifyKeylessAnchor rejects an anchor with no receipt", async () => {
  const result = await verifyKeylessAnchor(
    { kind: "keyless_identity", package_digest: "sha256:x", located_at: "x", anchored_at: "x", issuer: "x" },
    "sha256:x",
  );
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /Not a keyless_identity anchor/);
});
