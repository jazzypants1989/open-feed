import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHub } from '../src/hub.js';
import { spokenCode } from '../src/openfeed.js';
import { memIo, person, list, claim, readerOver } from './helpers/site.js';
import * as weekend from '../examples/weekend-reader/weekend-reader.js';

test('§8.9 offline archive: both readers verify a directory with no hub', async (t) => {
  const hub = createHub(), io = memIo(hub);
  const sis = person('sis');
  const pub = await claim(io, sis, 'https://pence.family/sis', { recovery: list() });
  await pub.publish(1, { at: '2026-01-01T09:00:00Z', text: 'the first entry' });
  await pub.publish(2, { at: '2026-02-01T09:00:00Z', text: 'a mistake' });
  await pub.publish(3, { at: '2026-03-01T09:00:00Z', text: 'the divorce is final' });
  await pub.withdraw(2);
  const mediaHash = await pub.publishMedia(Buffer.from('a photograph of the kids', 'utf8'));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfeed-archive-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [p, bytes] of pub.copy) {
    const f = path.join(dir, p);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, bytes);
  }

  const BASE = 'file:///archive/sis';
  const offline = async (url) => {
    const file = path.join(dir, url.slice(BASE.length));
    if (!url.startsWith(BASE) || !fs.existsSync(file)) return null;
    const bytes = fs.readFileSync(file);
    return { bytes, etag: `"${bytes.length}"` };
  };
  const offlineBytes = async (url) => (await offline(url))?.bytes ?? null;

  const a = await readerOver({ get: offline }).read({ learned: sis.key.x, at: BASE });
  assert.equal(a.verdict, 'ok');
  assert.deepEqual([...a.posts.keys()], [1, 3]);
  assert.equal(a.posts.get(3).text, 'the divorce is final');
  assert.ok(a.media.has(mediaHash));

  const b = await weekend.read(offlineBytes, { learned: sis.key.x, at: BASE });
  assert.equal(b.verdict, 'ok');
  assert.deepEqual([...b.posts.keys()], [1, 3]);

  const tampered = path.join(dir, 'posts/3');
  const orig = fs.readFileSync(tampered);
  const bad = Buffer.from(orig);
  bad[orig.indexOf(Buffer.from('final'))] = 'F'.charCodeAt(0);
  fs.writeFileSync(tampered, bad);

  const c = await readerOver({ get: offline }).read({ learned: sis.key.x, at: BASE });
  assert.equal(c.verdict, 'tampered');

  const d = await weekend.read(offlineBytes, { learned: sis.key.x, at: BASE });
  assert.equal(d.verdict, 'tampered');
});
