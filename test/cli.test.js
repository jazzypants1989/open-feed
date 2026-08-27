// The command over a TLS hub: the verdicts as exit codes, and a transport failure as no verdict.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../src/cli.js';
import { createHub, fileStore, listen } from '../src/hub.js';
import { tlsHub, consumerFetcher, memIo, person, list, claim } from './helpers/site.js';

const run = async (argv, fetcher, serve) => {
  let out = '', err = '';
  const code = await main(argv, { stdout: { write: (s) => { out += s; } }, stderr: { write: (s) => { err += s; } }, fetcher, ...(serve ? { serve } : {}) });
  return { code, out, err };
};

test('verify: ok, misbehaving, and no-verdict each have an exit code', async (t) => {
  const { hub, url } = await tlsHub(t);
  const alice = person('alice');
  const pub = await claim(memIo(hub), alice, `${url}/alice`, { recovery: list() });
  await pub.publish(1, { at: '2026-08-01T00:00:00Z', text: 'hello' });
  const f = consumerFetcher();
  const ok = await run(['verify', alice.key.x, `${url}/alice`], f);
  assert.equal(ok.code, 0);
  assert.match(ok.out, /1 post/);
  assert.match(ok.out, /spoken code: (\w+ ){5}\w+/);
  const wrongKey = await run(['verify', person('x').key.x, `${url}/alice`], f);
  assert.equal(wrongKey.code, 1);
  assert.match(wrongKey.out, /identity/);
  hub.store.delete('alice/index');
  const noIndex = await run(['verify', alice.key.x, `${url}/alice`, '--json'], f);
  assert.equal(noIndex.code, 1);
  assert.equal(JSON.parse(noIndex.out).verdict, 'tampered');
  const unreachable = await run(['verify', alice.key.x, 'https://nowhere.example/x'], f);
  assert.equal(unreachable.code, 3, 'a transport failure is no verdict');
  assert.equal((await run([], f)).code, 2);
});

test('hub: the command is §8 behind a socket, over a store that outlives the process', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfeed-hub-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let srv = null;
  const serve = async (hub, opts) => (srv = await listen(hub, { ...opts, port: 0 }));
  t.after(() => srv?.close());

  const started = await run(['hub', '--data', dir, '--port', '0'], undefined, serve);
  assert.equal(started.code, 0);
  assert.match(started.out, /holds no key/, 'it says what it is at every start');
  assert.equal((await run(['hub', '--port', 'banana'], undefined, serve)).code, 2);

  // A publisher over the real socket, with nothing shared but HTTP.
  const io = {
    get: async (url) => { const r = await fetch(url); return r.status === 404 ? null : { bytes: Buffer.from(await r.arrayBuffer()), etag: r.headers.get('etag') }; },
    put: async (url, bytes, { ifMatch = null } = {}) => { const r = await fetch(url, { method: 'PUT', body: bytes, headers: ifMatch ? { 'if-match': ifMatch } : {} }); return { status: r.status, etag: r.headers.get('etag') }; },
  };
  const alice = person('alice');
  const pub = await claim(io, alice, `${srv.url}/alice`, { recovery: list() });
  await pub.publish(1, { at: '2026-08-01T00:00:00Z', text: 'over a socket' });
  await srv.close();

  // The process is gone and the files are not: a hub is storage, and it held no key to lose.
  const again = createHub({ store: fileStore(dir) });
  assert.equal(again.handle({ method: 'GET', path: '/alice/posts/1' }).status, 200);
  assert.deepEqual(again.store.get('alice/posts/1'), pub.copy.get('/posts/1'), '§2.3: the exact bytes it was given');
});
