/**
 * Pure Merkle tree transparency-log primitives (RFC 6962-style: Certificate
 * Transparency's Merkle tree hash, audit path, and consistency proof
 * algorithms), matching spec/CONTRACT.md's frozen `buildLeaf`/
 * `verifyInclusion`/`verifyConsistency` shapes.
 *
 * Deliberately standalone: no hosting, no storage, no network, no knowledge
 * of skillerr.com or any registry. A log HOST (the registry, elsewhere)
 * owns storing leaves and serving proofs over HTTP; this module owns only
 * the hash math a host uses to build proofs and a client uses to verify
 * them, the same separation @skillerr/core already keeps for Rekor
 * anchoring (transparency.ts calls the real sigstore-js client; this file
 * is the from-scratch equivalent for skillerr's own publish/install/revoke
 * event log, since nothing like Rekor exists for that specific log).
 *
 * Beyond the frozen buildLeaf/verifyInclusion/verifyConsistency, this file
 * also exports the constructive counterparts (treeHash,
 * generateInclusionProof, generateConsistencyProof) a log host needs to
 * actually produce proofs, and that this file's own tests use to validate
 * the verify functions against real, non-fabricated proofs. These aren't
 * part of the frozen contract's literal shape, but a "primitive" a
 * registry needs to build a log with is exactly the kind of reusable
 * building block this package exists to own — see spec/CONTRACT.md.
 *
 * Algorithm notes (RFC 6962 section 2.1, adapted): leaf hashes are
 * SHA-256(0x00 || data) and internal-node hashes are
 * SHA-256(0x01 || left || right) — the differing prefix byte is what
 * makes a leaf hash and an internal-node hash structurally
 * unambiguous (a second-preimage attack can't pass off a leaf as an
 * internal node or vice versa). This is a from-scratch implementation,
 * not an official library — validated in merkle-log.test.ts against
 * several hand-worked examples plus an exhaustive round-trip sweep across
 * every (old_size, new_size) pair for trees up to size 24, since RFC
 * 6962-style consistency proofs are notoriously easy to get subtly wrong;
 * treat that test file's coverage, not just this comment, as the
 * correctness evidence.
 */
import { createHash } from "node:crypto";
import { canonicalize } from "./hash.js";

export interface LogEvent {
  kind: "publish" | "install" | "revoke";
  /** `sha256:...` digest of the skill package this event concerns. */
  digest: string;
  /** ISO 8601. */
  timestamp: string;
  actor?: string;
  [key: string]: unknown;
}

export interface Leaf {
  event: LogEvent;
  /** `sha256:...`. RFC 6962 leaf hash: sha256(0x00 || canonicalize(event)). */
  hash: string;
}

export interface InclusionProof {
  leaf_index: number;
  tree_size: number;
  /** `sha256:...` sibling hashes, leaf-to-root order. */
  hashes: string[];
}

export interface SignedTreeHead {
  tree_size: number;
  /** `sha256:...`. */
  root_hash: string;
}

export interface ConsistencyProof {
  tree_size_1: number;
  tree_size_2: number;
  /** `sha256:...`. */
  hashes: string[];
}

function sha256(prefix: number, ...parts: Buffer[]): Buffer {
  const h = createHash("sha256");
  h.update(Buffer.from([prefix]));
  for (const p of parts) h.update(p);
  return h.digest();
}

function hashPair(left: Buffer, right: Buffer): Buffer {
  return sha256(0x01, left, right);
}

function toBytes(digest: string): Buffer {
  return Buffer.from(digest.replace(/^sha256:/, ""), "hex");
}

function toDigest(bytes: Buffer): string {
  return `sha256:${bytes.toString("hex")}`;
}

