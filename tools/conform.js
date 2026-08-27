// Does your implementation conform? The suite `tools/regen.js` runs against our two readers, aimed
// at yours instead — and a second suite that drives §8 against a hub over the network.
//
//   node tools/conform.js reader                     both of ours, as a self-test
//   node tools/conform.js reader ./my-reader.mjs     yours
//   node tools/conform.js hub https://example/       read-only checks against a live hub
//   node tools/conform.js hub https://example/ --claim <name>    the write sequence, §8
//
// A reader module must export `read(get, { learned, at, checkpoint })`, where `get(url)` answers the
// bytes or null, and return `{ verdict, note, posts, media, read, checkpoint }` — the shape §7
// describes and `examples/weekend-reader/` implements in one file. About twenty lines of adapter if
// your own signature differs.
//
// NOTHING HERE IS A NEW RULE. Every check names a § that a `rule()` in `examples/` already proves; a
// check with no rule behind it would be a spec proposal wearing a conformance test, and the spec is
// generated precisely so that cannot happen quietly.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { read as weekendRead } from '../examples/weekend-reader/weekend-reader.js';
import * as pub from '../examples/weekend-publisher/weekend-publisher.js';
import { isPublicOrLoopbackAddress } from '../src/addresses.js';
import { createFetcher } from '../src/fetch.js';
import { sha256 } from '../src/file.js';
import { createReader } from '../src/reader.js';
import { edKey, readerSuite } from './corpus.js';

/** src/reader.js behind the adapter contract — proof the contract fits an implementation that did not grow up in it. */
const reference = (get, opts) => createReader({
  get: async (u) => { const b = await get(u); return b ? { bytes: b, etag: `"${sha256(b)}"` } : null; },
}).read(opts);

export async function loadReader(spec) {
  if (!spec || spec === 'all') return [['weekend-reader', weekendRead], ['src/reader.js', reference]];
  if (spec === 'weekend') return [['weekend-reader', weekendRead]];
  if (spec === 'reference') return [['src/reader.js', reference]];
  const m = await import(path.resolve(spec));
  const fn = m.read ?? m.default;
  if (typeof fn !== 'function') throw new Error(`${spec} exports no read(get, opts) — see the contract at the top of tools/conform.js`);
  return [[spec, fn]];
}

