// AT Protocol bridge: base58, base32, DAG-CBOR, DID:PLC, XRPC client.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encode as base58encode, decode as base58decode } from '../bridge/base58.js';
import { encode as base32encode } from '../bridge/base32.js';
import { encode as dagCborEncode } from '../bridge/dag-cbor.js';
import { newP256Key, p256DidKey, createGenesisOperation } from '../bridge/did-plc.js';
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

test('DAG-CBOR: encodes maps with sorted keys', () => {
  const encoded = dagCborEncode({ b: 2, a: 1 });
  const str = encoded.toString('hex');
  const aPos = str.indexOf('6161');
  const bPos = str.indexOf('6162');
  assert.ok(aPos < bPos, 'keys must be sorted');
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
