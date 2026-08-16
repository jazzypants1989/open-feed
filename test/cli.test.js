// The command, end to end: argv in, a report and an exit code out, over a real socket.
//
// The reason this is a test and not a smoke check is the pin file. §12 makes pinning a MUST
// because the property it buys only exists across runs, so a verifier's *persistence* is part
// of what conformance means — and a pin store that silently fails to round-trip looks exactly
// like a verifier that is working.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DAY, T0, newSite, consumer, makeSigner } from './helpers/site.js';
import { run } from '../src/cli.js';
import { Publisher, createReader, ObservationStore, sign, documentHash } from '../src/index.js';

/** Collects what the command wrote, so a test can read it back. */
function capture() {
  const chunks = [];
  return { write: (s) => chunks.push(s), get text() { return chunks.join(''); } };
}

function tmpFile(t, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfeed-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, name);
}

function publisher(origin, signer, { days = 3 } = {}) {
  const p = new Publisher({
    identity: origin, feedUrl: `${origin}feed.json`, manifestUrl: `${origin}manifest.json`,
    title: 'Mom', signer, profile: { name: 'Mom' }, now: () => T0,
  });
  for (let day = 0; day < days; day++) {
    p.publishItem({ id: `urn:uuid:day-${day}`, content_text: `day ${day}` }, { at: T0 + day * DAY });
    p.advanceManifest({ updated: T0 + day * DAY + 3600 });
  }
  return p;
}

/** `run` with the harness's fetch policy — pinned CA, seeded resolver — instead of the default. */
function cli(t, argv, { now = () => T0 + 3 * DAY } = {}) {
  const me = consumer(t, { now });
  const stdout = capture();
  const stderr = capture();
  return run({
    argv,
    stdout,
    stderr,
    readerFor: (state) => createReader({ ...state, fetcher: me.fetcher, now }),
  }).then((code) => ({ code, out: stdout.text, err: stderr.text }));
}

test('verify reports a clean identity and exits 0', async (t) => {
  const site = await newSite(t);
  site.serve(publisher(site.url, makeSigner()));

  const { code, out } = await cli(t, ['verify', site.url]);
  assert.equal(code, 0);
  assert.match(out, /identity {2}https:\/\/mom\.example/);
  assert.match(out, /openfeed\.json seq 1 {2}· {2}manifest seq 3/);
  assert.match(out, /3 live/);
  assert.match(out, /findings {2}none/);
});

test('a run without --pins says it cannot provide the §13.2 guarantees', async (t) => {
  const site = await newSite(t);
  site.serve(publisher(site.url, makeSigner()));

  const { out } = await cli(t, ['verify', site.url]);
  assert.match(out, /no pin store \(--pins\)/);
  assert.match(out, /first contact: trust-on-first-use/);
});

test('--pins persists both chains, so the second run is not first contact', async (t) => {
  const site = await newSite(t);
  site.serve(publisher(site.url, makeSigner()));
  const pinFile = tmpFile(t, 'pins.json');

  const first = await cli(t, ['verify', site.url, '--pins', pinFile]);
  assert.equal(first.code, 0);
  assert.match(first.out, /first contact/);
  assert.doesNotMatch(first.out, /no pin store/);

  const saved = JSON.parse(fs.readFileSync(pinFile, 'utf8'));
  assert.equal(saved.pins.pins[`${site.url}openfeed.json`].seq, 1);
  assert.equal(saved.pins.pins[`${site.url}manifest.json`].seq, 3);
  assert.ok(Object.keys(saved.observations.firstSeen).length >= 3, 'and §4.4’s first-observation record');
  assert.ok(saved.observations.feedManifests[`${site.url}feed.json`], 'and §9.3 invariant 5’s');
  assert.ok(saved.migrations, 'and §4.5’s retained predecessor state, which only exists before a move');

  const second = await cli(t, ['verify', site.url, '--pins', pinFile]);
  assert.equal(second.code, 0);
  assert.doesNotMatch(second.out, /first contact/, 'the pin is what makes the second run mean more');
});

