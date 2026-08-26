// AT Protocol bridge: base58, base32, DAG-CBOR, DID:PLC, XRPC client.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { encode as base58encode, decode as base58decode } from '../bridge/base58.js';
import { encode as base32encode } from '../bridge/base32.js';
import { encode as dagCborEncode } from '../bridge/dag-cbor.js';
import { newP256Key, p256DidKey, createGenesisOperation, didFromOperation } from '../bridge/did-plc.js';
import { createClient } from '../bridge/atproto.js';
import { createHub } from '../src/hub.js';
import { encrypt, postBinding, newReadingKey } from '../src/openfeed.js';
import { memIo, readerOver, person, list, claim } from './helpers/site.js';

// ---- Base58btc ----

test('base58btc: encode and decode round-trip', () => {
  const input = Buffer.from('Hello World');
  const encoded = base58encode(input);
  assert.ok(encoded.length > 0);
  assert.deepEqual(base58decode(encoded), input);
});

test('base58btc: known vector', () => {
  assert.equal(base58encode(Buffer.from([0])), '1');
  assert.equal(base58encode(Buffer.from([0, 0, 1])), '112');
});

test('base58btc: empty input', () => {
  assert.equal(base58encode(Buffer.alloc(0)), '1');
});

// ---- Base32 ----

test('base32: known vectors', () => {
  assert.equal(base32encode(Buffer.from('f')), 'my');
  assert.equal(base32encode(Buffer.from('fo')), 'mzxq');
  assert.equal(base32encode(Buffer.from('foo')), 'mzxw6');
  assert.equal(base32encode(Buffer.from('foob')), 'mzxw6yq');
  assert.equal(base32encode(Buffer.from('fooba')), 'mzxw6ytb');
  assert.equal(base32encode(Buffer.from('foobar')), 'mzxw6ytboi');
});

// ---- DAG-CBOR ----

test('DAG-CBOR: encodes null, booleans', () => {
  assert.deepEqual(dagCborEncode(null), Buffer.from([0xf6]));
  assert.deepEqual(dagCborEncode(true), Buffer.from([0xf5]));
  assert.deepEqual(dagCborEncode(false), Buffer.from([0xf4]));
});

test('DAG-CBOR: encodes small integers', () => {
  assert.deepEqual(dagCborEncode(0), Buffer.from([0x00]));
  assert.deepEqual(dagCborEncode(1), Buffer.from([0x01]));
  assert.deepEqual(dagCborEncode(23), Buffer.from([0x17]));
  assert.deepEqual(dagCborEncode(24), Buffer.from([0x18, 0x18]));
});

test('DAG-CBOR: encodes negative integers', () => {
  assert.deepEqual(dagCborEncode(-1), Buffer.from([0x20]));
  assert.deepEqual(dagCborEncode(-10), Buffer.from([0x29]));
});

test('DAG-CBOR: encodes strings', () => {
  const encoded = dagCborEncode('hello');
  assert.equal(encoded[0], 0x65);
  assert.equal(encoded.subarray(1).toString(), 'hello');
});

test('DAG-CBOR: encodes arrays', () => {
  const encoded = dagCborEncode([1, 2, 3]);
  assert.equal(encoded[0], 0x83);
});

test('DAG-CBOR: map keys sort shortest first, then by byte value', () => {
  // Same-length keys sort by value...
  const flat = dagCborEncode({ b: 2, a: 1 }).toString('hex');
  assert.ok(flat.indexOf('6161') < flat.indexOf('6162'), 'a before b');

  // ...but a shorter key beats a lexically smaller one. RFC 7049 canonical order, which is what
  // AT Protocol uses; RFC 8949's plain bytewise order would put "aaa" first and change every hash.
  const mixed = dagCborEncode({ aaa: 1, z: 2 }).toString('hex');
  assert.ok(mixed.indexOf('617a') < mixed.indexOf('616161'), 'z (1 char) before aaa (3 chars)');
});

test('DAG-CBOR: encodes bytes', () => {
  const bytes = Buffer.from([0xde, 0xad]);
  const encoded = dagCborEncode(bytes);
  assert.equal(encoded[0], 0x42);
  assert.deepEqual(encoded.subarray(1), bytes);
});

test('DAG-CBOR: nested structures', () => {
  const value = { type: 'test', data: [1, 'two', null], flag: true };
  const encoded = dagCborEncode(value);
  assert.ok(Buffer.isBuffer(encoded));
  assert.ok(encoded.length > 10);
});

