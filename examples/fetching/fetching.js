// §9 — fetching: the rules on a reader's outbound requests. Run: node examples/fetching/fetching.js
import assert from 'node:assert/strict';
import http from 'node:http';
import { rule } from '../../tools/rule.js';
import { isPublicAddress, isPublicOrLoopbackAddress, parseIPv4 } from '../../src/addresses.js';
import { createFetcher, guardedLookup, FetchError, TIMEOUT_MS, MAX_REDIRECTS, MAX_SOCKETS_PER_ORIGIN, MAX_BYTES } from '../../src/fetch.js';
import { MAX_IDENTITIES_PER_PASS, createReader } from '../../src/reader.js';

const consumer = createFetcher();
const urlVerdict = (u) => { try { consumer.assertUrlAllowed(u); return 'allowed'; } catch (e) { return e.code; } };

// Schemes.
for (const [u, ok] of [['https://hub.example/mum/profile', true], ['http://hub.example/mum/profile', false], ['file:///etc/passwd', false], ['ftp://hub.example/mum/profile', false]]) assert.equal(urlVerdict(u), ok ? 'allowed' : 'bad_scheme', u);

// Addresses: every blocked range, every embedded form, the leading zero.
const blocked = ['0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.0.0.1', '192.0.2.1', '192.168.1.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255',
  '::', '::1', 'fe80::1', 'fc00::1', 'ff02::1', '100::1', '2001:db8::1', '2001:10::1', '2001:20::1', '2001::1',
  '::ffff:127.0.0.1', '::127.0.0.1', '::ffff:0:127.0.0.1', '64:ff9b::7f00:1', '64:ff9b:1::7f00:1', '2002:7f00:1::', '::ffff:169.254.169.254'];
for (const a of blocked) assert.equal(isPublicAddress(a), false, a);
for (const a of ['93.184.216.34', '2606:2800:220::1', '::ffff:93.184.216.34', '177.0.0.1']) assert.equal(isPublicAddress(a), true, a);
assert.deepEqual([parseIPv4('0177.0.0.1'), isPublicAddress('0177.0.0.1')], [null, false]);
console.log(`§9 — ${blocked.length} blocked addresses refused; 0177.0.0.1 is not an address\n`);

// The resolved address, before the socket; literals checked on the URL.
const answers = { 'innocent.example': ['127.0.0.1'], '0177.0.0.1': ['127.0.0.1'], 'mixed.example': ['127.0.0.1', '93.184.216.34'] };
let lookups = 0;
const resolve = (host, options, cb) => { lookups++; const a = answers[host]; return a ? cb(null, a.map((address) => ({ address, family: 4 }))) : cb(Object.assign(new Error(`ENOTFOUND ${host}`), { code: 'ENOTFOUND' })); };
const guarded = createFetcher({ resolve });
const code = async (u) => { try { await guarded.get(u); return 'connected'; } catch (e) { return e.code; } };
assert.deepEqual([await code('https://innocent.example/x'), await code('https://0177.0.0.1/x')], ['blocked_address', 'blocked_address']);
await new Promise((done) => guardedLookup(isPublicAddress, resolve)('mixed.example', {}, (err, addr) => { assert.deepEqual([err, addr], [null, '93.184.216.34']); done(); }));
const before = lookups;
assert.equal(await code('https://169.254.169.254/x'), 'blocked_address');
assert.equal(lookups, before);
console.log('  a name resolving to 127.0.0.1 is refused before connecting; a literal never reaches the resolver\n');

