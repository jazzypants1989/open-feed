// twohubs-gate: GOALS scenario 3 and floor item 4 — two relatives on two hubs share, reply and
// react to family-only content as if they were on one hub, with no access control anywhere, read
// by the UNCHANGED weekend-reader.js. The hub operators are hostile: each reads his own disk and
// his own log. The sealing here is a deliberate stand-in (one ephemeral X25519, a blinded slot per
// recipient, chacha20-poly1305, a padding floor) — the construction itself is envelope-gate's
// question, not this one's. This gate's claims are about the reader and the two hubs.
// Kill criteria: a encrypted post the reader refuses; a thread the reader cannot assemble across
// origins; a hub that needs any header beyond If-Match; a hub operator who reads a encrypted post;
// a cross-hub rumor that does not re-fetch the author's own hub; a rumor over a withdrawn post;
// a relocation a reader cannot follow.
import http from 'node:http';
import crypto from 'node:crypto';
import { read, rumors } from '../weekend-reader/weekend-reader.js';
import * as pub from '../weekend-publisher/weekend-publisher.js';

// ---- the hub a third implementer writes (weekend-gate's, plus the operator's log) ----
const everyHeader = new Set();                                         // every request header any hub ever saw
class Hub {
  constructor() { this.files = new Map(); this.swap = new Map(); this.log = []; }
  tag(k) { const f = this.files.get(k); return f ? crypto.createHash('sha256').update(f).digest('base64url') : null; }
  handle(method, url, body, ifMatch, headers) {
    this.log.push({ method, url });
    for (const h of Object.keys(headers)) if /* the rest are Node's fetch's own */ (!['host', 'connection', 'content-length', 'accept', 'accept-language', 'accept-encoding', 'user-agent', 'sec-fetch-mode', 'content-type', 'pragma', 'cache-control'].includes(h)) everyHeader.add(h);
    const m = url.match(/^\/([a-z]+)\/(profile|index|posts\/\d+)$/);
    if (!m) return { status: 404 };
    const key = `${m[1]}/${m[2]}`;
    if (method === 'GET') {
      if (this.swap.has(key)) return { status: 200, body: this.swap.get(key) };
      return this.files.has(key) ? { status: 200, body: this.files.get(key), etag: this.tag(key) } : { status: 404 };
    }
    if (m[2] === 'index' || m[2] === 'profile') {
      if (this.tag(key) !== ifMatch) return { status: 412 };
      this.files.set(key, body); return { status: 200, etag: this.tag(key) };
    }
    if (this.files.has(key)) return { status: 409 };
    this.files.set(key, body); return { status: 201 };
  }
  listen() {
    this.server = http.createServer((req, res) => {
      const c = [];
      req.on('data', (x) => c.push(x));
      req.on('end', () => {
        const r = this.handle(req.method, req.url, Buffer.concat(c), req.headers['if-match'] ?? null, req.headers);
        res.writeHead(r.status, r.etag ? { etag: r.etag } : {}); res.end(r.body);
      });
    });
    return new Promise((ok) => this.server.listen(0, '127.0.0.1', () => { this.url = `http://127.0.0.1:${this.server.address().port}`; ok(this); }));
  }
}
// One fetcher for every origin: `at` is a full URL, so the reader does not know or care which hub.
const get = async (u) => { try { const r = await fetch(u); return r.status === 200 ? Object.assign(Buffer.from(await r.arrayBuffer()), { etag: r.headers.get('etag') }) : null; } catch { return null; } };
const io = { get, put: async (p, b, ifMatch) => (await fetch(p, { method: 'PUT', body: b, headers: ifMatch ? { 'if-match': ifMatch } : {} })).status };

