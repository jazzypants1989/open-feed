// §9 — the rumor rule (§7.5) follows a URL a *replier* chose, so a reader's fetch layer sits in
// front of attacker-supplied addresses by design. Run: node examples/fetching/fetching.js
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { signingKeyFromSeed } from '../../src/file.js';
import { isPublicAddress, isPublicOrLoopbackAddress, parseIPv4 } from '../../src/addresses.js';
import { createFetcher, guardedLookup, FetchError, TIMEOUT_MS, MAX_REDIRECTS, MAX_SOCKETS_PER_ORIGIN, MAX_BYTES, MAX_IDENTITIES_PER_PASS } from '../../src/fetch.js';
import { createReader } from '../../src/reader.js';

const table = (rows) => { const w = (i) => Math.max(...rows.map((r) => r[i].length)) + 2; for (const r of rows) console.log(`  ${r[0].padEnd(w(0))}${r[1].padEnd(w(1))}${r[2]}`); };
// The default fetcher, asked only about a URL — `assertUrlAllowed` decides before a socket exists.
const consumer = createFetcher();
const urlVerdict = (u) => { try { consumer.assertUrlAllowed(u); return 'allowed'; } catch (e) { return e.code; } };

console.log('§9 — HTTPS only, because the address came from a stranger\n');
const schemes = [['https://hub.example/mum/profile', 'the one scheme §9 permits'], ['http://hub.example/mum/profile', 'plaintext, refused'], ['file:///etc/passwd', 'a local file is not a hub'], ['ftp://hub.example/mum/profile', 'and every other scheme with it']];
table(schemes.map(([u, why]) => [u, urlVerdict(u), why]));
for (const [u] of schemes) assert.equal(urlVerdict(u), u.startsWith('https:') ? 'allowed' : 'bad_scheme', u);

console.log('\n§9 — every range in the blocked table, judged on the address\n');
const blocked = [['0.0.0.0', '0.0.0.0/8 this network'], ['10.1.2.3', '10/8 private'], ['100.64.0.1', '100.64/10 CGNAT'], ['127.0.0.1', '127/8 loopback'], ['169.254.169.254', '169.254/16 link-local — where cloud metadata lives'], ['172.16.0.1', '172.16/12 private'], ['192.0.0.1', '192.0.0/24 IETF protocol assignments'], ['192.0.2.1', '192.0.2/24 TEST-NET-1'], ['192.168.1.1', '192.168/16 private'], ['198.18.0.1', '198.18/15 benchmarking'], ['198.51.100.1', '198.51.100/24 TEST-NET-2'], ['203.0.113.1', '203.0.113/24 TEST-NET-3'], ['224.0.0.1', '224/4 multicast'], ['255.255.255.255', '240/4 reserved'], ['93.184.216.34', 'an ordinary public address'], ['::', 'the unspecified address'], ['::1', 'loopback'], ['fe80::1', 'fe80::/10 link-local'], ['fc00::1', 'fc00::/7 unique local'], ['2606:2800:220::1', 'an ordinary public address']];
table(blocked.map(([a, why]) => [a, isPublicAddress(a) ? 'allowed' : 'refused', why]));
for (const [a, why] of blocked) assert.equal(isPublicAddress(a), why.startsWith('an ordinary'), a);

console.log('\n§9 — every embedded-IPv4 form is judged as the IPv4 address it carries\n');
const embedded = [['::ffff:127.0.0.1', false, 'IPv4-mapped'], ['::127.0.0.1', false, 'the deprecated IPv4-compatible form'], ['::ffff:0:127.0.0.1', false, 'IPv4-translated, RFC 2765'], ['64:ff9b::7f00:1', false, "NAT64's 64:ff9b::/96"], ['64:ff9b:1::7f00:1', false, "NAT64's 64:ff9b:1::/48"], ['2002:7f00:1::', false, "6to4's 2002::/16"], ['::ffff:169.254.169.254', false, 'the metadata address, wearing IPv6'], ['::ffff:93.184.216.34', true, 'the same unwrapping, allowing a public one']];
table(embedded.map(([a, , why]) => [a, isPublicAddress(a) ? 'allowed' : 'refused', why]));
for (const [a, ok] of embedded) assert.equal(isPublicAddress(a), ok, a);
console.log('\n  Each refused one reaches its IPv4 destination through an address a naive IPv6 check');
console.log('  waves past. Seven forms is the kind of list a second implementer gets wrong.');

