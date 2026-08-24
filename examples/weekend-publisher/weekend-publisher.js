// §8 — the whole publisher in one file, standard library only, and the other half of `GOALS.md`
// scenario 6: a second implementer writes a publisher, then a reader, from the text alone. It
// imports nothing from `src/` and nothing from the weekend reader. Every file in Appendix B is
// signed by this publisher (`tools/regen.js`).
//
// Run it: `node examples/weekend-publisher/weekend-publisher.js`. See `weekend-publisher.md`.
import crypto from 'node:crypto';

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('base64url');
export const newKey = () => { const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519'); return { privateKey, x: publicKey.export({ format: 'jwk' }).x }; };

// A file is its body bytes, one newline, then the signature over the body. Serialize once: the
// bytes signed are the bytes served, so nothing may re-format them afterwards.
export function file(obj, key) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  return Buffer.concat([body, Buffer.from('\n'), Buffer.from(crypto.sign(null, body, key.privateKey).toString('base64url'), 'ascii')]);
}
export const address = (f) => sha256(f.subarray(0, f.lastIndexOf(0x0a)));
const link = (msg, key) => crypto.sign(null, Buffer.from(msg), key.privateKey).toString('base64url');

// ---- the chain: one link shape ----
// Every link carries the list that stood before it (`recovery`), so a reader meeting the chain at any
// length holds a recovery at every length below. A rotation carries the previous key's signature; a
// restore carries vouchers from the recovery; a link may carry both, and vouchers may be added later.
export const rotation = (from, to, recovery) => ({ key: to.x, recovery, sig: link(`${from.x}->${to.x}`, from) });
export const restore = (from, to, vouchers, recovery) => ({ key: to.x, recovery, vouchers: vouchers.map(({ key, salt }) => ({ key: key.x, salt, sig: link(`${from.x}->${to.x}`, key) })) });
export const vouched = (h, from, vouchers) => ({ ...h, vouchers: [...(h.vouchers ?? []), ...restore(from, { x: h.key }, vouchers, h.recovery).vouchers] });
// The recovery list is committed one member at a time, so a voucher reveals only its own salt and
// the leaf count says how many there are — which is what a majority is counted against.
export const commit = (k, members) => ({ k, leaves: members.map(({ key, salt }) => sha256(Buffer.from(`${salt}|${key.x}`))) });

// No `prev` on either overwritten file: nothing reads it. The rollback it would catch is caught by
// version/version and by the rewrite check, and a field nobody reads is one implementers get wrong.
export const profile = ({ anchor, version, name, chain, recovery, locations, read }, key) =>
  file({ anchor, version, ...(name ? { name } : {}), chain, recovery, locations, ...(read ? { read } : {}) }, key);

export const post = (n, fields, key) => file({ n, ...fields }, key);

// entries first, so appending leaves every earlier byte where it was and a reader that cached the
// file can fetch only the tail. `top` is the highest number ever issued and never goes down.
export const index = ({ entries, version, top }, key) => file({ entries, version, top }, key);

// ---- publishing ----
// Take the next free number, then fold the new line into the index the host is actually serving.
// Both retries matter: the first keeps two devices from overwriting each other's posts, the second
// keeps the loser of a index race from dropping the winner's post out of the list.
export async function publishPost(io, at, key, n, fields) {
  let num = n;
  for (;;) {
    const f = post(num, fields, key);
    const r = await io.put(`${at}/posts/${num}`, f);
    if (r === 201 || r === 200) return { n: num, entry: [num, address(f)] };
    if (r !== 409) throw new Error(`publishing post ${num}: ${r}`);
    num++;
  }
}
// The entity tag is the hub's and opaque: it comes off the ETag header with the bytes, never from
// hashing them here.
export async function amendIndex(io, at, key, change) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await io.get(`${at}/index`);
    if (cur && !cur.etag) throw new Error('index: the hub sent no ETag');
    const obj = cur ? JSON.parse(cur.subarray(0, cur.lastIndexOf(0x0a)).toString('utf8')) : { entries: [], version: 0, top: 0 };
    const next = change({ entries: obj.entries, version: obj.version + 1, top: obj.top });
    if (await io.put(`${at}/index`, index(next, key), cur ? cur.etag : null) === 200) return next;
  }
  throw new Error('index: gave up retrying');
}