// ---- the sealing stand-in ----
const x25519 = () => { const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519'); return { privateKey, x: publicKey.export({ format: 'jwk' }).x }; };
const xpub = (x) => crypto.createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x }, format: 'jwk' });
const kdf = (priv, x) => Buffer.from(crypto.hkdfSync('sha256', crypto.diffieHellman({ privateKey: priv, publicKey: xpub(x) }), '', 'slot', 32));
const box = (k, p) => { const c = crypto.createCipheriv('chacha20-poly1305', k, Buffer.alloc(12), { authTagLength: 16 }); return Buffer.concat([c.update(p), c.final(), c.getAuthTag()]); };
const unbox = (k, b) => { const d = crypto.createDecipheriv('chacha20-poly1305', k, Buffer.alloc(12), { authTagLength: 16 }); d.setAuthTag(b.subarray(-16)); return Buffer.concat([d.update(b.subarray(0, -16)), d.final()]); };
const FLOOR = 1024;
function encrypt(inner, to) {                                   // `to`: [{ anchor, read }] — the audience goes inside
  const e = x25519(), ck = crypto.randomBytes(32);
  const text = JSON.stringify({ ...inner, to: to.map((r) => r.anchor) });
  const plain = Buffer.from(JSON.stringify({ ...inner, to: to.map((r) => r.anchor), pad: ' '.repeat(Math.max(0, FLOOR - text.length)) }));
  return { epk: e.x, slots: to.map((r) => box(kdf(e.privateKey, r.read), ck).toString('base64url')), ct: box(ck, plain).toString('base64url') };
}
function decrypt(encrypted, me) {                                  // trial-decrypt every slot: nothing in the clear names a recipient
  for (const s of encrypted.slots) {
    try { const ck = unbox(kdf(me.privateKey, encrypted.epk), Buffer.from(s, 'base64url')); return JSON.parse(unbox(ck, Buffer.from(encrypted.ct, 'base64url')).toString()); } catch { /* not my slot */ }
  }
  return null;
}

// ---- three people, two hubs ----
const M = await new Hub().listen(), J = await new Hub().listen();     // Mom's hub (the ex runs it), Jesse's own
const person = (name, hub) => ({ name, key: pub.newKey(), read: x25519(), at: `${hub.url}/${name}`, hub });
const mom = person('mom', M), cousin = person('cousin', M), jesse = person('jesse', J);
const family = [mom, cousin, jesse];
const recoverer = { key: pub.newKey(), salt: 's-aunt' };
const claim = (p, version = 1, extra = {}) => pub.profile({ anchor: p.key.x, version, chain: [{ key: p.key.x }], recovery: pub.commit([recoverer]), locations: [p.at], read: p.read.x, ...extra }, p.key);
for (const p of family) await io.put(`${p.at}/profile`, claim(p), null);
// A profile with no index yet reads as "no index served" — this host is misbehaving — so a brand-new
// identity writes an empty index before anyone looks (a sentence the spec owes; see the card).
const fresh = await read(get, { learned: mom.key.x, at: mom.at });
for (const p of family) await pub.resignIndex(io, p.at, p.key);

// The reader hands back the chain, the locations and the posts — but not the profile's `read`
// key. Sealing to a key taken off an UNVERIFIED profile is the substitution attack in another
// coat, so the sealer below takes it from the profile whose hash the reader pinned. Claim 3
// measures what the naive way costs.
const readKeyOf = async (p, pinned) => {
  const f = await get(`${p.at}/profile`), body = f.subarray(0, f.lastIndexOf(0x0a));
  if (crypto.createHash('sha256').update(body).digest('base64url') !== pinned.profileHash) return null;
  return JSON.parse(body.toString()).read;
};
const naiveReadKeyOf = async (p) => { const f = await get(`${p.at}/profile`); return JSON.parse(f.subarray(0, f.lastIndexOf(0x0a)).toString()).read; };

const seen = new Map();
for (const p of family) { const r = await read(get, { learned: p.key.x, at: p.at }); seen.set(p.key.x, r.pin); }
const audienceOf = async (ps) => Promise.all(ps.map(async (p) => ({ anchor: p.key.x, read: await readKeyOf(p, seen.get(p.key.x)) })));

