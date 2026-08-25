// §10 — an app MUST keep the signed bytes of everything it publishes: not the text, not a database
// row, the bytes with the signature line on the end. Run: node examples/your-copy/your-copy.js
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { splitFile, verifyFile, address, signingKeyFromSeed, createHub, createPublisher, createReader, encrypt, decrypt, carrierOf } from '../../src/openfeed.js';
import { commit, signProfile } from '../../src/profile.js';
import { fold } from '../../src/index.js';
import { readingKeyFromSeed } from '../../src/envelope.js';

// Appendix B's seeds, so every byte below reproduces.
const seed = (l) => crypto.createHash('sha256').update(`openfeed/v1/vector:${l}`).digest();
const sign = (l) => signingKeyFromSeed(seed(l)), reading = (l) => readingKeyFromSeed(seed(`${l}/read`));
const alice = sign('alice/anchor'), mum = sign('mum'), sis = sign('sis'), op = sign('bro');
const reads = { alice: reading('alice/anchor'), mum: reading('mum'), sis: reading('sis'), op: reading('bro') };
const REC = commit([{ key: mum, salt: 'saltmum' }, { key: sis, salt: 'saltsis' }, { key: op, salt: 'saltbro' }]);
const OLD = 'https://ex.example/alice', NEW = 'https://alice.example/alice';
const ioOver = (h) => ({
  get: async (u) => { const r = h.handle({ method: 'GET', path: new URL(u).pathname }); return r.status === 200 ? { bytes: r.body, etag: r.headers.etag } : null; },
  put: async (u, b, { ifMatch = null } = {}) => { const r = h.handle({ method: 'PUT', path: new URL(u).pathname, headers: ifMatch ? { 'if-match': ifMatch } : {}, body: b }); return { status: r.status, etag: r.headers?.etag ?? null }; },
});
// A reader that keeps every byte it was served. That is all "your readers are a backup" amounts to.
const keeping = (io, held) => ({ get: async (u) => { const r = await io.get(u); if (r) held.set(u.slice(OLD.length), r.bytes); return r; } });
const overCopy = (c) => ({ get: async (u) => (c.has(u.slice(OLD.length)) ? { bytes: c.get(u.slice(OLD.length)), etag: '"e"' } : null) });
const member = (k, r) => ({ key: k.x, read: r.x, loc: OLD });
const seal = (n, content, audience) => encrypt({ content, audience, carrier: carrierOf(alice.x, n), ephemeral: reading(`eph/${n}`), contentKey: seed(`ck/${n}`), random: ((i = 0) => (m) => Buffer.from(crypto.hkdfSync('sha256', `dummies/${n}`, '', String(i++), m)))() });

// Alice publishes from her own device onto the hub her ex operates (§13.1: he is the adversary).
const hub = createHub(), io = ioOver(hub), pub = createPublisher({ io, key: alice, at: OLD });
await pub.claim({ anchor: alice.x, version: 1, name: 'Alice', chain: [{ key: alice.x }], recovery: REC, locations: [OLD], read: reads.alice.x });
await pub.publish(1, { at: '2026-07-04T10:15:00Z', text: 'the peonies came back' });
await pub.publish(2, { at: '2026-07-11T18:02:00Z', text: 'the back garden, before the rain' });
const family = [member(alice, reads.alice), member(mum, reads.mum), member(sis, reads.sis), member(op, reads.op)];
await pub.publish(3, { at: '2026-07-19T09:30:00Z', encrypted: seal(3, { text: 'the appointment is on Friday' }, family) });
const mumHolds = new Map(), sisHolds = new Map();                    // mum looks in on the 20th, and not again
const mumRead = await createReader(keeping(io, mumHolds)).read({ learned: alice.x, at: OLD });
await pub.withdraw(2);
await pub.publish(4, { at: '2026-08-01T21:14:00Z', encrypted: seal(4, { text: 'I am leaving him on Friday' }, [member(alice, reads.alice), member(sis, reads.sis)]) });
await pub.publish(5, { at: '2026-08-03T08:00:00Z', text: 'thank you, all of you' });
await createReader(keeping(io, sisHolds)).read({ learned: alice.x, at: OLD });
console.log('§10 — a copy is bytes, not rows\n');
for (const [path, bytes] of pub.copy) console.log(`  ${path.padEnd(11)}${String(bytes.length).padStart(5)} bytes   address ${address(bytes)}`);
const one = splitFile(pub.copy.get('/posts/1'));
const row = { at: '2026-07-04T10:15:00Z', n: 1, text: 'the peonies came back' };   // three columns, read back
const fromRow = Buffer.concat([Buffer.from(JSON.stringify(row)), Buffer.from('\n'), Buffer.from(one.sigLine)]);
console.log(`\n  /posts/1, the whole of it — this is Appendix B.6:\n    ${one.body}\n    ${one.sigLine}
\n  the same post kept as a database row and re-serialized from its columns:\n    ${JSON.stringify(row)}
    every field, every value, and alice's own signature line: verifies ${verifyFile(fromRow, alice.x) !== null}
\n  Rebuilding it in the order it was written would verify — on this machine, today, with this
  serializer. That is luck, not a rule (§2.3, no-canonicalization/). So: keep the bytes.\n`);