/** Largest power of two strictly less than n (RFC 6962's split point k, n > 1). */
function largestPowerOfTwoLessThan(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

export function buildLeaf(event: LogEvent): Leaf {
  const canonical = Buffer.from(canonicalize(event), "utf8");
  return { event, hash: toDigest(sha256(0x00, canonical)) };
}

// ---------------------------------------------------------------------------
// Tree hash (MTH) — the shared building block every proof function uses.
// ---------------------------------------------------------------------------

function subtreeHash(leafHashes: Buffer[], start: number, end: number): Buffer {
  const n = end - start;
  if (n === 0) return createHash("sha256").digest(); // MTH({}) = SHA-256 of the empty string
  if (n === 1) return leafHashes[start]!;
  const k = largestPowerOfTwoLessThan(n);
  return hashPair(subtreeHash(leafHashes, start, start + k), subtreeHash(leafHashes, start + k, end));
}

/** MTH over a full sequence of leaf hashes, e.g. for a log host to compute its current SignedTreeHead. */
export function treeHash(leafHashes: string[]): string {
  return toDigest(subtreeHash(leafHashes.map(toBytes), 0, leafHashes.length));
}

export function buildSignedTreeHead(leafHashes: string[]): SignedTreeHead {
  return { tree_size: leafHashes.length, root_hash: treeHash(leafHashes) };
}

// ---------------------------------------------------------------------------
// Inclusion (audit path)
// ---------------------------------------------------------------------------

/** For a log host: the minimal sibling-hash path proving `leafIndex` is included in this tree. */
export function generateInclusionProof(leafHashes: string[], leafIndex: number): InclusionProof {
  if (!Number.isInteger(leafIndex) || leafIndex < 0 || leafIndex >= leafHashes.length) {
    throw new Error(`leafIndex ${leafIndex} out of range for a tree of ${leafHashes.length} leaves`);
  }
  const hashes = leafHashes.map(toBytes);
  function auditPath(start: number, end: number): Buffer[] {
    const n = end - start;
    if (n <= 1) return [];
    const k = largestPowerOfTwoLessThan(n);
    if (leafIndex - start < k) {
      return [...auditPath(start, start + k), subtreeHash(hashes, start + k, end)];
    }
    return [...auditPath(start + k, end), subtreeHash(hashes, start, start + k)];
  }
  return {
    leaf_index: leafIndex,
    tree_size: leafHashes.length,
    hashes: auditPath(0, leafHashes.length).map(toDigest),
  };
}

/**
 * Recomputes the root from `leaf` + `proof.hashes` and compares it to
 * `treeHeadValue.root_hash` — never trusts a claimed root, always rebuilds
 * it. The recursive structure directly mirrors `generateInclusionProof`'s
 * `auditPath` (same branch condition, same left/right combination order),
 * so it consumes the proof's hashes in exactly the order they were
 * produced.
 */
export function verifyInclusion(leaf: Leaf, proof: InclusionProof, treeHeadValue: SignedTreeHead): boolean {
  if (proof.tree_size !== treeHeadValue.tree_size) return false;
  if (!Number.isInteger(proof.leaf_index) || proof.leaf_index < 0 || proof.leaf_index >= proof.tree_size) {
    return false;
  }
  const pathHashes = proof.hashes.map(toBytes);
  const cursor = { i: 0 };
  function reconstruct(start: number, end: number): Buffer | undefined {
    const n = end - start;
    if (n <= 1) return toBytes(leaf.hash);
    const k = largestPowerOfTwoLessThan(n);
    if (proof.leaf_index - start < k) {
      const left = reconstruct(start, start + k);
      const right = pathHashes[cursor.i++];
      if (!left || !right) return undefined;
      return hashPair(left, right);
    }
    const right = reconstruct(start + k, end);
    const left = pathHashes[cursor.i++];
    if (!left || !right) return undefined;
    return hashPair(left, right);
  }
  const root = reconstruct(0, proof.tree_size);
  if (!root || cursor.i !== pathHashes.length) return false; // malformed: too few or leftover hashes
  return toDigest(root) === treeHeadValue.root_hash;
}

// ---------------------------------------------------------------------------
// Consistency
// ---------------------------------------------------------------------------

/**
 * For a log host: proves the tree grew from `oldSize` to the full length
 * of `leafHashes` by pure append (RFC 6962 PROOF/SUBPROOF). `oldSize` a
 * power of two is the one case where the minimal proof is empty (the old
 * tree is already a complete, left-aligned subtree of the new one).
 */
export function generateConsistencyProof(leafHashes: string[], oldSize: number): ConsistencyProof {
  const newSize = leafHashes.length;
  if (!Number.isInteger(oldSize) || oldSize < 0 || oldSize > newSize) {
    throw new Error(`oldSize ${oldSize} out of range for a tree of ${newSize} leaves`);
  }
  if (oldSize === 0 || oldSize === newSize) {
    return { tree_size_1: oldSize, tree_size_2: newSize, hashes: [] };
  }
  const hashes = leafHashes.map(toBytes);

  // "complete" tracks whether we've stayed left-aligned with the tree's
  // own root (start === 0) all the way down — see the module doc comment
  // and merkle-log.test.ts for the derivation. Once we cross into a
  // right-hand subtree (complete=false) we can no longer shortcut against
  // the old tree's own root and must reveal explicit chunk hashes.
  function subproof(m: number, start: number, end: number, complete: boolean): Buffer[] {
    const n = end - start;
    const k = largestPowerOfTwoLessThan(n);
    if (complete) {
      if (m === n) return [];
      if (m <= k) {
        return [...subproof(m, start, start + k, true), subtreeHash(hashes, start + k, end)];
      }
      return [...subproof(m - k, start + k, end, false), subtreeHash(hashes, start, start + k)];
    }
    if (m === k) {
      return [subtreeHash(hashes, start, start + m), subtreeHash(hashes, start + m, end)];
    }
    if (m < k) {
      return [...subproof(m, start, start + k, false), subtreeHash(hashes, start + k, end)];
    }
    return [...subproof(m - k, start + k, end, false), subtreeHash(hashes, start, start + k)];
  }

  return {
    tree_size_1: oldSize,
    tree_size_2: newSize,
    hashes: subproof(oldSize, 0, newSize, true).map(toDigest),
  };
}

/**
 * Reconstructs BOTH the old and new root from `proof.hashes` (using
 * `a.root_hash` only as the seed value at the point in the recursion
 * where the old tree's own root legitimately equals the current
 * subtree's hash — see the module doc comment) and compares each against
 * `a`/`b`. A proof that reconstructs a plausible-looking new root without
 * it actually being reachable from `a.root_hash` fails here, which is the
 * property that makes this an actual consistency proof rather than just
 * evidence that `b` is some valid tree.
 */
export function verifyConsistency(a: SignedTreeHead, b: SignedTreeHead, proof: ConsistencyProof): boolean {
  if (proof.tree_size_1 !== a.tree_size || proof.tree_size_2 !== b.tree_size) return false;
  if (a.tree_size < 0 || a.tree_size > b.tree_size) return false;
  if (a.tree_size === 0) return proof.hashes.length === 0;
  if (a.tree_size === b.tree_size) return proof.hashes.length === 0 && a.root_hash === b.root_hash;

  const proofHashes = proof.hashes.map(toBytes);
  const cursor = { i: 0 };
  const aRoot = toBytes(a.root_hash);

  function recon(m: number, start: number, end: number, complete: boolean): { old: Buffer; new: Buffer } | undefined {
    const n = end - start;
    const k = largestPowerOfTwoLessThan(n);
    if (complete) {
      if (m === n) return { old: aRoot, new: aRoot };
      if (m <= k) {
        const left = recon(m, start, start + k, true);
        const right = proofHashes[cursor.i++];
        if (!left || !right) return undefined;
        return { old: left.old, new: hashPair(left.new, right) };
      }
      const right = recon(m - k, start + k, end, false);
      const left = proofHashes[cursor.i++];
      if (!right || !left) return undefined;
      return { old: hashPair(left, right.old), new: hashPair(left, right.new) };
    }
    if (m === k) {
      const oldChunk = proofHashes[cursor.i++];
      const newChunk = proofHashes[cursor.i++];
      if (!oldChunk || !newChunk) return undefined;
      return { old: oldChunk, new: hashPair(oldChunk, newChunk) };
    }
    if (m < k) {
      const left = recon(m, start, start + k, false);
      const right = proofHashes[cursor.i++];
      if (!left || !right) return undefined;
      return { old: left.old, new: hashPair(left.new, right) };
    }
    const right = recon(m - k, start + k, end, false);
    const left = proofHashes[cursor.i++];
    if (!right || !left) return undefined;
    return { old: hashPair(left, right.old), new: hashPair(left, right.new) };
  }

  const result = recon(a.tree_size, 0, b.tree_size, true);
  if (!result || cursor.i !== proofHashes.length) return false; // malformed: too few or leftover hashes
  return toDigest(result.old) === a.root_hash && toDigest(result.new) === b.root_hash;
}