// 1. Mom: a family-only post, encrypted to Jesse and Cousin (and herself, so her other device reads it).
const fam = await audienceOf([mom, jesse, cousin]);
const n1 = await pub.publish(io, mom.at, mom.key, 1, { at: '2026-08-10T09:00:00Z', encrypted: encrypt({ text: 'the scan came back clear' }, fam) });
const n2 = await pub.publish(io, mom.at, mom.key, 2, { at: '2026-08-10T10:00:00Z', encrypted: encrypt({ text: 'a second one, soon withdrawn' }, fam) });
const momRead = await read(get, { learned: mom.key.x, at: mom.at, pin: seen.get(mom.key.x) });
seen.set(mom.key.x, momRead.pin);
const momTarget = (n) => ({ key: mom.key.x, n, hash: momRead.pin.live.get(n) ?? 'x', loc: mom.at });

// 2. Jesse: a encrypted reply from HIS hub — with the target in the clear (mode A) and inside (mode B).
const jn1 = await pub.publish(io, jesse.at, jesse.key, 1, { at: '2026-08-10T11:00:00Z', rel: 'reply', target: momTarget(1), encrypted: encrypt({ text: 'best news all year' }, fam) });
const jn2 = await pub.publish(io, jesse.at, jesse.key, 2, { at: '2026-08-10T11:05:00Z', encrypted: encrypt({ rel: 'reply', target: momTarget(1), text: 'and this one hides whom it answers' }, fam) });
// 3. Cousin: a reaction, encrypted because the parent was.
const cn1 = await pub.publish(io, cousin.at, cousin.key, 1, { at: '2026-08-10T12:00:00Z', rel: 'like', target: momTarget(1), encrypted: encrypt({}, fam) });
// And a reply that names her post by number with the wrong hash: it is not a reply to what she wrote.
await pub.publish(io, cousin.at, cousin.key, 2, { at: '2026-08-10T12:30:00Z', rel: 'reply', target: { ...momTarget(1), hash: 'not-the-post-she-wrote' }, text: 'names the number, not the post' });

// 4. Jesse's reader reads all three across both hubs. No access control: count what the hubs saw.
for (const h of [M, J]) h.log.length = 0;
const views = new Map();
for (const p of family) { const r = await read(get, { learned: p.key.x, at: p.at, pin: seen.get(p.key.x) }); views.set(p.name, r); if (r.verdict === 'ok') seen.set(p.key.x, r.pin); }
const jesseReadLog = { M: M.log.map((l) => l.url), J: J.log.map((l) => l.url) };
const opened = (who, me) => [...views.get(who).posts].map(([n, o]) => ({ n, rel: o.rel, target: o.target, ...(o.encrypted ? decrypt(o.encrypted, me.read) ?? { locked: true } : {}) }));
const asJesse = Object.fromEntries(family.map((p) => [p.name, opened(p.name, jesse)]));
const thread = (by) => { const root = by.mom.find((p) => p.n === 1); const answers = [...by.jesse, ...by.cousin].filter((p) => p.target?.key === mom.key.x && p.target.n === 1 && p.target.hash === momRead.pin.live.get(1)); return { root: root?.text, answers: answers.map((p) => `${p.rel}${p.text ? ': ' + p.text : ''}`) }; };
const jesseThread = thread(asJesse);
const stranger = { read: x25519() };
const asStranger = Object.fromEntries(family.map((p) => [p.name, opened(p.name, stranger)]));

// 5. What each operator has: his disk, and the log of Jesse's read.
const disk = (hub) => [...hub.files].map(([k, f]) => { const o = JSON.parse(f.subarray(0, f.lastIndexOf(0x0a)).toString()); return { file: k, ...(k.endsWith('profile') ? { anchor: o.anchor.slice(0, 8) + '…', locations: o.locations, read: o.read.slice(0, 8) + '…' } : k.endsWith('index') ? { lists: o.entries.map(([n]) => n), top: o.top } : { n: o.n, at: o.at, rel: o.rel ?? null, target: o.target ? `${o.target.key === mom.key.x ? 'mom' : '?'}#${o.target.n}` : null, encrypted: o.encrypted ? `${o.encrypted.slots.length} slots, ${o.encrypted.ct.length} B` : null, text: o.text ?? null }) }; });
const opensOnDisk = (hub) => [...hub.files.values()].map((f) => JSON.parse(f.subarray(0, f.lastIndexOf(0x0a)).toString())).filter((o) => o.encrypted).map((o) => decrypt(o.encrypted, stranger.read)).filter(Boolean).length;