// ---- Conformance against plc.directory ----
// A real genesis operation and the identifier it produced, copied from
// https://plc.directory/did:plc:qwwvkiocc2g7rsvbcj4zsxrs/log/audit — the closest thing to an
// outside reading this encoder has. If the map-key ordering or the DID derivation drifts, the
// bytes that get hashed change and both assertions below fail.
const REAL_GENESIS = {
  sig: '1G2o-JhMd4CkV12eeglhFH4f6NgIfd-IU4L3SvF6p6cueT4x5_fWeqtLSjlWMWlfilh_WwjRE1yFSuzhJu-VQg',
  prev: null,
  type: 'plc_operation',
  services: { atproto_pds: { type: 'AtprotoPersonalDataServer', endpoint: 'https://bsky.social' } },
  alsoKnownAs: ['at://jessepence.bsky.social'],
  rotationKeys: [
    'did:key:zQ3shhCGUqDKjStzuDxPkTxN6ujddP4RkEKJJouJGRRkaLGbg',
    'did:key:zQ3shpKnbdPx3g3CmPf5cRVTPe1HtSwVn5ish3wSnDPQCbLJK',
  ],
  verificationMethods: { atproto: 'did:key:zQ3shXjHeiBuRCKmM36cuYnm7YEMzhGnCmCyW92sRJ9pribSF' },
};
// the digest inside CID bafyreiefvvksdqqwrx4mviispgmv4mxpwpqnkz3zbtevpx6az2fxmwygce
const REAL_GENESIS_DIGEST = '85ad5521c2168df8caa11279995e32efb3e0d567790cc957dfc0ce8b765b0611';
const REAL_DID = 'did:plc:qwwvkiocc2g7rsvbcj4zsxrs';

test('DAG-CBOR: reproduces the CID of a real PLC genesis operation', () => {
  const digest = crypto.createHash('sha256').update(dagCborEncode(REAL_GENESIS)).digest('hex');
  assert.equal(digest, REAL_GENESIS_DIGEST);
});

test('DID:PLC: re-derives a real identifier from its genesis operation', () => {
  assert.equal(didFromOperation(REAL_GENESIS), REAL_DID);
});

test('DID:PLC: a real published signature verifies against our encoding', () => {
  // The CID test pins the encoding of the *signed* operation. This pins the *unsigned* one — the
  // bytes that are actually signed — and the signature format: unpadded base64url over raw r||s.
  // The key is secp256k1 (`zQ3s...`), which is what Bluesky's PDS uses; ours are P-256 (`zDn...`).
  // Both are valid AT Protocol curves.
  const { sig, ...unsigned } = REAL_GENESIS;
  const raw = base58decode(REAL_GENESIS.rotationKeys[1].replace(/^did:key:z/, ''));
  assert.equal(Buffer.from(raw.subarray(0, 2)).toString('hex'), 'e701', 'secp256k1 multicodec');
  const spki = Buffer.concat([
    Buffer.from('3036301006072a8648ce3d020106052b8104000a032200', 'hex'),
    Buffer.from(raw.subarray(2)),
  ]);
  const key = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
  const ok = crypto.verify('SHA256', dagCborEncode(unsigned), { key, dsaEncoding: 'ieee-p1363' },
                           Buffer.from(sig, 'base64url'));
  assert.ok(ok, 'the published signature must verify over our DAG-CBOR of the unsigned operation');
});

// ---- DID:PLC ----

test('DID:PLC: P-256 key generation', () => {
  const key = newP256Key();
  assert.ok(Buffer.isBuffer(key.privateKey));
  assert.ok(Buffer.isBuffer(key.publicKey));
});

test('DID:PLC: did:key encoding for P-256', () => {
  const key = newP256Key();
  const didKey = p256DidKey(key.publicKey);
  assert.ok(didKey.startsWith('did:key:z'));
  assert.ok(didKey.length > 30);
});

