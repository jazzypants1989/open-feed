// Verifies Appendix D against the published spec document itself, rather than against a
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
  VerifyError,
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

/** Identity documents by URL, keeping the lowest `seq` — genesis lists every key in use. */
const genesisByUrl = new Map();
for (const { doc } of identityDocs) {
  const url = normalizeIdentityUrl(doc.url);
  const held = genesisByUrl.get(url);
  if (!held || doc.seq < held.seq) genesisByUrl.set(url, doc);
}

test('the spec contains the signed vectors Appendix D claims', () => {
  assert.ok(signed.length >= 7, `expected at least 7 signed vectors, extracted ${signed.length}`);
  assert.ok(genesisByUrl.has('https://test.example/'), 'no identity document for test.example');
  assert.ok(genesisByUrl.has('https://posse.example/'), 'no identity document for posse.example');
});

test('canonicalizer reproduces D.2 known SHA-256', () => {
  // The external anchor: a hash computed outside this implementation. Without it a
  // canonicalizer bug would be invisible, since the same code produces and checks.
  const item = {
    _feed_url: 'https://test.example/feed.json',
    _version: 1,
    authors: [{ url: 'https://test.example/' }],
    content_text: 'Hello, wörld! 👋',
    date_published: '2025-01-15T12:00:00Z',
    id: 'urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
  };
  assert.equal(
    sha256(canonicalBytes(item)).toString('hex'),
    '7176563ef95f0a466379e161081a05f591ea6be60b8ccf8e613801d33c16d168',
  );
});

test('every resolvable signed vector verifies', () => {
  const results = [];
  for (const { doc } of signed) {
    const author = claimedAuthor(doc);
    const identityDocument = genesisByUrl.get(author);
    if (!identityDocument) { results.push({ author, skipped: true }); continue; }
    // Not a throw-guard: verifyDocument does author binding, key resolution, iat,
    // revocation, and the Ed25519 check, and throws with a reason on any failure.
    const info = verifyDocument(doc, { identityDocument });
    assert.equal(info.author, author);
    results.push({ author, keyId: info.keyId });
  }
  const verified = results.filter((r) => !r.skipped);
  assert.ok(verified.length >= 7, `only ${verified.length} vectors verified`);
});

test('vectors signed by reader.example cannot be verified from the spec alone', () => {
  // Appendix D publishes reader.example's *signatures* (D.6 pins, D.7 follows) but never
  // its identity document or its key's `x`, so a third party working only from the
  // published spec cannot check them. Recorded here so it stays visible; fixing it means
  // publishing a reader.example identity document as a vector.
  const unresolvable = signed.filter((v) => !genesisByUrl.has(claimedAuthor(v.doc)));
  for (const { doc } of unresolvable) {
    assert.equal(claimedAuthor(doc), 'https://reader.example/');
  }
  assert.equal(unresolvable.length, 2, 'expected exactly D.6 and D.7 to be unresolvable');
});

test('manifest entries commit the exact published bytes of their items', () => {
  // Spec §9: each `items` entry is [version, hash] over the item's FULL published bytes,
  // `_sig` included — a different hash from the signing payload in §6.3.
  const items = signed.filter((v) => typeof v.doc._feed_url === 'string' && !Array.isArray(v.doc.keys));
  const manifests = signed.filter((v) => typeof v.doc.feed_url === 'string');
  assert.ok(items.length >= 2 && manifests.length >= 2, 'expected item and manifest vectors');

  let checked = 0;
  for (const { doc: manifest } of manifests) {
    for (const [id, entry] of Object.entries(manifest.items ?? {})) {
      const item = items.find((v) => v.doc.id === id);
      if (!item) continue;
      const [version, hash] = entry;
      assert.equal(item.doc._version, version, `version mismatch for ${id}`);
      assert.equal(documentHash(item.doc), hash, `hash mismatch for ${id}`);
      checked++;
    }
  }
  assert.ok(checked >= 3, `expected at least 3 committed items, checked ${checked}`);
});

test('manifest chain links by prev', () => {
  const manifests = signed
    .filter((v) => typeof v.doc.feed_url === 'string')
    .sort((a, b) => a.doc.seq - b.doc.seq);
  const [genesis, second] = manifests;
  assert.equal(genesis.seq ?? genesis.doc.seq, 1);
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

// ---- known inconsistency, characterized rather than fixed ----

test('KNOWN: D.2b is signed after test-key-1 is revoked in D.5', () => {
  // D.2b's date_published is 2025-02-15T09:00:00Z (1739610000). D.5 sets test-key-1's
  // revoked_at to 1739577600 — nine hours earlier. Spec §6.5 step 5 resolves a kid
  // against the CURRENT identity document, which is D.5, so a conforming verifier must
  // reject D.2b per §4.4. regen.js does not catch this because it checks the raw
  // signature and not revocation.
  //
  // This test asserts the inconsistency so it stays visible and fails loudly once the
  // vectors are corrected. Fixing it means moving D.2b's timestamp before the revocation
  // or moving the revocation later, either of which cascades through D.2b's hash, D.3b's
  // items entry, and D.3b's own bytes — a call for the spec author, not this test.
  const current = signed
    .filter((v) => Array.isArray(v.doc.keys) && normalizeIdentityUrl(v.doc.url) === 'https://test.example/')
    .sort((a, b) => b.doc.seq - a.doc.seq)[0].doc;
  const reply = signed.find((v) => v.doc.id === 'urn:uuid:6ba7b810-9dad-11d1-80b4-00c04fd430c8').doc;

  assert.throws(
    () => verifyDocument(reply, { identityDocument: current }),
    (e) => e instanceof VerifyError && /revoked/.test(e.message),
  );

  // The signature itself is sound; only the revocation window is wrong.
  const genesis = genesisByUrl.get('https://test.example/');
  assert.ok(verifyDocument(reply, { identityDocument: genesis }));
});