console.log('\n§9 — a dotted quad with a leading zero is refused, not guessed at\n');
table([['0177.0.0.1', 'refused', '127.0.0.1 to some resolvers, 177.0.0.1 to others'], ['177.0.0.1', 'allowed', 'the same digits without the zero: an ordinary address']]);
console.log('\n  The disagreement is itself the bypass, so the parser declines to pick a side: it is not');
console.log('  an address at all (parseIPv4 → null), and what is not an address is not public.');
assert.equal(parseIPv4('0177.0.0.1'), null);
assert.equal(isPublicAddress('0177.0.0.1'), false);
assert.equal(isPublicAddress('177.0.0.1'), true);

console.log('\n§9 — the check is on the resolved address, and runs before the socket connects\n');
const answers = { 'innocent.example': ['127.0.0.1'], '0177.0.0.1': ['127.0.0.1'], 'mixed.example': ['127.0.0.1', '93.184.216.34'] };
let lookups = 0;
const resolve = (host, options, cb) => { lookups++; const a = answers[host]; return a ? cb(null, a.map((address) => ({ address, family: 4 }))) : cb(Object.assign(new Error(`ENOTFOUND ${host}`), { code: 'ENOTFOUND' })); };
const guarded = createFetcher({ resolve });
const code = async (u) => { try { await guarded.get(u); return 'connected'; } catch (e) { return e.code; } };
const dns = [['https://innocent.example/x', await code('https://innocent.example/x'), 'a name whose zone the attacker owns, answering 127.0.0.1'], ['https://0177.0.0.1/x', await code('https://0177.0.0.1/x'), 'not a literal to `net.isIP`; the resolver read it as octal']];
// The guard filters the answer, not the name: a mixed answer keeps only what may be reached.
await new Promise((done) => guardedLookup(isPublicAddress, resolve)('mixed.example', {}, (err, addr) => { assert.equal(err, null); dns.push(['https://mixed.example/x', 'filtered', `answered 127.0.0.1 and 93.184.216.34; connects to ${addr}`]); done(); }));
const before = lookups;
dns.push(['https://169.254.169.254/x', await code('https://169.254.169.254/x'), 'checked on the URL, because a literal never reaches the resolver']);
table(dns);
assert.deepEqual(dns.map((r) => r[1]), ['blocked_address', 'blocked_address', 'filtered', 'blocked_address']);
assert.equal(lookups, before, 'no resolution was attempted for the literal');
console.log('\n  Checking after connecting would leave a rebinding window. The name is resolved once, the');
console.log('  survivors are checked, and the socket goes to exactly the address that was checked.');

// A loopback origin, so the redirect and cap rules are exercised rather than described. No DNS.
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

console.log('\n§9 — at most 5 redirects, and never to a different origin\n');
const links = [['302 → /final', await hop('/one'), 'a same-origin redirect is followed'], ['302 → elsewhere.example', await hop('/away'), 'a redirect is never identity equivalence'], ['302 → 169.254.169.254', await hop('/meta'), 'every link re-checked for address, not just the first'], ['302 → gopher:', await hop('/gopher'), 'and for scheme']];
saw.length = 0;
links.push(['302 → itself, forever', await hop('/loop'), `stopped at ${MAX_REDIRECTS}; the origin saw ${saw.length} requests`]);
table(links);
assert.deepEqual(links.map((r) => r[1]), ['ok', 'cross_origin_redirect', 'blocked_address', 'bad_scheme', 'too_many_redirects']);
assert.equal(saw.length, MAX_REDIRECTS + 1);
console.log('\n  Moving is expressed in the profile (§3.7), not in a `Location` header.');

