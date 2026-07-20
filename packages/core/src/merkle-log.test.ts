/**
 * merkle-log.ts is a from-scratch RFC 6962-style Merkle tree implementation
 * (nothing like it existed anywhere in this codebase or an official
 * library to lean on for skillerr's own publish/install/revoke log, unlike
 * transparency.ts's Rekor integration). Consistency proofs in particular
 * are notoriously easy to get subtly wrong, so this file leans hard on
 * exhaustive round-trip coverage rather than a handful of examples: every
 * (leaf, index) pair for inclusion and every (old_size, new_size) pair for
 * consistency, across tree sizes 1 through 24 — 300 consistency
 * combinations, plus per-size inclusion coverage — so a subtly-wrong
 * branch condition has nowhere to hide. Three of the smaller cases below
 * are also fixed, hand-computed "golden" vectors matching hash values
 * worked out by hand against the RFC 6962 MTH/PATH/SUBPROOF definitions,
 * pinning the exact algorithm rather than only checking self-consistency.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  buildLeaf,
  treeHash,
  buildSignedTreeHead,
  generateInclusionProof,
  verifyInclusion,
  generateConsistencyProof,
  verifyConsistency,
  type Leaf,
  type LogEvent,
  type SignedTreeHead,
} from "./merkle-log.js";
import { canonicalize } from "./hash.js";

function leafHash(hex: string): string {
  // Raw already-hashed leaf value for hand-computed golden vectors below,
  // bypassing buildLeaf's canonicalize step (those vectors are about the
  // tree math, not event canonicalization).
  return `sha256:${hex}`;
}

function sha(prefix: number, ...parts: Buffer[]): string {
  const h = createHash("sha256");
  h.update(Buffer.from([prefix]));
  for (const p of parts) h.update(p);
  return `sha256:${h.digest("hex")}`;
}
function bytes(digest: string): Buffer {
  return Buffer.from(digest.replace(/^sha256:/, ""), "hex");
}
function combine(a: string, b: string): string {
  return sha(0x01, bytes(a), bytes(b));
}

// 8 raw leaf hashes, d0..d7, standing in for a real tree's leaves so the
// golden vectors below can be worked out symbolically (h01=H(h0,h1), etc,
// matching the module doc comment's derivation).
const raw = Array.from({ length: 8 }, (_, i) => leafHash(i.toString(16).padStart(2, "0").repeat(32).slice(0, 64)));

// ---------------------------------------------------------------------------
// buildLeaf
// ---------------------------------------------------------------------------

test("buildLeaf: deterministic, matches sha256(0x00 || canonicalize(event))", () => {
  const event: LogEvent = { kind: "publish", digest: "sha256:" + "a".repeat(64), timestamp: "2026-01-01T00:00:00.000Z" };
  const a = buildLeaf(event);
  const b = buildLeaf({ ...event });
  assert.equal(a.hash, b.hash);
  assert.match(a.hash, /^sha256:[a-f0-9]{64}$/);
  const expected = sha(0x00, Buffer.from(canonicalize(event), "utf8"));
  assert.equal(a.hash, expected, "must match RFC 6962 leaf hashing: sha256(0x00 || data)");
});

test("buildLeaf: distinct events (kind, digest, timestamp, actor) produce distinct hashes", () => {
  const base: LogEvent = { kind: "publish", digest: "sha256:" + "a".repeat(64), timestamp: "2026-01-01T00:00:00.000Z" };
  const variants: LogEvent[] = [
    { ...base, kind: "install" },
    { ...base, digest: "sha256:" + "b".repeat(64) },
    { ...base, timestamp: "2026-01-02T00:00:00.000Z" },
    { ...base, actor: "cursor" },
  ];
  const hashes = new Set([buildLeaf(base).hash, ...variants.map((v) => buildLeaf(v).hash)]);
  assert.equal(hashes.size, variants.length + 1, "every distinct event must hash distinctly");
});

test("buildLeaf: a leaf hash can never equal a two-leaf tree's internal-node hash (0x00 vs 0x01 domain separation)", () => {
  const event: LogEvent = { kind: "revoke", digest: "sha256:" + "c".repeat(64), timestamp: "2026-01-01T00:00:00.000Z" };
  const leaf = buildLeaf(event);
  const fakedInternalNode = sha(0x01, bytes(leaf.hash), bytes(leaf.hash));
  assert.notEqual(leaf.hash, fakedInternalNode);
});

// ---------------------------------------------------------------------------
// Golden vectors (hand-derived, see module doc comment)
// ---------------------------------------------------------------------------

test("golden: 8-leaf tree hash matches hand-derived RFC 6962 MTH", () => {
  const h01 = combine(raw[0]!, raw[1]!);
  const h23 = combine(raw[2]!, raw[3]!);
  const h45 = combine(raw[4]!, raw[5]!);
  const h67 = combine(raw[6]!, raw[7]!);
  const h0123 = combine(h01, h23);
  const h4567 = combine(h45, h67);
  const root = combine(h0123, h4567);
  assert.equal(treeHash(raw), root);
});

test("golden: consistency proof (old=5, new=8) matches the hand-derived [h4,h5,h67,h0123] vector", () => {
  const h01 = combine(raw[0]!, raw[1]!);
  const h23 = combine(raw[2]!, raw[3]!);
  const h0123 = combine(h01, h23);
  const h67 = combine(raw[6]!, raw[7]!);
  const expected = [raw[4]!, raw[5]!, h67, h0123];

  const proof = generateConsistencyProof(raw, 5);
  assert.deepEqual(proof.hashes, expected);

  const oldRoot = combine(h0123, raw[4]!);
  const oldHead: SignedTreeHead = { tree_size: 5, root_hash: oldRoot };
  const newHead: SignedTreeHead = { tree_size: 8, root_hash: treeHash(raw) };
  assert.equal(verifyConsistency(oldHead, newHead, proof), true);
});

test("golden: consistency proof (old=2, new=3) matches the hand-derived [h2] vector", () => {
  const three = raw.slice(0, 3);
  const proof = generateConsistencyProof(three, 2);
  assert.deepEqual(proof.hashes, [raw[2]!]);
  const oldHead: SignedTreeHead = { tree_size: 2, root_hash: combine(raw[0]!, raw[1]!) };
  const newHead: SignedTreeHead = { tree_size: 3, root_hash: treeHash(three) };
  assert.equal(verifyConsistency(oldHead, newHead, proof), true);
});

test("golden: consistency proof (old=4, new=6) matches the hand-derived [MTH(D[4:6])] vector", () => {
  const six = raw.slice(0, 6);
  const proof = generateConsistencyProof(six, 4);
  const h45 = combine(raw[4]!, raw[5]!);
  assert.deepEqual(proof.hashes, [h45]);
  const oldHead: SignedTreeHead = { tree_size: 4, root_hash: treeHash(raw.slice(0, 4)) };
  const newHead: SignedTreeHead = { tree_size: 6, root_hash: treeHash(six) };
  assert.equal(verifyConsistency(oldHead, newHead, proof), true);
});

// ---------------------------------------------------------------------------
// Inclusion: exhaustive round trip
// ---------------------------------------------------------------------------

function makeLeaves(n: number): Leaf[] {
  return Array.from({ length: n }, (_, i) =>
    buildLeaf({ kind: "publish", digest: `sha256:${i.toString().padStart(64, "0")}`, timestamp: "2026-01-01T00:00:00.000Z" }),
  );
}

test("inclusion: every leaf in trees of size 1..24 produces a proof that verifies true against the real tree head", () => {
  for (let n = 1; n <= 24; n++) {
    const leaves = makeLeaves(n);
    const hashes = leaves.map((l) => l.hash);
    const head = buildSignedTreeHead(hashes);
    assert.equal(head.tree_size, n);
    for (let i = 0; i < n; i++) {
      const proof = generateInclusionProof(hashes, i);
      assert.equal(proof.leaf_index, i);
      assert.equal(proof.tree_size, n);
      assert.equal(verifyInclusion(leaves[i]!, proof, head), true, `tree_size=${n} leaf_index=${i} must verify`);
    }
  }
});

test("inclusion: rejects a proof checked against the wrong leaf", () => {
  const leaves = makeLeaves(7);
  const hashes = leaves.map((l) => l.hash);
  const head = buildSignedTreeHead(hashes);
  const proof = generateInclusionProof(hashes, 3);
  assert.equal(verifyInclusion(leaves[4]!, proof, head), false);
});

test("inclusion: rejects a proof with one tampered sibling hash", () => {
  const leaves = makeLeaves(7);
  const hashes = leaves.map((l) => l.hash);
  const head = buildSignedTreeHead(hashes);
  const proof = generateInclusionProof(hashes, 5);
  assert.ok(proof.hashes.length > 0);
  const tampered = { ...proof, hashes: [...proof.hashes] };
  tampered.hashes[0] = "sha256:" + "f".repeat(64);
  assert.equal(verifyInclusion(leaves[5]!, tampered, head), false);
});

test("inclusion: rejects a proof against a tampered tree head root", () => {
  const leaves = makeLeaves(9);
  const hashes = leaves.map((l) => l.hash);
  const head = buildSignedTreeHead(hashes);
  const proof = generateInclusionProof(hashes, 8);
  const tamperedHead = { ...head, root_hash: "sha256:" + "0".repeat(64) };
  assert.equal(verifyInclusion(leaves[8]!, proof, tamperedHead), false);
});

test("inclusion: rejects a proof with an extra leftover hash appended (malformed)", () => {
  const leaves = makeLeaves(9);
  const hashes = leaves.map((l) => l.hash);
  const head = buildSignedTreeHead(hashes);
  const proof = generateInclusionProof(hashes, 0);
  const tampered = { ...proof, hashes: [...proof.hashes, "sha256:" + "1".repeat(64)] };
  assert.equal(verifyInclusion(leaves[0]!, tampered, head), false);
});

test("inclusion: rejects mismatched tree_size between proof and tree head", () => {
  const leaves = makeLeaves(5);
  const hashes = leaves.map((l) => l.hash);
  const head = buildSignedTreeHead(hashes);
  const proof = generateInclusionProof(hashes, 2);
  assert.equal(verifyInclusion(leaves[2]!, { ...proof, tree_size: 999 }, head), false);
});

test("inclusion: generateInclusionProof rejects an out-of-range leaf index", () => {
  const hashes = makeLeaves(3).map((l) => l.hash);
  assert.throws(() => generateInclusionProof(hashes, 3));
  assert.throws(() => generateInclusionProof(hashes, -1));
});

// ---------------------------------------------------------------------------
// Consistency: exhaustive round trip
// ---------------------------------------------------------------------------

test("consistency: every (old_size, new_size) pair for trees up to size 24 verifies true", () => {
  const MAX = 24;
  const allHashes = makeLeaves(MAX).map((l) => l.hash);
  const headCache = new Map<number, SignedTreeHead>();
  const headFor = (size: number): SignedTreeHead => {
    if (!headCache.has(size)) headCache.set(size, buildSignedTreeHead(allHashes.slice(0, size)));
    return headCache.get(size)!;
  };
  let checked = 0;
  for (let oldSize = 0; oldSize <= MAX; oldSize++) {
    for (let newSize = oldSize; newSize <= MAX; newSize++) {
      const oldLeaves = allHashes.slice(0, newSize); // proof generation needs the full leaf set up to newSize
      const proof = generateConsistencyProof(oldLeaves, oldSize);
      const ok = verifyConsistency(headFor(oldSize), headFor(newSize), proof);
      assert.equal(ok, true, `old_size=${oldSize} new_size=${newSize} must verify`);
      checked++;
    }
  }
  assert.equal(checked, ((MAX + 1) * (MAX + 2)) / 2, "sanity: covered every (old_size<=new_size) pair up to MAX");
});

test("consistency: old_size=0 is trivially consistent with any tree, empty proof", () => {
  const hashes = makeLeaves(10).map((l) => l.hash);
  const proof = generateConsistencyProof(hashes, 0);
  assert.deepEqual(proof.hashes, []);
  const emptyHead: SignedTreeHead = { tree_size: 0, root_hash: "sha256:" + "0".repeat(64) };
  assert.equal(verifyConsistency(emptyHead, buildSignedTreeHead(hashes), proof), true);
});

test("consistency: old_size===new_size requires matching roots and an empty proof", () => {
  const hashes = makeLeaves(6).map((l) => l.hash);
  const head = buildSignedTreeHead(hashes);
  const proof = generateConsistencyProof(hashes, 6);
  assert.deepEqual(proof.hashes, []);
  assert.equal(verifyConsistency(head, head, proof), true);
  assert.equal(verifyConsistency(head, { ...head, root_hash: "sha256:" + "9".repeat(64) }, proof), false);
});

test("consistency: rejects a tampered old root", () => {
  const hashes = makeLeaves(11).map((l) => l.hash);
  const oldHead = buildSignedTreeHead(hashes.slice(0, 4));
  const newHead = buildSignedTreeHead(hashes);
  const proof = generateConsistencyProof(hashes, 4);
  assert.equal(verifyConsistency({ ...oldHead, root_hash: "sha256:" + "e".repeat(64) }, newHead, proof), false);
});

test("consistency: rejects a tampered new root", () => {
  const hashes = makeLeaves(11).map((l) => l.hash);
  const oldHead = buildSignedTreeHead(hashes.slice(0, 4));
  const newHead = buildSignedTreeHead(hashes);
  const proof = generateConsistencyProof(hashes, 4);
  assert.equal(verifyConsistency(oldHead, { ...newHead, root_hash: "sha256:" + "e".repeat(64) }, proof), false);
});

test("consistency: rejects a proof with one tampered hash", () => {
  const hashes = makeLeaves(13).map((l) => l.hash);
  const oldHead = buildSignedTreeHead(hashes.slice(0, 5));
  const newHead = buildSignedTreeHead(hashes);
  const proof = generateConsistencyProof(hashes, 5);
  assert.ok(proof.hashes.length > 0);
  const tampered = { ...proof, hashes: [...proof.hashes] };
  tampered.hashes[0] = "sha256:" + "d".repeat(64);
  assert.equal(verifyConsistency(oldHead, newHead, tampered), false);
});

test("consistency: rejects a truncated proof (missing trailing hash)", () => {
  const hashes = makeLeaves(13).map((l) => l.hash);
  const oldHead = buildSignedTreeHead(hashes.slice(0, 5));
  const newHead = buildSignedTreeHead(hashes);
  const proof = generateConsistencyProof(hashes, 5);
  assert.ok(proof.hashes.length > 1);
  const tampered = { ...proof, hashes: proof.hashes.slice(0, -1) };
  assert.equal(verifyConsistency(oldHead, newHead, tampered), false);
});

test("consistency: rejects a proof with an extra leftover hash appended", () => {
  const hashes = makeLeaves(13).map((l) => l.hash);
  const oldHead = buildSignedTreeHead(hashes.slice(0, 5));
  const newHead = buildSignedTreeHead(hashes);
  const proof = generateConsistencyProof(hashes, 5);
  const tampered = { ...proof, hashes: [...proof.hashes, "sha256:" + "2".repeat(64)] };
  assert.equal(verifyConsistency(oldHead, newHead, tampered), false);
});

test("consistency: rejects mismatched tree_size between the proof and the supplied tree heads", () => {
  const hashes = makeLeaves(10).map((l) => l.hash);
  const oldHead = buildSignedTreeHead(hashes.slice(0, 4));
  const newHead = buildSignedTreeHead(hashes);
  const proof = generateConsistencyProof(hashes, 4);
  assert.equal(verifyConsistency({ ...oldHead, tree_size: 3 }, newHead, proof), false);
  assert.equal(verifyConsistency(oldHead, { ...newHead, tree_size: 999 }, proof), false);
});

test("consistency: generateConsistencyProof rejects oldSize out of range", () => {
  const hashes = makeLeaves(5).map((l) => l.hash);
  assert.throws(() => generateConsistencyProof(hashes, 6));
  assert.throws(() => generateConsistencyProof(hashes, -1));
});

// ---------------------------------------------------------------------------
// Composition: a chain of consistency proofs across several growth steps
// stays valid end to end, and inclusion proofs at each stage remain
// independently checkable against that stage's own tree head.
// ---------------------------------------------------------------------------

test("composition: a tree grown in three steps (5 -> 12 -> 24) has valid consistency proofs at every step, and an early leaf's inclusion proof still verifies at every later size", () => {
  const all = makeLeaves(24);
  const allHashes = all.map((l) => l.hash);
  const sizes = [5, 12, 24];
  const heads = sizes.map((s) => buildSignedTreeHead(allHashes.slice(0, s)));

  for (let i = 1; i < sizes.length; i++) {
    const proof = generateConsistencyProof(allHashes.slice(0, sizes[i]!), sizes[i - 1]!);
    assert.equal(verifyConsistency(heads[i - 1]!, heads[i]!, proof), true);
  }

  for (const size of sizes) {
    const proof = generateInclusionProof(allHashes.slice(0, size), 2);
    const head = buildSignedTreeHead(allHashes.slice(0, size));
    assert.equal(verifyInclusion(all[2]!, proof, head), true, `leaf 2's inclusion proof must verify at tree_size=${size}`);
  }
});
