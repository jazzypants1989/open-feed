// media-gate: the fourth file kind, end to end. RULINGS §10.6 puts media in the index "so retention
// is one rule and reaches encrypted posts"; a blob is the only unsigned file. It had never been listed,
// fetched, withheld or swapped in any gate, and the index's entry shape had no room for it. Here the
// entry is [hash] (withdrawn by [hash, null]), the blob lives at /media/<hash>, and what admits it
// is being listed. Over a socket, with the weekend reader and publisher.
// Kill criteria: a withheld or swapped blob the reader does not catch; a new media file a pinned reader
// calls an insertion; a griefer who can make the author's readers accuse her host; an entry wider
// than ruling 6's ~55 bytes; a media file's reference visible beside a encrypted post.
import http from 'node:http';
import crypto from 'node:crypto';
import { read } from '../weekend-reader/weekend-reader.js';
import * as pub from '../weekend-publisher/weekend-publisher.js';

const sha = (b) => crypto.createHash('sha256').update(b).digest('base64url');
class Hub {
  constructor({ contentCheck = true } = {}) { this.files = new Map(); this.hold = new Set(); this.swap = new Map(); this.contentCheck = contentCheck; }
  tag(k) { const f = this.files.get(k); return f ? sha(f) : null; }
  handle(method, url, b, ifMatch) {
    const m = url.match(/^\/([a-z]+)\/(profile|index|posts\/\d+|media\/([A-Za-z0-9_-]{43}))$/);
    if (!m) return { status: 404 };
    const key = `${m[1]}/${m[2]}`;
    if (method === 'GET') {
      if (this.hold.has(key)) return { status: 404 };
      if (this.swap.has(key)) return { status: 200, body: this.swap.get(key) };
      return this.files.has(key) ? { status: 200, body: this.files.get(key), etag: this.tag(key) } : { status: 404 };
    }
    if (m[2] === 'index' || m[2] === 'profile') { if (this.tag(key) !== ifMatch) return { status: 412 }; this.files.set(key, b); return { status: 200, etag: this.tag(key) }; }
    if (this.files.has(key)) {
      // A blob is content-addressed: a file at a hash it does not hash to is nobody's, and may be
      // replaced by one that does. The numbered-file analogue is §11.5's reclaim rule.
      if (m[3] && this.contentCheck && sha(this.files.get(key)) !== m[3] && sha(b) === m[3]) { this.files.set(key, b); return { status: 200 }; }
      return { status: 409 };
    }
    this.files.set(key, b); return { status: 201 };
  }
  listen() {
    this.server = http.createServer((req, res) => { const c = []; req.on('data', (x) => c.push(x)); req.on('end', () => { const r = this.handle(req.method, req.url, Buffer.concat(c), req.headers['if-match'] ?? null); res.writeHead(r.status, r.etag ? { etag: r.etag } : {}); res.end(r.body); }); });
    return new Promise((ok) => this.server.listen(0, '127.0.0.1', () => { this.url = `http://127.0.0.1:${this.server.address().port}`; ok(this); }));
  }
}
const io = (hub) => ({
  get: async (p) => { const r = await fetch(hub.url + p); return r.status === 200 ? Object.assign(Buffer.from(await r.arrayBuffer()), { etag: r.headers.get('etag') }) : null; },
  put: async (p, b, ifMatch) => (await fetch(hub.url + p, { method: 'PUT', body: b, headers: ifMatch ? { 'if-match': ifMatch } : {} })).status,
});