export const publish = (io, at, key, n, fields) =>
  publishPost(io, at, key, n, fields).then(({ n: num, entry }) =>
    amendIndex(io, at, key, (h) => ({ ...h, entries: [...h.entries, entry], top: Math.max(h.top, num) })).then(() => num));

// A media file: put the bytes at their hash, then list the hash. Unsigned — the index's line admits it.
export const publishMedia = (io, at, key, bytes) => {
  const h = sha256(bytes);
  return io.put(`${at}/media/${h}`, bytes).then((r) => { if (r !== 201 && r !== 200) throw new Error(`media: ${r}`); return amendIndex(io, at, key, (hd) => ({ ...hd, entries: [...hd.entries, [h]] })).then(() => h); });
};
export const withdraw = (io, at, key, n) =>
  amendIndex(io, at, key, (h) => ({ ...h, entries: [...h.entries, [n, null]] }));
// A withdrawn number comes back only at the hash it had — the same signed bytes.
export const relist = (io, at, key, n, hash) =>
  amendIndex(io, at, key, (h) => ({ ...h, entries: [...h.entries, [n, hash]] }));

// Rotating or restoring changes who signs the index, so the index is written again under the new key.
// Until it is, readers who already hold one keep it and readers who do not cannot read at all.
export const resignIndex = (io, at, key) => amendIndex(io, at, key, (h) => h);

// A rewrite drops the lines a withdrawal left behind. How often is the publisher's business — the
// reader is indifferent — so this is a setting, not a rule. Once a month is the suggested default.
const live = (entries) => { const m = new Map(); for (const [n, h] of entries) h === null ? m.delete(n) : m.set(n, typeof n === 'string' ? [n] : [n, h]); return [...m.values()]; };
export const rewrite = (io, at, key) => amendIndex(io, at, key, (h) => ({ ...h, entries: live(h.entries) }));