// 6. The rumor, across hubs: Jesse replies to a number above Mom's top, and to one she withdrew.
await pub.withdraw(io, mom.at, mom.key, 2);
const momAfter = await read(get, { learned: mom.key.x, at: mom.at, pin: seen.get(mom.key.x) });
seen.set(mom.key.x, momAfter.pin);
await pub.publish(io, jesse.at, jesse.key, 3, { at: '2026-08-11T09:00:00Z', rel: 'reply', target: { key: mom.key.x, n: 99, hash: 'x', loc: mom.at }, text: 'to one her hub hides' });
await pub.publish(io, jesse.at, jesse.key, 4, { at: '2026-08-11T09:01:00Z', rel: 'reply', target: momTarget(2), text: 'to one she withdrew' });
await pub.publish(io, jesse.at, jesse.key, 5, { at: '2026-08-11T09:02:00Z', encrypted: encrypt({ rel: 'reply', target: { key: mom.key.x, n: 98, hash: 'x', loc: mom.at }, text: 'encrypted, and above the top' }, fam) });
const jesseFeed = await read(get, { learned: jesse.key.x, at: jesse.at, pin: seen.get(jesse.key.x) });
// Cousin's reader holds Mom's pin; a rumor about Mom must re-fetch MOM's hub, not Jesse's.
const cousinSeen = new Map([[mom.key.x, momAfter.pin]]);
M.log.length = 0; J.log.length = 0;
const raisedClear = await rumors(get, cousinSeen, jesseFeed.posts, 'jesse');
const rumorFetches = { M: M.log.length, J: J.log.length };
const only4 = new Map([[4, jesseFeed.posts.get(4)]]);
M.log.length = 0;
const raisedWithdrawn = await rumors(get, new Map([[mom.key.x, momAfter.pin]]), only4, 'jesse');
const withdrawnFetches = M.log.length;
// The encrypted-target reply (5): no rumor for a reader that is not a recipient; a recipient opens it and can raise it.
const only5 = new Map([[5, jesseFeed.posts.get(5)]]);
const raisedSealedOutsider = await rumors(get, new Map([[mom.key.x, momAfter.pin]]), only5, 'jesse');
const inner5 = decrypt(jesseFeed.posts.get(5).encrypted, cousin.read);
const raisedSealedRecipient = await rumors(get, new Map([[mom.key.x, momAfter.pin]]), new Map([[5, inner5]]), 'jesse');