test('DID:PLC: genesis operation produces a valid DID', () => {
  const rotationKey = newP256Key();
  const signingKey = newP256Key();
  const { did, operation } = createGenesisOperation({
    handle: 'alice.bsky.social',
    pdsEndpoint: 'https://bsky.social',
    rotationKey,
    signingKey,
  });
  assert.ok(did.startsWith('did:plc:'));
  assert.equal(did.length, 32);
  assert.equal(operation.type, 'plc_operation');
  assert.ok(operation.sig);
  assert.equal(operation.prev, null);
  assert.ok(operation.rotationKeys[0].startsWith('did:key:z'));
  assert.ok(operation.verificationMethods.atproto.startsWith('did:key:z'));
  assert.deepEqual(operation.alsoKnownAs, ['at://alice.bsky.social']);
});

test('DID:PLC: different keys produce different DIDs', () => {
  const r1 = newP256Key(), s1 = newP256Key();
  const r2 = newP256Key(), s2 = newP256Key();
  const { did: did1 } = createGenesisOperation({ handle: 'a.test', pdsEndpoint: 'https://x', rotationKey: r1, signingKey: s1 });
  const { did: did2 } = createGenesisOperation({ handle: 'b.test', pdsEndpoint: 'https://x', rotationKey: r2, signingKey: s2 });
  assert.notEqual(did1, did2);
});

// ---- XRPC client ----

test('XRPC: login stores session', async () => {
  const fetcher = async (url, opts) => {
    if (url.includes('createSession')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ accessJwt: 'tok', refreshJwt: 'ref', did: 'did:plc:test', handle: 'test.bsky.social' }) };
    }
    return { ok: false, status: 404, text: async () => '' };
  };
  const client = createClient({ fetchFn: fetcher });
  const res = await client.login({ identifier: 'test.bsky.social', password: 'app-password' });
  assert.equal(res.ok, true);
  assert.equal(client.session.did, 'did:plc:test');
});

test('XRPC: createRecord sends to repo endpoint', async () => {
  const calls = [];
  const fetcher = async (url, opts) => {
    if (url.includes('createSession')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ accessJwt: 'tok', refreshJwt: 'ref', did: 'did:plc:test' }) };
    }
    calls.push({ url, body: JSON.parse(opts.body), auth: opts.headers.authorization });
    return { ok: true, status: 200, text: async () => JSON.stringify({ uri: 'at://did:plc:test/app.bsky.feed.post/abc', cid: 'bafytest' }) };
  };
  const client = createClient({ fetchFn: fetcher });
  await client.login({ identifier: 'test', password: 'pass' });
  await client.createRecord({ collection: 'app.bsky.feed.post', record: { $type: 'app.bsky.feed.post', text: 'hello', createdAt: '2026-08-01T00:00:00Z' } });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.includes('createRecord'));
  assert.equal(calls[0].body.repo, 'did:plc:test');
  assert.equal(calls[0].body.record.text, 'hello');
  assert.ok(calls[0].auth.startsWith('Bearer '));
});

test('XRPC: syncFromRead posts public items, skips encrypted', async () => {
  const hub = createHub(), io = memIo(hub);
  const alice = person('alice'), bob = person('bob');
  const aliceRead = newReadingKey(), bobRead = newReadingKey();
  const AT = 'https://hub.example/alice';
  const pub = await claim(io, alice, AT, { recovery: list() });
  await pub.publish(1, { at: '2026-08-01T00:00:00Z', text: 'public' });
  await pub.publish(2, { at: '2026-08-02T00:00:00Z', encrypted: encrypt({
    content: { text: 'secret' },
    audience: [{ key: alice.key.x, read: aliceRead.x, location: AT }, { key: bob.key.x, read: bobRead.x, location: 'https://bob.example/bob' }],
    binding: postBinding(alice.key.x, 2),
  }) });
  await pub.publish(3, { at: '2026-08-03T00:00:00Z', text: 'also public' });
  const read = await readerOver(io).read({ learned: alice.key.x, at: AT });

  const posts = [];
  const fetcher = async (url, opts) => {
    if (url.includes('createSession')) return { ok: true, status: 200, text: async () => JSON.stringify({ accessJwt: 'tok', refreshJwt: 'ref', did: 'did:plc:test' }) };
    posts.push(JSON.parse(opts.body));
    return { ok: true, status: 200, text: async () => JSON.stringify({ uri: 'at://test/post/1', cid: 'cid' }) };
  };
  const client = createClient({ fetchFn: fetcher });
  await client.login({ identifier: 'test', password: 'pass' });
  const results = await client.syncFromRead(read, AT);
  assert.equal(results.length, 2, 'only public posts');
  assert.equal(posts[0].record.text, 'public');
  assert.equal(posts[1].record.text, 'also public');
});