// ============================================================================================
// The measurement stops here. Everything below runs only when this file is run directly, and is
// the narration `npm run examples` checks — it is not part of the publisher.
// ============================================================================================
const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  const fs = await import('node:fs');
  const assert = (await import('node:assert/strict')).default;
  const src = fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n');
  const impl = src.slice(0, src.findIndex((l) => l.startsWith('// ====')));
  const measured = impl.filter((l) => l.trim() && !l.trim().startsWith('//')).length;

  // Appendix B's keys, so every byte below reproduces.
  const PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');
  const seeded = (label) => {
    const seed = crypto.createHash('sha256').update(`openfeed/v1/vector:${label}`).digest();
    const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PKCS8, seed]), format: 'der', type: 'pkcs8' });
    return { privateKey, x: crypto.createPublicKey(privateKey).export({ format: 'jwk' }).x };
  };
  const alice = seeded('alice/anchor');

  // A hub in eleven lines: create-once on numbered posts, compare-and-swap on the index (§8.1-8.2).
  const files = new Map(), log = [];
  const io = {
    async get(path) { const b = files.get(path); if (!b) return null; const c = Buffer.from(b); c.etag = sha256(b); return c; },
    async put(path, bytes, etag) {
      const had = files.get(path);
      let status;
      if (/\/posts\/|\/media\//.test(path)) status = had ? 409 : 201;
      else if (had && sha256(had) !== etag) status = 412;
      else status = 200;
      if (status < 400) files.set(path, bytes);
      log.push(`  PUT ${path.replace('https://alice.example', '')}${etag ? `  If-Match: ${etag.slice(0, 8)}…` : ''}`.padEnd(52) + `→ ${status}`);
      return status;
    },
  };
  const at = 'https://alice.example/alice';
  const show = () => { const l = log.splice(0); return l.join('\n'); };
  const indexNow = () => JSON.parse(files.get(`${at}/index`).subarray(0, files.get(`${at}/index`).lastIndexOf(0x0a)).toString());

  console.log(`weekend-publisher — §8, written from the text alone\n`);
  console.log(`  ${measured} non-blank, non-comment lines above the marker, standard library only.`);
  console.log(`  It imports nothing from the weekend reader, and nothing from src/. That is the point.\n`);
  assert.ok(measured < 200, 'the kill criterion was 200 lines');

  console.log('§8.4 — claiming a name is a profile, and an index even when it is empty\n');
  const p1 = profile({ anchor: alice.x, version: 1, name: 'Alice', chain: [{ key: alice.x }], recovery: commit(2, []), locations: [at] }, alice);
  await io.put(`${at}/profile`, p1, null);
  await amendIndex(io, at, alice, (h) => h);
  console.log(show());
  console.log(`  index  entries [] version ${indexNow().version} top ${indexNow().top}`);
  console.log('  Without that empty index a brand-new identity reads as `host: no index served`.\n');
  assert.deepEqual(indexNow(), { entries: [], version: 1, top: 0 });

  console.log('§8.2-8.3 — the post is written first, then folded into the index\n');
  for (const [n, text] of [[1, 'the peonies came back'], [2, 'deleted this one'], [3, 'congratulations, both of you']]) {
    await publish(io, at, alice, n, { at: '2026-07-04T10:15:00Z', text });
  }
  console.log(show());
  console.log(`  index  ${JSON.stringify(indexNow().entries)}  version ${indexNow().version} top ${indexNow().top}\n`);
  assert.equal(indexNow().top, 3);

  console.log('§8.2 — a number already held is 409, and the publisher takes the next one\n');
  const other = await publishPost(io, at, alice, 1, { at: '2026-07-20T08:00:00Z', text: 'from the laptop' });
  console.log(show());
  console.log(`  the laptop wanted 1 and got ${other.n} — numbering need not be gapless, and a\n  number nobody lists is nothing.\n`);
  assert.equal(other.n, 4);

  console.log('§4.7 — a withdrawal is an appended line; a rewrite drops what it left behind\n');
  await withdraw(io, at, alice, 2);
  const before = JSON.stringify(indexNow().entries);
  await rewrite(io, at, alice);
  console.log(show());
  console.log(`  after the withdrawal  ${before}`);
  console.log(`  after the rewrite     ${JSON.stringify(indexNow().entries)}`);
  console.log('  Same live set, fewer lines. Post 4 is still unlisted: nobody folded it in.\n');
  assert.equal(indexNow().entries.length, 2);

  console.log('§8.1 — the loser of a race re-reads and folds, and never re-sends its own version\n');
  const phone = await publishPost(io, at, alice, 5, { at: '2026-08-01T09:00:00Z', text: 'from the phone' });
  const laptop = await publishPost(io, at, alice, 6, { at: '2026-08-01T09:00:04Z', text: 'from the laptop' });
  const stale = await io.get(`${at}/index`);                        // both devices read this one
  await amendIndex(io, at, alice, (h) => ({ ...h, entries: [...h.entries, phone.entry], top: 5 }));
  const naive = await io.put(`${at}/index`, index({ entries: [laptop.entry], version: 2, top: 6 }, alice), stale.etag);
  console.log(show());
  console.log(`  the naive retry sends its own version with the stale tag → ${naive}, which is the`);
  console.log('  hub refusing to let the laptop drop the phone\'s post. amendIndex re-reads instead:');
  await amendIndex(io, at, alice, (h) => ({ ...h, entries: [...h.entries, laptop.entry], top: 6 }));
  console.log(show());
  console.log(`  index  ${indexNow().entries.length} lines, top ${indexNow().top} — both posts survive.\n`);
  assert.equal(naive, 412);
  assert.equal(indexNow().entries.length, 4);
  assert.equal(indexNow().top, 6);

  console.log('Every line above is asserted.');
}