// 7. Mom leaves the ex's hub for a third one. She writes the same files there, a profile at version 2
// naming the new place, and one new post. The ex's copy stays exactly as it was.
const N = await new Hub().listen();
const momNew = `${N.url}/mom`;
for (const [k, f] of M.files) if (k.startsWith('mom/posts/')) await io.put(`${N.url}/${k}`, f, null);
await io.put(`${momNew}/profile`, claim(mom, 2, { locations: [momNew], prev: momAfter.pin.profileHash }), null);
await io.put(`${momNew}/index`, M.files.get('mom/index'), null);
await pub.resignIndex(io, momNew, mom.key);
const n3 = await pub.publish(io, momNew, mom.key, 3, { at: '2026-08-20T09:00:00Z', text: 'moved, and safe' });
const momAtNew = await read(get, { learned: mom.key.x, at: momNew, pin: momAfter.pin });
await pub.publish(io, jesse.at, jesse.key, 6, { at: '2026-08-20T10:00:00Z', rel: 'reply', target: { key: mom.key.x, n: 3, hash: momAtNew.pin.live.get(3), loc: momNew }, text: 'welcome home' });
const jesseFeed2 = await read(get, { learned: jesse.key.x, at: jesse.at, pin: jesseFeed.pin });
// Cousin's reader only ever knew the ex's hub. It reads Jesse, sees a reply to Mom#3 above the top
// it holds, looks again where the reply says she lives — and has followed her.
const cousinSeen2 = new Map([[mom.key.x, momAfter.pin]]);
const only6 = new Map([[6, jesseFeed2.posts.get(6)]]);
const raisedAfterMove = await rumors(get, cousinSeen2, only6, 'jesse');
const followed = cousinSeen2.get(mom.key.x);
const frozen = await read(get, { learned: mom.key.x, at: mom.at, pin: followed });        // the ex's copy, against the pin that moved
// The same rule as a beacon: a griefer's reply names Mom at a URL he controls. The reader fetches it.
const beacon = await new Hub().listen();
const grief = new Map([...Array(50).keys()].map((i) => [i, { n: i, rel: 'reply', target: { key: mom.key.x, n: 500 + i, hash: 'x', loc: `${beacon.url}/mom` } }]));
beacon.log.length = 0;
const raisedBeacon = await rumors(get, new Map([[mom.key.x, followed]]), grief, 'a griefer');
const beaconHits = beacon.log.length;
// And a reply that names Mom at the ex's FROZEN hub, to a reader whose pin already moved: older index, pin untouched.
const stale = new Map([[mom.key.x, followed]]);
await rumors(get, stale, new Map([[0, { n: 0, rel: 'reply', target: { key: mom.key.x, n: 50, hash: 'x', loc: mom.at } }]]), 'jesse');

// 3. The naive sealer: the read key taken off the profile without checking it is the verified one.
const exRead = x25519();
const exProfile = pub.profile({ anchor: mom.key.x, version: 1, chain: [{ key: mom.key.x }], recovery: pub.commit([recoverer]), locations: [mom.at], read: exRead.x }, pub.newKey());
M.swap.set('mom/profile', exProfile);
const naiveKey = await naiveReadKeyOf(mom), checkedKey = await readKeyOf(mom, momAfter.pin);
const naiveSealed = encrypt({ text: 'for mom only' }, [{ anchor: mom.key.x, read: naiveKey }]);
const exReads = decrypt(naiveSealed, exRead);
M.swap.delete('mom/profile');

// ---- what was seen ----
console.log(`\n  a profile with no index yet reads: ${fresh.verdict} — ${fresh.why}`);
console.log('\n  Jesse\'s reader, reading three people on two hubs\n');
console.log(`    Mom's hub saw:    ${jesseReadLog.M.join('  ')}`);
console.log(`    Jesse's hub saw:  ${jesseReadLog.J.join('  ')}`);
console.log(`    request headers the hubs ever saw beyond If-Match: ${[...everyHeader].join(', ') || 'none'}`);
console.log(`    the thread, as Jesse: "${jesseThread.root}" ← ${jesseThread.answers.join(' · ')}`);
console.log(`    the same files, as a stranger: ${[...Object.values(asStranger)].flat().filter((p) => p.locked).length} locked of ${[...Object.values(asStranger)].flat().length}\n`);
console.log('  what each operator holds\n');
for (const [who, hub] of [['Mom\'s hub (the ex)', M], ['Jesse\'s hub', J]]) {
  console.log(`    ${who}:`);
  for (const row of disk(hub)) console.log(`      ${JSON.stringify(row)}`);
  console.log(`      encrypted posts he can open with his own key: ${opensOnDisk(hub)}`);
}
console.log(`\n  the rumor, across hubs`);
console.log(`    Jesse names Mom#99 (clear) and #2 (withdrawn): raised [${raisedClear}], ${rumorFetches.M} fetches to Mom's hub, ${rumorFetches.J} to Jesse's`);
console.log(`    the withdrawn one alone: raised [${raisedWithdrawn}], ${withdrawnFetches} fetches`);
console.log(`    the encrypted-target reply (#98): a non-recipient raises [${raisedSealedOutsider}]; a recipient who opened it raises [${raisedSealedRecipient}]`);
console.log(`\n  Mom moves`);
console.log(`    Cousin's reader knew only the ex's hub; after Jesse's reply it holds version ${followed.profileVersion}, top ${followed.top}, and raised [${raisedAfterMove}]`);
console.log(`    the ex's frozen copy, read against the moved pin: ${frozen.verdict} — ${frozen.why}`);
console.log(`    50 griefer replies naming a beacon URL: ${beaconHits} hits on the beacon, raised [${raisedBeacon}]`);
console.log(`    a naive sealer on the substituted profile: the ex opens it → ${exReads ? JSON.stringify(exReads.text) : 'nothing'}; the checked sealer gets ${checkedKey === null ? 'no key at all' : 'a key'}\n`);