const A = pub.newKey(), ex = pub.newKey();
const REC = pub.commit([{ key: pub.newKey(), salt: 's' }]);
const AT = '/alice', LOC = ['https://alice.example'];
const png = crypto.randomBytes(20_000), hP = sha(png);
const hubs = [];
async function fresh(opts) {
  const hub = await new Hub(opts).listen(); hubs.push(hub);
  const net = io(hub);
  await net.put(`${AT}/profile`, pub.profile({ anchor: A.x, version: 1, chain: [{ key: A.x }], recovery: REC, locations: LOC }, A), null);
  for (const n of [1, 2]) await pub.publish(net, AT, A, n, { at: '2026-08-01', text: `post ${n}` });
  const pin = (await read(net.get, { learned: A.x, at: AT })).pin;
  return { hub, net, pin, see: (p = pin) => read(net.get, { learned: A.x, at: AT, pin: p }), cold: () => read(net.get, { learned: A.x, at: AT }) };
}

// 1. a media file published and a post referencing it; the pinned reader sees a new media file, not an insertion
const s1 = await fresh();
const headBefore = (await s1.net.get(`${AT}/index`)).length;
await pub.publishMedia(s1.net, AT, A, png);
const headAfter = (await s1.net.get(`${AT}/index`)).length;
await pub.publish(s1.net, AT, A, 3, { at: '2026-08-02', text: 'look', media: [hP] });
const listed = await s1.see();
const coldListed = await s1.cold();
// 2. withheld, swapped
s1.hub.hold.add(`alice/media/${hP}`); const withheld = await s1.see(listed.pin); s1.hub.hold.delete(`alice/media/${hP}`);
s1.hub.swap.set(`alice/media/${hP}`, crypto.randomBytes(20_000)); const swapped = await s1.see(listed.pin); s1.hub.swap.delete(`alice/media/${hP}`);
// 3. a post referencing a hash the index does not list: the media file is simply not there
const stray = sha(Buffer.from('never listed'));
await pub.publish(s1.net, AT, A, 4, { at: '2026-08-03', text: 'broken link', media: [stray] });
const unlisted = await s1.see(listed.pin);
// 4. withdrawn, then the rewrite
await pub.withdraw(s1.net, AT, A, hP);
const withdrawn = await s1.see(unlisted.pin);
await pub.rewrite(s1.net, AT, A);
const rewritten = await s1.see(withdrawn.pin);
const linesAfterRewrite = JSON.parse((await s1.net.get(`${AT}/index`)).toString('utf8').split('\n')[0]).entries;
// 5. a blob is served at its hash whether listed or not — withdrawal is not deletion, as for posts
const stillServed = await s1.net.get(`${AT}/media/${hP}`);
// 6. a second media file survives the rewrite listed by hash alone
const photo2 = crypto.randomBytes(3_000), h2 = sha(photo2);
await pub.publishMedia(s1.net, AT, A, photo2);
await pub.withdraw(s1.net, AT, A, 4);
await pub.rewrite(s1.net, AT, A);
const twoRewrites = await s1.see(rewritten.pin);

// 7. the griefer: junk at her media file's hash before she puts it, on a hub that checks content on a
//    collision and one that does not
const s2 = await fresh(), s3 = await fresh({ contentCheck: false });
const junk = crypto.randomBytes(100);
const g2 = await s2.net.put(`${AT}/media/${hP}`, junk), g3 = await s3.net.put(`${AT}/media/${hP}`, junk);
const a2 = await s2.net.put(`${AT}/media/${hP}`, png), a3 = await s3.net.put(`${AT}/media/${hP}`, png);
for (const s of [s2, s3]) await pub.amendIndex(s.net, AT, A, (h) => ({ ...h, entries: [...h.entries, [hP]] }));
const griefChecked = await s2.see(), griefUnchecked = await s3.see();

// 8. a encrypted post's media file: the bytes are ciphertext, the hash is listed, the reference is inside
//    the envelope — the post in the clear names no media file.
const s4 = await fresh();
const cipher = crypto.randomBytes(20_000), hC = sha(cipher);
await pub.publishMedia(s4.net, AT, A, cipher);
await pub.publish(s4.net, AT, A, 3, { at: '2026-08-02', encrypted: { slots: ['…'], ct: 'opaque, and {media:[hC]} is in here' } });
const encrypted = await s4.see();
const clearPost = JSON.parse(Buffer.from((await s4.net.get(`${AT}/posts/3`))).toString('utf8').split('\n')[0]);
const hubSees = [...s4.hub.files.keys()].filter((k) => k.startsWith('alice/media/')).map((k) => `${k.slice(12, 20)}… ${s4.hub.files.get(k).length} B`);