for (const b of pub.copy.values()) assert.ok(verifyFile(b, alice.x), 'every kept file verifies under her key');
assert.deepEqual([pub.copy.size, verifyFile(fromRow, alice.x)], [7, null]);
// The hostile end of GOALS.md scenario 1: the hub is gone, or refusing, or lying.
const lying = createHub({ store: new Map(hub.store) });
lying.store.set('alice/posts/3', pub.copy.get('/posts/1'));
const verdict = async (get) => { try { const r = await createReader(get).read({ learned: alice.x, at: OLD }); return r.verdict === 'ok' ? 'ok' : `${r.verdict}: ${r.why}`; } catch { return 'no verdict at all — the read did not complete (§9)'; } };
const hostile = { 'is gone': { get: async () => null }, refuses: { get: async () => { throw new Error('ECONNREFUSED'); } }, lies: ioOver(lying) };
console.log('§10 — those bytes verify with no host in reach\n');
for (const [what, get] of Object.entries(hostile)) console.log(`  the hub ${what.padEnd(9)} → ${await verdict(get)}`);
const idx = verifyFile(pub.copy.get('/index'), alice.x), set = fold(idx.obj.entries);
const live = [...set.live.keys()].filter((n) => typeof n === 'number');
console.log(`\n  the copy on her phone, checked against her anchor key with no fetcher at all:
    /profile   ${'signed by the key the chain ends on'.padEnd(38)}anchor ${idx.by.slice(0, 8)}…
    /index     ${`verifies, and folds to ${live.join(', ')}`.padEnd(38)}version ${idx.obj.version}, top ${idx.obj.top}`);
for (const n of live) console.log(`    /posts/${n}   ${"verifies; address = the index's line".padEnd(38)}${set.live.get(n).hash.slice(0, 8)}…`);
console.log(`\n  There is no export format here and no bundle to define. The file on the wire already is
  the archive format, because §2.3 signed the bytes that were served.\n`);
assert.deepEqual([await verdict(hostile['is gone']), await verdict(hostile.lies)], ['host: no profile served', 'host: post 3 is not what the index lists']);
assert.match(await verdict(hostile.refuses), /^no verdict/);
for (const n of live) assert.equal(address(pub.copy.get(`/posts/${n}`)), set.live.get(n).hash);
console.log(`§10 — anyone you published to is a backup nobody set up on purpose

  mum's reader kept every byte it was served, and she last looked on the 20th of July.
    she holds  ${[...mumHolds.keys()].join('  ')}
    handed back and verified under alice's anchor key: ${[...mumHolds.values()].filter((b) => verifyFile(b, alice.x)).length} of ${mumHolds.size}
\n  and the limit, exactly:
    post 4  a message to sis; mum was never in its audience  in her copy: ${mumHolds.has('/posts/4') ? 'yes' : 'no'}
    post 5  published after she last looked                  in her copy: ${mumHolds.has('/posts/5') ? 'yes' : 'no'}
    her index is version ${mumRead.pin.indexVersion} where alice's last is ${idx.obj.version} — nothing she holds says those three were all of it
\n  A fallback, not a guarantee: it covers what they could see and proves nothing about
  completeness. Only alice's own index says how much there was.\n`);
for (const b of mumHolds.values()) assert.ok(verifyFile(b, alice.x), 'what a reader was served verifies as hers');
assert.deepEqual([[...mumHolds.keys()], mumRead.pin.indexVersion < idx.obj.version], [['/profile', '/index', '/posts/1', '/posts/2', '/posts/3'], true]);
// The phone is lost. One file survived, and it is the one that says what to look for.
const rebuilt = new Map([['/index', pub.copy.get('/index')]]);
const offer = (b, p, n = Number(/^\/posts\/([0-9]+)$/.exec(p)?.[1])) => (p === '/profile' ? ['taken  ', 'verifies under the anchor key']
  : p === '/index' ? ['ignored', `version ${verifyFile(b, alice.x).obj.version} — older than the one that survived`]
  : !set.live.has(n) ? ['ignored', 'withdrawn: the index does not list it (§4.2)']
  : set.live.get(n).hash === address(b) ? ['taken  ', address(b)] : ['refused', 'not the hash the index carries']);
