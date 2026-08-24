// The command over a TLS hub: the verdicts as exit codes, and a transport failure as no verdict.
import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../src2/cli.js';
import { tlsHub, consumerFetcher, memIo, person, list, claim } from './helpers/site2.js';

const run = async (argv, fetcher) => {
  let out = '', err = '';
  const code = await main(argv, { stdout: { write: (s) => { out += s; } }, stderr: { write: (s) => { err += s; } }, fetcher });
  return { code, out, err };
};

test('verify: ok, misbehaving, and no-verdict each have an exit code', async (t) => {
  const { hub, url } = await tlsHub(t);
  const alice = person('alice');
  const pub = await claim(memIo(hub), alice, `${url}/alice`, { recovery: list(0) });
  await pub.publish(1, { at: '2026-08-01T00:00:00Z', text: 'hello' });
  const f = consumerFetcher();
  const ok = await run(['verify', alice.key.x, `${url}/alice`], f);
  assert.equal(ok.code, 0);
  assert.match(ok.out, /1 post/);
  assert.match(ok.out, /spoken code: (\w+ ){5}\w+/);
  const wrongKey = await run(['verify', person('x').key.x, `${url}/alice`], f);
  assert.equal(wrongKey.code, 1);
  assert.match(wrongKey.out, /identity/);
  hub.store.delete('alice/head');
  const noHead = await run(['verify', alice.key.x, `${url}/alice`, '--json'], f);
  assert.equal(noHead.code, 1);
  assert.equal(JSON.parse(noHead.out).verdict, 'host');
  const unreachable = await run(['verify', alice.key.x, 'https://nowhere.example/x'], f);
  assert.equal(unreachable.code, 3, 'a transport failure is no verdict');
  assert.equal((await run([], f)).code, 2);
});