console.log('\n  the fourth file kind, end to end\n');
console.log(`    a media file listed: the index grows by ${headAfter - headBefore} B; pinned ${listed.verdict} [${listed.note}], ${listed.media?.size ?? 0} media file, bytes ${listed.media?.get(hP)?.equals(png) ? 'match' : 'DIFFER'}; cold ${coldListed.verdict}`);
console.log(`    withheld: ${withheld.verdict} (${withheld.why});  swapped: ${swapped.verdict} (${swapped.why})`);
console.log(`    a post naming an unlisted hash: ${unlisted.verdict} [${unlisted.note}], post 4 present ${unlisted.posts?.has(4)}, media file present ${unlisted.media?.has(stray)}`);
console.log(`    withdrawn: ${withdrawn.verdict} [${withdrawn.note}];  after the rewrite: ${rewritten.verdict}, entries ${JSON.stringify(linesAfterRewrite)};  still served: ${!!stillServed}`);
console.log(`    second media file, second rewrite: ${twoRewrites.verdict} [${twoRewrites.note}], media ${[...(twoRewrites.media?.keys() ?? [])].map((k) => k.slice(0, 8)).join(',')}`);
console.log(`    griefer's junk at her hash: ${g2} / ${g3};  her real bytes: checked hub ${a2}, unchecked ${a3};  her readers then say: checked ${griefChecked.verdict}, unchecked ${griefUnchecked.verdict} (${griefUnchecked.why})`);
console.log(`    encrypted post: ${encrypted.verdict}; the clear post has media field: ${'media' in clearPost}; the hub sees ${hubSees.join(', ')}\n`);

const gate = [
  ['a media file is listed by its hash alone, costs ~47 bytes in the index, and a pinned reader takes it as new rather than as an insertion',
    headAfter - headBefore < 55 && listed.verdict === 'ok' && listed.note.length === 0 && listed.media?.get(hP)?.equals(png) && coldListed.verdict === 'ok'],
  ['a withheld media file and a swapped media file are both the host, and the hash is what catches the swap',
    withheld.verdict === 'host' && swapped.verdict === 'host' && swapped.why.includes('not what the index lists')],
  ['a post naming a media file the index does not list is an ordinary post with a media file that is not there — no accusation',
    unlisted.verdict === 'ok' && unlisted.posts?.has(4) && !unlisted.media?.has(stray)],
  ['a media file is withdrawn like a post, the rewrite drops its lines, and the bytes stay served — withdrawal is not deletion',
    withdrawn.verdict === 'ok' && withdrawn.note.includes(`withdrawn: ${hP}`) && rewritten.verdict === 'ok' && !linesAfterRewrite.some((e) => e[0] === hP) && !!stillServed],
  ['a listed media file survives a rewrite listed by hash alone', twoRewrites.verdict === 'ok' && twoRewrites.media?.has(h2) && !twoRewrites.media?.has(hP)],
  ['a griefer\'s junk at her hash is replaced by bytes that hash to it on a hub that checks on a collision; on one that does not, her own readers accuse her host',
    g2 === 201 && a2 === 200 && griefChecked.verdict === 'ok' && a3 === 409 && griefUnchecked.verdict === 'host'],
  ['a encrypted post\'s media file is ciphertext at a listed hash, the reference is inside the envelope, and the hub learns the size',
    encrypted.verdict === 'ok' && !('media' in clearPost) && hubSees.length === 1 && hubSees[0].endsWith('20000 B')],
];
const failed = gate.filter(([, ok]) => !ok);
for (const [what, ok] of gate) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
for (const h of hubs) h.server.close();
if (failed.length) process.exit(1);
console.log('media-gate: all claims hold');
