// Brief F option 2 — glm's dead-drop box, as actual HTTP over a real socket.
// Grandma's hub is an ordinary hub. Her "box" is one directory on it that accepts writes.
// Alice's hub (the ex's) is never contacted, and the run prints its access log to prove it.
import http from 'node:http';
import crypto from 'node:crypto';
import { seal, open } from '../../../src/enc.js';

// ---------------------------------------------------------------- the two people
const person = (name) => {
  const s = crypto.generateKeyPairSync('x25519');
  return { name, url: `https://${name}.example/me`, priv: s.privateKey,
    doc: { url: `https://${name}.example/me`,
           keys: [{ kty: 'OKP', crv: 'X25519', use: 'enc', kid: name, iat: 1, x: s.publicKey.export({ format: 'jwk' }).x }] } };
};
const alice = person('alice'), grandma = person('grandma');

// Grandma's profile names her box. Default: a path on her OWN hub. Nothing else is required.
grandma.doc.box = '/box/T0KEN-she-gave-alice';   // one token per contact, so writes are attributable

// ---------------------------------------------------------------- the ex's hub (never touched)
const exLog = [];
const exHub = http.createServer((req, res) => { exLog.push(`${req.method} ${req.url}`); res.end(); });

// ---------------------------------------------------------------- Grandma's hub: ~25 lines
const CAP = 64 * 1024;                            // size cap: a box is for envelopes, not uploads
const store = new Map();                          // path -> {bytes, at}
const rate = new Map();                           // ip -> count in this window
const boxes = new Set(['/box/T0KEN-she-gave-alice']);   // tokens Grandma has issued

const grandmaHub = http.createServer((req, res) => {
  const m = req.url.match(/^(\/box\/[A-Za-z0-9-]+)\/([A-Za-z0-9_-]{16,})$/);
  if (req.method === 'PUT') {
    if (!m || !boxes.has(m[1])) return res.writeHead(403).end('no such box');     // unknown token
    const ip = req.socket.remoteAddress;
    if ((rate.get(ip) ?? 0) >= 20) return res.writeHead(429).end('slow down');    // per-IP ladder
    rate.set(ip, (rate.get(ip) ?? 0) + 1);
    const chunks = [];
    let n = 0;
    req.on('data', (c) => { n += c.length; if (n > CAP) req.destroy(); chunks.push(c); });
    req.on('end', () => { store.set(req.url, { bytes: Buffer.concat(chunks), at: Date.now() }); res.writeHead(201).end(); });
    return;
  }
  if (req.method === 'GET' && /^\/box\/[A-Za-z0-9-]+\/$/.test(req.url)) {          // Grandma lists her box
    if (req.headers.authorization !== 'Bearer grandma-owns-this') return res.writeHead(401).end();
    return res.end(JSON.stringify([...store.keys()].filter((k) => k.startsWith(req.url))));
  }
  if (req.method === 'GET' && store.has(req.url)) return res.end(store.get(req.url).bytes);
  res.writeHead(404).end();
});

// ---------------------------------------------------------------- run it
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));
const [exPort, gPort] = [await listen(exHub), await listen(grandmaHub)];
const GHUB = `http://127.0.0.1:${gPort}`;
const wire = [];
const call = async (method, url, body, headers = {}) => {
  const r = await fetch(url, { method, body, headers });
  wire.push(`${method} ${url.replace(GHUB, 'https://grandma.example')} -> ${r.status}`);
  return r;
};

console.log('\nBrief F.2 — the dead-drop, over real HTTP\n');

// 1. Alice seals "I'm leaving" to Grandma, exactly as she'd seal any one-recipient item.
const item = { id: 'urn:uuid:9f2c', authors: [{ url: alice.url }] };
const envelope = { ...item, _openfeed: { enc: seal({ item, content: { body: 'I am leaving him on Tuesday. Do not reply here.' }, recipients: [grandma.doc] }) } };
const bytes = Buffer.from(JSON.stringify(envelope));

// 2. She PUTs it to a filename SHE picks at random, in the box Grandma named.
const token = crypto.randomBytes(12).toString('base64url');
await call('PUT', `${GHUB}${grandma.doc.box}/${token}`, bytes);

// 3. A stranger who was never given a token tries the same thing.
await call('PUT', `${GHUB}/box/GUESSED/${crypto.randomBytes(12).toString('base64url')}`, bytes);

// 4. Grandma's app polls her own box on its ordinary cadence and reads what is there.
const listing = await (await call('GET', `${GHUB}${grandma.doc.box}/`, null, { authorization: 'Bearer grandma-owns-this' })).json();
const fetched = JSON.parse(await (await call('GET', `${GHUB}${listing[0]}`)).text());
const plaintext = open(fetched, { privateKeys: [grandma.priv] });

console.log('  the wire, in order:');
for (const w of wire) console.log('    ' + w);
console.log(`\n  Grandma reads: "${plaintext.body}"`);
console.log(`  the ex's hub access log: ${exLog.length === 0 ? '[empty] — he was never in the path' : exLog.join(', ')}`);
console.log(`  envelope on the wire: ${bytes.length} bytes of ciphertext with no plaintext recipient`);
console.log(`  Grandma's hub code above: ${25} lines, and it never verifies a signature or parses JSON`);

console.log(`
  What the box actually is: a directory on the hub Grandma ALREADY has, that accepts a PUT of a
  small file at a path she handed out. It is not a website, not an inbox, not an account. The hub
  stores bytes it cannot read and serves them back to her.

  Who runs what:  Alice needs nothing but her device. Grandma needs one writable directory on the
  hub she already uses. GOALS.md:64 already commits her hub to accepting authenticated writes from
  her own clients — this asks it to also accept a capped, rate-limited, token-gated write from a
  contact. That is an increment on a decision already taken, not a new piece of infrastructure.

  Why the ex is absent: the message goes from Alice's DEVICE to GRANDMA's hub. It never touches
  Alice's hub, which is the only thing he controls. Compare option 1 (GOALS.md as written), where
  the same message is a file on HIS disk that he declines to serve.

  The "separate host" clause is an OPTION for one narrower case: if Grandma is also on the ex's
  hub, her box is on his disk and he sees envelopes arriving. Then she may point her box elsewhere.
  Nobody needs that in the divorce scenario, and it should not be how the mechanism is introduced.
`);
[exHub, grandmaHub].forEach((s) => s.close());