const gate = [
  ['a encrypted post is an ordinary post to the unchanged reader: all three identities read ok across two origins',
    [...views.values()].every((r) => r.verdict === 'ok')],
  ['no access control anywhere: every request carried nothing but the path and, on writes, If-Match',
    everyHeader.size === 1 && everyHeader.has('if-match')],
  ['Jesse assembles the thread — Mom\'s root, his reply, Cousin\'s reaction — from two hubs, by target key, number AND hash: a reply naming the number with the wrong hash is left out',
    jesseThread.root === 'the scan came back clear' && jesseThread.answers.length === 3 && jesseThread.answers.includes('like') && !jesseThread.answers.some((a) => a.includes('not the post'))],
  ['a stranger holding the same bytes opens none of the encrypted posts',
    Object.values(asStranger).flat().filter((p) => p.locked).length === 5],
  ['neither operator opens a encrypted post from his own disk',
    opensOnDisk(M) === 0 && opensOnDisk(J) === 0],
  ['a reply naming a number above Mom\'s top makes the reader look again at MOM\'s hub — not the replier\'s — and say one line',
    raisedClear.length === 1 && rumorFetches.M === 3 && rumorFetches.J === 0],
  ['a reply to a post Mom withdrew costs nothing and says nothing',
    raisedWithdrawn.length === 0 && withdrawnFetches === 0],
  ['a encrypted target raises no rumor for anyone outside the audience, and does for a recipient who opened it',
    raisedSealedOutsider.length === 0 && raisedSealedRecipient.length === 1],
  ['a reader that knew only the ex\'s hub follows Mom to the new one through a reply\'s `at`, and raises nothing',
    followed.profileVersion === 2 && followed.top === 3 && raisedAfterMove.length === 0],
  ['the ex\'s frozen copy, against the moved pin, is refused — as "an older profile", which the reader files under identity, not host — and the pin stays where it moved',
    frozen.verdict === 'identity' && frozen.why.startsWith('an older profile') && stale.get(mom.key.x).profileVersion === 2],
  ['a griefer\'s `loc` is a beacon the reader hits exactly once per identity per pass — and he is the one named',
    beaconHits === 1 && raisedBeacon.length === 1 && raisedBeacon[0].startsWith('a griefer')],
  ['sealing to a read key taken off an unverified profile hands the thread to the host; taking it from the pinned profile refuses',
    exReads?.text === 'for mom only' && checkedKey === null],
  ['a claimed name with no index yet is "this host is misbehaving" — a publisher writes an empty index before anyone looks',
    fresh.verdict === 'host' && fresh.why === 'no index served'],
  ['the reader hands back the verified profile\'s read key — as first measured it did not, and the sealer had to go round it',
    momRead.read === mom.read.x],
];
const failed = gate.filter(([, ok]) => !ok);
for (const [what, ok] of gate) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
for (const h of [M, J, N, beacon]) h.server.close();
if (failed.length) process.exit(1);
console.log('twohubs-gate: all claims hold');