const take = (bytes, path) => { const [v, why] = offer(bytes, path); if (v.trim() === 'taken') rebuilt.set(path, bytes); console.log(`    ${path.padEnd(11)}${v}  ${why}`); return v.trim(); };
console.log(`§10 — your own last index is the table of contents

  The phone is gone. One file came back off the laptop: /index, and nothing else.
\n    the index says these exist   ${live.join(', ')}      (${idx.obj.entries.filter((e) => e[1] === null).map((e) => e[0]).join(', ')} was withdrawn)
    in hand                      nothing
    missing                      ${live.join(', ')}
\n  Ask mum. She hands back everything her reader kept:`);
for (const [path, bytes] of mumHolds) take(bytes, path);
console.log('\n  And the hub, unasked, offers post 1\'s bytes as post 5:');
assert.equal(take(pub.copy.get('/posts/1'), '/posts/5'), 'refused');
const short = live.filter((n) => !rebuilt.has(`/posts/${n}`));
console.log(`\n  Still missing: ${short.join(', ')}. What the index can and cannot tell her:`);
for (const n of short) console.log(`    post ${n}   ${set.live.get(n).hash}   the number and the hash, and nothing about who saw it`);
console.log(`\n  So she asks a named person for a named list — sis, for posts ${short.join(' and ')}, not "everything":`);
for (const n of short) take(sisHolds.get(`/posts/${n}`), `/posts/${n}`);
const offline = await createReader(overCopy(rebuilt)).read({ learned: alice.x, at: OLD });
console.log(`\n  Her rebuilt copy, read by an ordinary reader over a Map and no network: ${offline.verdict} — posts ${[...offline.posts.keys()].join(', ')}\n`);
assert.deepEqual([short, offline.verdict, [...offline.posts.keys()], rebuilt.size], [[4, 5], 'ok', [1, 3, 4, 5], 6]);
// §10's last sentence: leaving is writing the same files somewhere else.
const home = createHub(), homeIo = ioOver(home);
const relocated = signProfile({ anchor: alice.x, version: 8, name: 'Alice', chain: [{ key: alice.x }], recovery: REC, locations: [OLD, NEW], read: reads.alice.x }, alice);
console.log('§10 — leaving is writing the same files somewhere else\n');
console.log(`  ${(await homeIo.put(`${NEW}/profile`, relocated)).status}  /profile     re-signed once, to name the new location (§3.7) — version 8`);
for (const n of live) {                                              // §8.3: the posts, then the index
  const b = rebuilt.get(`/posts/${n}`), r = await homeIo.put(`${NEW}/posts/${n}`, b);
  assert.equal(r.status, 201); console.log(`  ${r.status}  /posts/${n}     identical bytes, identical address ${address(b).slice(0, 8)}…`);
}
const put = await homeIo.put(`${NEW}/index`, rebuilt.get('/index'));
const followed = await createReader(homeIo).read({ learned: alice.x, at: NEW, pin: mumRead.pin });
console.log(`  ${put.status}  /index       identical bytes, version ${idx.obj.version}, verifying under the same key
\n  mum's pin from the old hub, pointed at the new one: ${followed.verdict} — ${followed.note.join(', ')}
  Same anchor key, same signatures, same addresses. The old host was asked for nothing and had
  nothing to refuse. How a reader who was never told finds her at all is moving/ (§3.7).\n`);
assert.deepEqual([followed.verdict, followed.anchor, followed.note, [...followed.posts.keys()]], ['ok', alice.x, ['withdrawn: 2'], [1, 3, 4, 5]]);
// §13.1, said plainly, and §5.6 from the other side.
const his = verifyFile(hub.store.get('alice/posts/3'), alice.x).obj.encrypted;
const hers = verifyFile(sisHolds.get('/posts/4'), alice.x).obj.encrypted;
const open = (env, r, n) => decrypt(env, r.privateKey, carrierOf(alice.x, n));
console.log(`§13.1 — no mechanism takes back what an audience member already read

  post 3 was family-only, and the operator is family: his reading key is in its audience.
    he opens it from bytes he already holds, no host involved:  ${JSON.stringify(open(his, reads.op, 3).text)}
    the same envelope now that she has left his hub entirely:   ${open(his, reads.op, 3) ? 'still opens' : 'closed'}
    a key that was never in that audience (mum, on post 4):     ${open(hers, reads.mum, 4)}
    sis, who was in it:                                         ${JSON.stringify(open(hers, reads.sis, 4).text)}
\n  Encryption chose who; it cannot un-choose them, and a withdrawal does not reach a copy. §5.6
  says the same from the other side: a private message is provable by its recipient forever.
  The answer to that operator is exit (§10), not secrecy — and exit is what the copy is.\n`);
assert.deepEqual([open(his, reads.op, 3).text, open(hers, reads.mum, 4), open(hers, reads.sis, 4)?.text], ['the appointment is on Friday', null, 'I am leaving him on Friday']);
console.log('Every line above is asserted.');