console.log('\n§9 — bound everything\n');
table([['timeout', `${TIMEOUT_MS} ms`, 'connect, redirects and body read under one deadline'], ['redirects', String(MAX_REDIRECTS), 'per fetch'], ['sockets per origin', String(MAX_SOCKETS_PER_ORIGIN), 'concurrent'], ['body cap', String(MAX_BYTES.profile), 'bytes for the profile, the index and a post'], ['body cap (media)', String(MAX_BYTES.media), 'bytes — larger, and still a cap'], ['identities per pass', String(MAX_IDENTITIES_PER_PASS), 'how many one pass will resolve'], ['64 KiB under a 1 KiB cap', await hop('/big'), 'the transfer is destroyed, not buffered']]);
assert.deepEqual([TIMEOUT_MS, MAX_REDIRECTS, MAX_SOCKETS_PER_ORIGIN, MAX_BYTES.profile, MAX_BYTES.media, MAX_IDENTITIES_PER_PASS], [10_000, 5, 10, 1024 * 1024, 50 * 1024 * 1024, 200]);
assert.equal(await hop('/big'), 'too_large');
origin.close();

console.log('\n§9 — a cap is no verdict, not an accusation\n');
const answered = await createReader({ get: async () => null }).read({ learned: 'x', at: 'https://hub.example/mum' });
const outcomes = [['answered, and wrongly', `verdict: ${answered.verdict}`, `"${answered.why}" — evidence about a hub`]];
assert.equal(answered.verdict, 'host');
for (const [what, err] of [['a body over the cap', new FetchError('over the cap', { code: 'too_large' })], ['a timeout', new FetchError('timed out', { code: 'timeout', transient: true })], ['a name that does not resolve', new FetchError('ENOTFOUND', { code: 'connect_failed', transient: true })]]) {
  const thrown = await createReader({ get: async () => { throw err; } }).read({ learned: 'x', at: 'https://hub.example/mum' }).then(() => null, (e) => e);
  outcomes.push([what, thrown.code, `no verdict${thrown.transient ? ' — retry before reporting host' : ''}`]);
  assert.ok(thrown instanceof FetchError && thrown.verdict === undefined);
}
table(outcomes);
console.log('\n  §7.3 has three verdicts and this is not a fourth — it is the absence of one. The read did');
console.log('  not complete and the publisher may have done nothing, so an app says "could not check",');
console.log('  never a state of the identity. Only an answer that is wrong is evidence about a hub.');

console.log('\n§7.5 — following a reply’s `loc` is both the feature and the beacon\n');
const mum = signingKeyFromSeed(crypto.createHash('sha256').update('openfeed/v1/example:fetching/mum').digest()).x;
const held = ['https://pence.family/mum', 'https://mum.example/mum'];
const tried = [];
const rumors = createReader({ get: async (u) => { tried.push(u); throw new FetchError('unreachable', { code: 'connect_failed', transient: true }); } });
const pin = { live: new Map(), withdrawn: new Map(), top: 4, locations: held };
const reply = (n) => [n, { n, target: { key: mum, n: 9, hash: 'a hash this reader has never seen', loc: 'https://dad-chose.example/mum' } }];
const lines = await rumors.rumors(new Map([[mum, pin]]), new Map([reply(1), reply(2)]), 'dad');
table([...tried.map((u, i) => [u, i < held.length ? ['first', 'then'][i] : 'last', i < held.length ? 'a location this reader already holds' : 'the address in dad’s reply']),['two replies, one target', `${tried.length} fetches`, 'look again at most once per identity per pass'], ['and said', `${lines.length} line`, `"${lines[0]}" — one line per person`]]);
assert.deepEqual(tried, [...held.map((l) => `${l}/profile`), 'https://dad-chose.example/mum/profile']);
assert.deepEqual(lines, ['dad replied to something I cannot see']);
console.log('\n  Trying it at all tells whoever wrote that reply the address and the moment of every reader');
console.log('  that holds a pin for the name they targeted. §9’s caps bound what that costs; they do');
console.log('  not make it private. The spec names the price rather than hiding it.\n');

console.log('Every line above is asserted.');