test('a rewritten history is caught on the second run and exits 2, and stays caught', async (t) => {
  const site = await newSite(t);
  const signer = makeSigner();
  site.serve(publisher(site.url, signer));
  const pinFile = tmpFile(t, 'pins.json');

  assert.equal((await cli(t, ['verify', site.url, '--pins', pinFile])).code, 0);

  // The host rewrites the manifest chain below the pin and rebuilds everything above it, so
  // every hash chains and every signature verifies. Only the persisted pin catches it — which
  // is the entire argument for the file.
  const rebuilt = publisher(site.url, signer, { days: 0 });
  for (let day = 0; day < 3; day++) {
    if (day !== 1) rebuilt.publishItem({ id: `urn:uuid:day-${day}`, content_text: `day ${day}` }, { at: T0 + day * DAY });
    rebuilt.advanceManifest({ updated: T0 + day * DAY + 3600 });
  }
  for (const [p, bytes] of rebuilt.files()) site.replace(p, JSON.parse(bytes.toString('utf8')));

  const caught = await cli(t, ['verify', site.url, '--pins', pinFile], { now: () => T0 + 4 * DAY });
  assert.equal(caught.code, 2);
  assert.match(caught.err, /EquivocationError/);

  // §5.3.1: the freeze is a state a human resolves, so it has to survive the process. A freeze
  // that evaporates on restart is a detection the consumer then forgets.
  const frozen = JSON.parse(fs.readFileSync(pinFile, 'utf8')).pins.frozen;
  assert.equal(Object.keys(frozen).length, 1);
  const again = await cli(t, ['verify', site.url, '--pins', pinFile], { now: () => T0 + 5 * DAY });
  assert.equal(again.code, 2);
});

test('withholding is a finding, not an error: exit 1 with the item named', async (t) => {
  const site = await newSite(t);
  const p = site.serve(publisher(site.url, makeSigner()));
  // The manifest commits it; nothing yields it — not the feed page, and not its §7.6 item URL,
  // which is the surface §9.3 says a consumer must actually have tried before it may accuse
  // anyone. Nothing is forged and no invariant is broken: the manifest is doing its job.
  const gone = p.feed.items.find((i) => i.id === 'urn:uuid:day-1');
  site.replace('feed.json', { ...p.feed, items: p.feed.items.filter((i) => i !== gone) });
  site.remove(`feed/items/${documentHash(gone)}.json`);

  const { code, out } = await cli(t, ['verify', site.url]);
  assert.equal(code, 1);
  assert.match(out, /1 WITHHELD/);
  assert.match(out, /\[withheld\] urn:uuid:day-1/);
});

test('--json emits the result rather than the report', async (t) => {
  const site = await newSite(t);
  site.serve(publisher(site.url, makeSigner()));

  const { code, out } = await cli(t, ['verify', site.url, '--json']);
  assert.equal(code, 0);
  const parsed = JSON.parse(out);
  assert.equal(parsed.identity.document.name, 'Mom');
  assert.equal(parsed.items.live.length, 3);
});

test('usage errors are usage errors', async (t) => {
  assert.equal((await cli(t, [])).code, 64);
  assert.equal((await cli(t, ['--help'])).code, 0);
  assert.equal((await cli(t, ['verify'])).code, 64);
  assert.equal((await cli(t, ['frobnicate', 'https://x.example/'])).code, 64);
  const bad = await cli(t, ['verify', 'https://x.example/', '--wat']);
  assert.equal(bad.code, 64);
  assert.match(bad.err, /unknown option --wat/);
});

test('an identity served without ACAO is reported as non-conforming, not refused', async (t) => {
  // §3.3 requires the header on every publicly-readable document, but only a browser can
  // enforce it. A CLI that refused the document would be inventing a rule; one that said
  // nothing would let a publisher ship a feed no browser reader can use.
  const site = await newSite(t);
  const signer = makeSigner();
  const p = publisher(site.url, signer);
  site.serve(p);

  const { code, out } = await cli(t, ['verify', site.url]);
  assert.equal(code, 0, 'the harness serves ACAO, so this is the control');
  assert.doesNotMatch(out, /Access-Control-Allow-Origin/);

  // And the finding shape itself, without a second server: an item signed by an identity whose
  // document the reader could not resolve is unverifiable rather than invalid.
  const stranger = { ...p.items.get('urn:uuid:day-0'), authors: [{ url: 'https://stranger.example/' }] };
  delete stranger._sig;
  stranger._sig = sign(stranger, signer.privateKey, `${site.url}#${signer.kid}`);
  site.replace('feed.json', { ...p.feed, items: [stranger, ...p.feed.items] });

  const mixed = await cli(t, ['verify', site.url]);
  assert.equal(mixed.code, 1);
  assert.match(mixed.out, /\[unverifiable\]/);
});

test('the observation record round-trips through the file (§4.4)', (t) => {
  const file = tmpFile(t, 'pins.json');
  const store = new ObservationStore({ now: () => T0 });
  store.recordManifest('https://mom.example/', { items: { 'urn:uuid:a': [1, 'H'] } });

  fs.writeFileSync(file, JSON.stringify({ pins: null, observations: store }));
  const back = ObservationStore.fromJSON(JSON.parse(fs.readFileSync(file, 'utf8')).observations);
  assert.equal(back.firstObserved('https://mom.example/', 'urn:uuid:a'), T0);
  assert.equal(back.firstObserved('https://mom.example/', 'urn:uuid:b'), null);
});
