// Verifies Appendix B against the published spec document itself, rather than against a
// fixture copy. Vectors are extracted from open-feed-spec.md, and signing keys are resolved
// the way a real verifier resolves them — out of the identity document that lists them
// (spec §4.2, structural key ownership) — so the test exercises the discovery path too.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseIJSON,
  canonicalize,
  documentHash,
  sha256,
  canonicalBytes,
  verifyDocument,
  normalizeIdentityUrl,
  claimedAuthor,
  parseKid,
  parseDetachedSig,
  findKey,
  effectiveSigningTime,
} from '../src/index.js';

const SPEC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'open-feed-spec.md');
const specText = fs.readFileSync(SPEC, 'utf8');

/** Pull every single-line JSON document out of the spec's fenced code blocks. */
function extractVectors(text) {
  const out = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) { inFence = !inFence; continue; }
    if (!inFence) continue;
    const t = line.trim();
    if (!t.startsWith('{"') || !t.endsWith('}')) continue;
    let doc;
    try { doc = parseIJSON(t); } catch { continue; }
    out.push({ text: t, doc });
  }
  return out;
}

const vectors = extractVectors(specText);
const signed = vectors.filter((v) => typeof v.doc._sig === 'string');
const identityDocs = signed.filter((v) => Array.isArray(v.doc.keys));

/**
 * Identity documents by URL, keeping the HIGHEST `seq` — the tip of each identity's chain.
 * This is the document §6.5 step 6 resolves a `kid` against, so it is the only one that puts
 * revocation in scope. Resolving against genesis instead would accept a signature by a key
 * the identity has since revoked.
 */
const currentByUrl = new Map();
for (const { doc } of identityDocs) {
  const url = normalizeIdentityUrl(doc.url);
  const held = currentByUrl.get(url);
  if (!held || doc.seq > held.seq) currentByUrl.set(url, doc);
}

test('the spec contains the signed vectors Appendix B claims', () => {
  assert.ok(signed.length >= 12, `expected at least 12 signed vectors, extracted ${signed.length}`);
  for (const url of ['https://test.example/', 'https://reader.example/', 'https://posse.example/', 'https://member.example/']) {
    assert.ok(currentByUrl.has(url), `no identity document for ${url}`);
  }
});

test('canonicalizer reproduces B.2 known SHA-256', () => {
  // The external anchor: a hash computed outside this implementation. Without it a
  // canonicalizer bug would be invisible, since the same code produces and checks.
  const item = {
    _openfeed: { feed_url: 'https://test.example/feed.json', version: 1 },
    authors: [{ url: 'https://test.example/' }],
    content_text: 'Hello, wörld! 👋',
    date_published: '2025-01-15T12:00:00Z',
    id: 'urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
  };
  assert.equal(
    sha256(canonicalBytes(item)).toString('hex'),
    'cbf8bddd3412094c6d45ea5a92fff788abe29814d2a7be7d2f74390839c4fd70',
  );
});

test('every signed vector verifies against its author\'s current identity document', () => {
  // No skips: a vector whose signer publishes no identity document is unverifiable from
  // the spec alone, which defeats the point of shipping test vectors at all.
  let verified = 0;
  for (const { doc } of signed) {
    // §6.6: the carrier is selected by document kind, supplied from context — here the
    // vectors' own construction: every chained document carries an integer `seq`, no item does.
    const kind = Number.isInteger(doc.seq) ? (Array.isArray(doc.keys) ? 'identity' : 'manifest') : 'item';
    const author = claimedAuthor(doc, { kind });
    const identityDocument = currentByUrl.get(author);
    assert.ok(identityDocument, `no identity document published for ${author}`);
    // Not a throw-guard: verifyDocument does author binding, key resolution, iat,
    // revocation, and the Ed25519 check, and throws with a reason on any failure.
    const info = verifyDocument(doc, { identityDocument, kind });
    assert.equal(info.author, author);
    verified++;
  }
  assert.ok(verified >= 12, `only ${verified} vectors verified`);
});

test('every vector was signed inside its key\'s validity window', () => {
  // Stated independently of verifyDocument, because this is the check that caught a real
  // defect: a reply vector signed nine hours after B.5 revoked the key that signed it. A
  // sound Ed25519 signature is not enough — §4.4 bounds it at both ends.
  for (const { doc } of signed) {
    const identityDocument = currentByUrl.get(claimedAuthor(doc, { kind: Number.isInteger(doc.seq) ? (Array.isArray(doc.keys) ? 'identity' : 'manifest') : 'item' }));
    const { keyId } = parseKid(parseDetachedSig(doc._sig).header.kid);
    const key = findKey(identityDocument, keyId);
    const when = effectiveSigningTime(doc, { kind: Number.isInteger(doc.seq) ? (Array.isArray(doc.keys) ? 'identity' : 'manifest') : 'item' });
    assert.ok(key.iat <= when, `${keyId} signed at ${when}, before its iat ${key.iat}`);
    if (typeof key.revoked_at === 'number') {
      // Equality is valid: §5.2's normal rotation revokes the continuity key in the very
      // version that key signs, which is exactly what B.5 does.
      assert.ok(when <= key.revoked_at, `${keyId} signed at ${when}, after revoked_at ${key.revoked_at}`);
    }
  }
});

test('manifest entries commit the exact published bytes of their items', () => {
  // Spec §9: each `items` entry is [version, hash] over the item's FULL published bytes,
  // `_sig` included — a different hash from the signing payload in §6.3.
  const items = signed.filter((v) => typeof v.doc._openfeed?.feed_url === 'string' && !Array.isArray(v.doc.keys));
  const manifests = signed.filter((v) => typeof v.doc.feed_url === 'string');
  assert.ok(items.length >= 2 && manifests.length >= 2, 'expected item and manifest vectors');

  let checked = 0;
  for (const { doc: manifest } of manifests) {
    for (const [id, entry] of Object.entries(manifest.items ?? {})) {
      const item = items.find((v) => v.doc.id === id);
      if (!item) continue;
      const [version, hash] = entry;
      assert.equal(item.doc._openfeed?.version, version, `version mismatch for ${id}`);
      assert.equal(documentHash(item.doc), hash, `hash mismatch for ${id}`);
      checked++;
    }
  }
  assert.ok(checked >= 3, `expected at least 3 committed items, checked ${checked}`);
});

test('manifest chain links by prev', () => {
  // Scoped to one feed: B.10 adds a second, independent genesis manifest, and chains are
  // per-document-URL (§5.3.1), never global.
  const manifests = signed
    .filter((v) => v.doc.feed_url === 'https://test.example/feed.json')
    .sort((a, b) => a.doc.seq - b.doc.seq);
  const [genesis, second] = manifests;
  assert.equal(genesis.doc.seq, 1);
  assert.equal(second.doc.prev, documentHash(genesis.doc), 'seq 2 prev does not name genesis bytes');
});

test('identity chain links by prev', () => {
  const chain = signed
    .filter((v) => Array.isArray(v.doc.keys) && normalizeIdentityUrl(v.doc.url) === 'https://test.example/')
    .sort((a, b) => a.doc.seq - b.doc.seq);
  assert.equal(chain.length, 2);
  assert.equal(chain[1].doc.prev, documentHash(chain[0].doc), 'seq 2 prev does not name genesis bytes');
});

test('re-canonicalizing a published vector reproduces its bytes verbatim', () => {
  // The property the whole protocol rests on: parse then re-serialize must be a no-op,
  // or no hash any consumer holds would survive a round trip.
  for (const { text, doc } of signed) {
    assert.equal(canonicalize(doc), text);
  }
});
