// audience-gate: whether the reply to a sealed post can be sealed at all. §7.5 puts the audience
// inside "so a recipient learns who else can answer", as a list of reading keys; §4.8 says a
// publisher MUST seal only to a `read` key taken from a profile it verified. A replier who knows
// a member only from the envelope holds an X25519 key and nothing that leads to a profile.
// Findings A6 and A9 (the 2-byte length) of the 2026-08-23 review.
// Kill criteria: the replier able to reach the third member's profile from what §7.5 gives it; a
// sealed body above 65,535 bytes accepted by the reference envelope.
import crypto from 'node:crypto';
import { read } from './weekend-reader.js';
import * as pub from './weekend-publisher.js';
import { seal, open, xKey, carrierOf } from './envelope.js';
import { Hub, io } from './hub.js';

const claims = [];
const claim = (what, ok) => { claims.push([what, ok]); console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`); };

// Three people on two hubs. Jesse has read Mom; he has never read Sis, who lives on Mom's hub.
const person = (name) => ({ name, key: pub.newKey(), read: xKey(name) });
const mom = person('mom'), jesse = person('jesse'), sis = person('sis');
const REC = pub.commit(1, [{ key: pub.newKey(), salt: 's' }]);
const M = await new Hub().listen(), J = await new Hub().listen();
const at = { mom: `${M.url}/mom`, sis: `${M.url}/sis`, jesse: `${J.url}/jesse` };
const get = async (p) => { const r = await fetch(p); return r.status === 200 ? Buffer.from(await r.arrayBuffer()) : null; };
const claimName = async (hub, p, loc) => { const net = io(hub); await net.put(`/${p.name}/profile`, pub.profile({ genesis: p.key.x, pseq: 1, chain: [{ key: p.key.x }], recovery: REC, locations: [loc], read: p.read.x }, p.key), null); await pub.amendHead(net, `/${p.name}`, p.key, (h) => h); };
await claimName(M, mom, at.mom); await claimName(M, sis, at.sis); await claimName(J, jesse, at.jesse);
const momRead = await read(get, { learned: mom.key.x, at: at.mom });
const pins = new Map([[mom.key.x, momRead]]);                         // what Jesse holds: Mom, verified

console.log('\n1. Mom seals to Jesse and Sis, as §7.5 says: the audience is their reading keys.\n');
const audience = [mom.read.x, jesse.read.x, sis.read.x];
const env = seal({ content: { text: 'family only' }, audience, carrier: carrierOf(mom.key.x, 1) });
const inner = open(env, jesse.read.privateKey, carrierOf(mom.key.x, 1));
claim(`Jesse opens it and learns the audience: ${inner.audience.length} reading keys`, inner.audience.length === 3);
const known = inner.audience.map((x) => [...pins.values()].find((p) => p.read === x)?.chain ? 'a profile he verified' : x === jesse.read.x ? 'himself' : 'an X25519 key and nothing else');
claim(`what each key is to him: ${known.join(' · ')}`, known[2] === 'an X25519 key and nothing else');
claim('nothing he holds maps a reading key to a genesis or a location — §4.7 carries locations on public replies only', !Object.values(at).some((loc) => loc.includes(sis.read.x)) && !JSON.stringify([...pins]).includes(sis.read.x));

console.log('\n2. His reply, under §4.8 as written: seal only to keys from profiles he verified.\n');
const lawful = inner.audience.filter((x) => x === jesse.read.x || [...pins.values()].some((p) => p.read === x));
const reply = seal({ content: { rel: 'reply', target: { key: mom.key.x, n: 1 }, text: 'so glad' }, audience: lawful, carrier: carrierOf(jesse.key.x, 1) });
claim(`he seals to ${lawful.length} of 3; Sis opens his reply: ${open(reply, sis.read.privateKey, carrierOf(jesse.key.x, 1)) === null ? 'nothing — the thread split in half with no error anywhere' : 'yes'}`, lawful.length === 2 && open(reply, sis.read.privateKey, carrierOf(jesse.key.x, 1)) === null);
const unlawful = seal({ content: { text: 'so glad' }, audience: inner.audience, carrier: carrierOf(jesse.key.x, 2) });
claim('sealing to the audience as received works cryptographically — it is the rule that forbids it, not the envelope', open(unlawful, sis.read.privateKey, carrierOf(jesse.key.x, 2))?.text === 'so glad');

console.log('\n3. The repair: audience entries name the person — {key, read, at} — like §6.4\'s target.\n');
const audience2 = [mom, jesse, sis].map((p) => ({ key: p.key.x, read: p.read.x, at: at[p.name] }));
const env2 = seal({ content: { text: 'family only' }, audience: audience2, carrier: carrierOf(mom.key.x, 2) });
const inner2 = open(env2, jesse.read.privateKey, carrierOf(mom.key.x, 2));
const unknown = inner2.audience.filter((a) => !pins.has(a.key) && a.key !== jesse.key.x);
const sisRead = await read(get, { learned: unknown[0].key, at: unknown[0].at });
claim(`the third entry leads to a profile: read ${unknown[0].at.replace(M.url, "<mom's hub>")} with genesis from the envelope → ${sisRead.verdict}`, sisRead.verdict === 'ok');
claim('the verified profile\'s read key is the one in the audience — so he seals to a key from a profile he verified, per §4.8', sisRead.read === unknown[0].read);
const reply2 = seal({ content: { text: 'so glad' }, audience: [mom.read.x, jesse.read.x, sisRead.read], carrier: carrierOf(jesse.key.x, 3) });
claim('Sis opens his reply', open(reply2, sis.read.privateKey, carrierOf(jesse.key.x, 3))?.text === 'so glad');
// What a host-substituted audience entry costs: the entry is inside a post Mom signed and sealed,
// so a reader that verified Mom's post is reading Mom's word, not the host's. The genesis check
// at §4.1 then makes a wrong `at` a refusal, not a substitution.
const wrongHub = await read(get, { learned: unknown[0].key, at: at.mom });
claim(`an entry whose location serves someone else's profile is refused by the genesis check: ${wrongHub.verdict}`, wrongHub.verdict === 'identity');
console.log(`        bytes: the three-key audience seals to ${env.ct.length} chars of ct, the three-entry one to ${env2.ct.length}`);

console.log('\n4. A9: the 2-byte length prefix.\n');
let big = 'threw nothing';
try { seal({ content: { text: 'x'.repeat(70000) }, audience, carrier: 'c' }); } catch (e) { big = e.constructor.name; }
claim(`a 70,000-byte sealed text: the reference envelope ${big} — the spec states no maximum`, big === 'RangeError');
let max = 'threw'; try { seal({ content: { text: 'x'.repeat(65535 - 2 - JSON.stringify({ audience, text: '' }).length) }, audience, carrier: 'c' }); max = 'sealed'; } catch { /* */ }
claim('65,535 bytes of plaintext, audience included, is the ceiling as built', max === 'sealed');
M.close(); J.close();

const failed = claims.filter(([, ok]) => !ok);
console.log(failed.length ? `\n${failed.length} claim(s) did not hold` : `\nall ${claims.length} claims hold`);
process.exit(failed.length ? 1 : 0);