// Redirects and caps, against a loopback origin.
const saw = [];
const origin = http.createServer((req, res) => {
  saw.push(req.url);
  const to = { '/away': 'http://elsewhere.example/x', '/meta': 'http://169.254.169.254/x', '/gopher': 'gopher://elsewhere.example/x', '/loop': '/loop', '/one': '/final' }[req.url];
  if (to) { res.writeHead(302, { location: to }); res.end(); return; }
  res.writeHead(200, { etag: '"t"' }); res.end(req.url === '/big' ? Buffer.alloc(64 * 1024) : 'ok');
});
await new Promise((r) => origin.listen(0, '127.0.0.1', r));
const at = `http://127.0.0.1:${origin.address().port}`;
const local = createFetcher({ protocols: ['http:'], isAddressAllowed: isPublicOrLoopbackAddress, maxBytes: { profile: 1024, index: 1024, post: 1024, media: 1024 } });
const hop = async (path) => { try { return (await local.get(at + path)).bytes.toString(); } catch (e) { return e.code; } };
const links = [await hop('/one'), await hop('/away'), await hop('/meta'), await hop('/gopher')];
saw.length = 0;
links.push(await hop('/loop'));
assert.deepEqual(links, ['ok', 'cross_origin_redirect', 'blocked_address', 'bad_scheme', 'too_many_redirects']);
assert.equal(saw.length, MAX_REDIRECTS + 1);
assert.deepEqual([TIMEOUT_MS, MAX_REDIRECTS, MAX_SOCKETS_PER_ORIGIN, MAX_BYTES.profile, MAX_BYTES.index, MAX_BYTES.post, MAX_BYTES.media > MAX_BYTES.post, MAX_IDENTITIES_PER_PASS], [10_000, 5, 10, 1024 * 1024, 1024 * 1024, 1024 * 1024, true, 200]);
assert.equal(await hop('/big'), 'too_large');
origin.close();
console.log(`  redirects: same-origin followed, cross-origin / blocked address / other scheme refused, a loop stopped at ${MAX_REDIRECTS}; 64 KiB under a 1 KiB cap: too_large\n`);
rule('9', `Every rule here binds a reader's outbound requests; the rumor rule (§7.4) follows a URL a replier chose.

- HTTPS only, certificates validated.
- At most 5 redirects, never to a different origin; each redirect is re-checked for scheme and address.
- Refuse non-public addresses, checked on the resolved address before the socket connects, and on address
  literals in the URL. Blocked IPv4: \`0.0.0.0/8\`, \`10/8\`, \`100.64/10\`, \`127/8\`, \`169.254/16\`, \`172.16/12\`,
  \`192.0.0/24\`, \`192.0.2/24\`, \`192.168/16\`, \`198.18/15\`, \`198.51.100/24\`, \`203.0.113/24\`, \`224/4\`, \`240/4\`.
  Blocked IPv6: the unspecified address, loopback, link-local, unique-local, multicast \`ff00::/8\`, discard
  \`100::/64\`, documentation \`2001:db8::/32\`, ORCHID \`2001:10::/28\` and \`2001:20::/28\`, Teredo \`2001::/32\`,
  and every embedded-IPv4 form judged as the IPv4 address it carries: \`::ffff:a.b.c.d\`, \`::a.b.c.d\`,
  \`::ffff:0:a.b.c.d\`, \`64:ff9b::/96\`, \`64:ff9b:1::/48\`, \`2002::/16\`. A dotted quad with a leading zero MUST be
  refused.
- Bound everything: one timeout over connect, redirects and body (10 s RECOMMENDED); a body cap per fetch
  (1 MB RECOMMENDED for the profile, index and a post; larger for media); a cap on concurrent sockets per
  origin (10 RECOMMENDED); a cap on identities resolved per pass.`);

// A cap or a transport failure is no verdict.
const answered = await createReader({ get: async () => null }).read({ learned: 'x', at: 'https://hub.example/mum' });
assert.equal(answered.verdict, 'host');
for (const err of [new FetchError('over the cap', { code: 'too_large' }), new FetchError('timed out', { code: 'timeout', transient: true }), new FetchError('ENOTFOUND', { code: 'connect_failed', transient: true })]) {
  const thrown = await createReader({ get: async () => { throw err; } }).read({ learned: 'x', at: 'https://hub.example/mum' }).then(() => null, (e) => e);
  assert.ok(thrown instanceof FetchError && thrown.verdict === undefined);
}
console.log('  nothing served: host; a cap, a timeout, a failed lookup: thrown, no verdict\n');
rule('9', `A cap or a transport failure is no verdict: the read did not complete, and an app MUST NOT show it as a
state of the identity.`);
