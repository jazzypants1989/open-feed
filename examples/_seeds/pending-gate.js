// pending-gate: §4.5's pending line, measured before the ruling and held to after it. Before: a
// scheduled post was listed [n, hash, "pending"], never fetched, and confirmed by a bare line in a
// index only the device could sign — so nothing any reader saw before the device acted depended on
// the line, the hub could release nothing, and the device could post at the next number with
// nothing it lacked (pending-gate.md carries those numbers). Ruled 2026-08-23: cut. This file now
// holds the design to the ruling. Kill criteria: a index carrying the old line that folds; a
// scheduled post that cannot be published without it; a reserved number listed late that a pinned
// reader does not catch.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { read } from '../weekend-reader/weekend-reader.js';
import * as pub from '../weekend-publisher/weekend-publisher.js';
import { Hub, io } from './hub.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const claims = [];
const claim = (what, ok) => { claims.push([what, ok]); console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`); };

const G = pub.newKey(), AT = '/alice';
const REC = pub.commit([{ key: pub.newKey(), salt: 's' }]);
const profile = pub.profile({ anchor: G.x, version: 1, chain: [{ key: G.x }], recovery: REC, locations: ['https://alice.example'] }, G);
const view = (r) => (r.verdict === 'ok' ? `ok [${[...r.posts.keys()].join(',')}]${r.note.length ? ' ' + r.note.join(';') : ''}` : `${r.verdict}: ${r.why}`);

async function scene() {
  const hub = await new Hub().listen(), net = io(hub);
  await net.put(`${AT}/profile`, profile, null);
  for (let n = 1; n <= 7; n++) await pub.publish(net, AT, G, n, { at: '2026-08-01', text: `post ${n}` });
  const pin = (await read(net.get, { learned: G.x, at: AT })).pin;
  return { hub, net, pin, see: (pin) => read(net.get, { learned: G.x, at: AT, pin }), fetches: () => hub.log.filter(([m, u]) => m === 'GET' && u === `${AT}/posts/8`).length };
}

console.log('\n1. The retired line.\n');
const a = await scene();
const p8 = pub.post(8, { at: '2026-08-08T09:00:00Z', text: 'scheduled' }, G);
await pub.amendIndex(a.net, AT, G, (h) => ({ ...h, entries: [...h.entries, [8, pub.address(p8), 'pending']], top: 8 }));
const pinnedOld = await a.see(a.pin), coldOld = await a.see(null);
claim(`a index carrying [8, hash, "pending"]: pinned ${view(pinnedOld)} · cold ${view(coldOld)}`, pinnedOld.verdict === 'host' && coldOld.verdict === 'host' && pinnedOld.why === 'the index does not fold');
claim(`post 8 fetched ${a.fetches()} times`, a.fetches() === 0);
a.hub.close();

console.log('\n2. Scheduled posts without it: the device publishes when it is time, at the next number.\n');
const b = await scene();
for (const n of [8, 9]) await pub.publish(b.net, AT, G, n, { at: '2026-08-02', text: `post ${n}` });
const midB = await b.see(b.pin);
const landed = await pub.publish(b.net, AT, G, 10, { at: '2026-08-08T09:00:00Z', text: 'scheduled' });
const doneB = await b.see(midB.pin), coldB = await b.see(null);
claim(`the scheduled post lands at ${landed}: pinned ${view(doneB)} · cold ${view(coldB)}`, landed === 10 && doneB.verdict === 'ok' && doneB.posts.has(10) && coldB.posts.has(10));
claim('the device needs nothing it does not have — it holds the key and the bytes, and §5.1 puts the number inside the signature', doneB.posts.get(10).text === 'scheduled' && doneB.posts.get(10).n === 10);
// What the line was for: a number reserved on Monday and listed on Saturday, below a top a reader
// has seen, is the custodian's backdate to that reader (gapless-gate). Without the line, it stays one.
const c = await scene();
for (const n of [9, 10]) await pub.publish(c.net, AT, G, n, { at: '2026-08-02', text: `post ${n}` });
const seen = await c.see(c.pin);
await c.net.put(`${AT}/posts/8`, p8);
await pub.amendIndex(c.net, AT, G, (h) => ({ ...h, entries: [...h.entries, [8, pub.address(p8)]] }));
const lateRead = await c.see(seen.pin);
claim(`Monday's number listed late, below a seen top: ${view(lateRead)}`, lateRead.verdict === 'host');
b.hub.close(); c.hub.close();

console.log('\n3. What leaving it costs the text.\n');
const spec = fs.readFileSync(path.join(here, '..', '..', 'open-feed-spec.md'), 'utf8');
const specLines = spec.split('\n').filter((l) => /\bpending\b/i.test(l) && !/pending-gate/.test(l)).length;
const codeLines = ['../weekend-reader/weekend-reader.js', '../weekend-publisher/weekend-publisher.js'].map((f) => fs.readFileSync(path.join(here, f), 'utf8').split('\n').filter((l) => /\bpending\b/.test(l)).length);
console.log(`  spec lines mentioning pending: ${specLines} (were 18)   reader: ${codeLines[0]} (was 7)   publisher: ${codeLines[1]} (was 4)`);
claim('the word is gone from the spec and the reference', specLines === 0 && codeLines[0] === 0 && codeLines[1] === 0);

const failed = claims.filter(([, ok]) => !ok);
console.log(failed.length ? `\n${failed.length} claim(s) did not hold` : `\nall ${claims.length} claims hold`);
process.exit(failed.length ? 1 : 0);