// ---- §8: the hub, over the network ----
//
// The read-only half asks only what any hub must answer. The write half claims a name, and a name is
// first-come and is never released (§8.4) — so it is opt-in, and you name the name yourself.
export async function hubSuite(base, { check, fetcher, name = null }) {
  const at = base.replace(/\/$/, '');
  // `get` answers bytes and an ETag; the headers a hub must expose need the raw request (§8.7).
  const raw = (url) => fetcher.request(url).then((r) => r, () => null);

  const nobody = `${at}/${'z'.repeat(20)}/profile`;
  let missing = null;
  try { missing = await fetcher.get(nobody); } catch (e) { check(`§9 the origin is reachable over HTTPS — ${e.message}`, false); return; }
  check('§8 an unclaimed name is not served', missing === null);

  if (!name) {
    console.log('  (read-only: pass --claim <name> to run the write sequence, which claims that name permanently)');
    return;
  }

  const key = edKey(`conformance/${name}`), me = `${at}/${name}`;
  const thief = edKey(`conformance/${name}/thief`);
  const put = (p, bytes, opts) => fetcher.put(`${me}${p}`, bytes, opts);
  const profile = (version, k = key) => pub.profile({ anchor: key.x, version, name, chain: [{ key: key.x }], recovery: { leaves: [] }, locations: [me] }, k);

  // §8.4: a profile that does not verify is refused, and claiming a name takes both files.
  const forged = pub.profile({ anchor: key.x, version: 1, name, chain: [{ key: key.x }], recovery: { leaves: [] }, locations: [me] }, thief);
  check('§8.4 a profile not signed by the key its chain ends on is refused', (await put('/profile', forged)).status >= 400);

  const p1 = profile(1);
  const claimed = await put('/profile', p1);
  check('§8.4 a verifying profile claims an unheld name', claimed.status === 200 || claimed.status === 201);
  const idx0 = pub.index({ entries: [], version: 1, highest: 0 }, key);
  check('§8.4 the index that completes the claim is accepted', [200, 201].includes((await put('/index', idx0, { ifMatch: null })).status));

  // §2.3: the bytes served are the bytes given. Everything else in §7 rests on this one.
  const served = await fetcher.get(`${me}/profile`);
  check('§2.3 the profile comes back as the exact bytes it was given', served !== null && Buffer.compare(served.bytes, p1) === 0);
  check('§8.1 an overwritable file is served with an ETag to compare against', typeof served?.etag === 'string' && served.etag.length > 0);

  // §8.4: first come, with the profile as the proof.
  const other = edKey(`conformance/${name}/other`);
  const otherProfile = pub.profile({ anchor: other.x, version: 1, name, chain: [{ key: other.x }], recovery: { leaves: [] }, locations: [me] }, other);
  check('§8.4 a name held under another anchor is refused', (await put('/profile', otherProfile, { ifMatch: served?.etag })).status === 409);

  // §8.1: compare-and-swap on the two overwritable files.
  check('§8.1 an overwrite with a stale tag is refused', (await put('/profile', profile(2), { ifMatch: '"not-the-tag"' })).status === 412);
  check('§8.1 an overwrite with the tag the hub served is accepted', (await put('/profile', profile(2), { ifMatch: served?.etag })).status === 200);

  // §8.2, §8.5: a number is created once, and its owner may take it back.
  const post = pub.post(1, { at: '2026-01-01T00:00:00Z', text: 'conformance' }, key);
  check('§8.2 a new number is created', (await put('/posts/1', post)).status === 201);
  const stolen = pub.post(1, { at: '2026-01-01T00:00:00Z', text: 'not hers' }, thief);
  check('§8.5 a number held by another key is not overwritten', (await put('/posts/1', stolen)).status === 409);

  // §8.6: media is admitted by its hash, and by nothing else.
  const bytes = Buffer.from('a conformance photograph');
  check('§8.6 media at its own hash is accepted', [200, 201].includes((await put(`/media/${sha256(bytes)}`, bytes, { contentType: 'application/octet-stream' })).status));
  check('§8.6 media at any other address is refused', (await put(`/media/${sha256(Buffer.from('x'))}`, bytes, { contentType: 'application/octet-stream' })).status >= 400);

  // §8.7: a reader in a browser, on another origin, must be able to read.
  const cors = await raw(`${me}/profile`);
  check('§8.7 cross-origin reads are answered', cors?.headers?.['access-control-allow-origin'] === '*');
  check('§8.7 the ETag is exposed to a cross-origin reader', /etag/i.test(cors?.headers?.['access-control-expose-headers'] ?? ''));
}

// ---- the command ----
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, target, ...flags] = process.argv.slice(2);
  const flag = (n) => { const i = flags.indexOf(`--${n}`); return i < 0 || i + 1 >= flags.length ? null : flags[i + 1]; };
  const results = [];
  const check = (what, ok) => { results.push([what, !!ok]); return ok; };
  const started = Date.now();

  if (mode === 'reader') {
    for (const [label, fn] of await loadReader(target)) {
      const before = results.length;
      await readerSuite(fn, (what, ok) => check(`${label}: ${what}`, ok));
      console.log(`  ${label}: ${results.slice(before).filter(([, ok]) => ok).length}/${results.length - before}`);
    }
  } else if (mode === 'hub') {
    if (!target) { console.error('node tools/conform.js hub <base-url> [--claim <name>] [--allow-loopback]'); process.exit(2); }
    await hubSuite(target, {
      check,
      name: flag('claim'),
      fetcher: createFetcher(flags.includes('--allow-loopback') ? { isAddressAllowed: isPublicOrLoopbackAddress } : {}),
    });
  } else {
    console.error(`usage: node tools/conform.js reader [<module>|weekend|reference]
       node tools/conform.js hub <base-url> [--claim <name>] [--allow-loopback]

A reader module exports read(get, { learned, at, checkpoint }).
--claim permanently claims that name on that hub (§8.4). Nothing releases it.`);
    process.exit(2);
  }

  const failed = results.filter(([, ok]) => !ok);
  for (const [what] of failed) console.error(`  FAIL  ${what}`);
  console.log(`${results.length - failed.length}/${results.length} checks hold in ${Date.now() - started}ms`);
  if (failed.length) process.exit(1);
}
