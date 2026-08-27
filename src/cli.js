// The reader, the publisher and the hub as one command. `main` takes argv and its streams as
// arguments so every verb is testable as a function; `bin/openfeed.js` is the shim that supplies the
// real ones. Every socket it opens is `fetch.js`'s, including the publisher's writes.
//
//   openfeed key    --out <file>
//   openfeed claim  --key <file> --at <location> [--name <name>]
//   openfeed post   --key <file> --at <location> --text <text> [--time <iso8601>]
//   openfeed views  --key <file> --at <location>
//   openfeed verify <anchor-key> <location> [--json]
//   openfeed hub    [--port N] [--host H] [--data DIR] [--origin ORIGIN]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readingKeyFromSeed } from './envelope.js';
import { createFetcher } from './fetch.js';
import { parseBody, signingKeyFromSeed, splitFile } from './file.js';
import { createHub, fileStore, listen } from './hub.js';
import { createPublisher } from './publish.js';
import { createReader } from './reader.js';
import { spokenCode } from './spoken.js';
import { atom, hcard, jsonFeed } from './views.js';

const USAGE = `usage: openfeed key    --out <file>
       openfeed claim  --key <file> --at <location> [--name <name>]
       openfeed post   --key <file> --at <location> --text <text> [--time <iso8601>]
       openfeed views  --key <file> --at <location>
       openfeed verify <anchor-key> <location> [--json]
       openfeed hub    [--port N] [--host H] [--data DIR] [--origin ORIGIN]

The key is the identity and MUST come from somewhere other than the hub (§3.1).
`;

const flag = (flags, name, fallback = null) => { const i = flags.indexOf(`--${name}`); return i < 0 || i + 1 >= flags.length ? fallback : flags[i + 1]; };
const KEY_MODE = 0o600;
/** §8.9's directory: the bytes this publisher kept. It is also the export and what a move re-uploads. */
const copyDirOf = (keyfile) => `${keyfile.replace(/\.json$/, '')}.copy`;

export async function main(argv, { stdout, stderr, fetcher = createFetcher(), serve = listen } = {}) {
  const [cmd, ...rest] = argv;
  const io = { stdout, stderr, fetcher };
  if (cmd === 'key') return makeKey(rest, io);
  if (cmd === 'claim') return claimName(rest, io);
  if (cmd === 'post') return publishPost(rest, io);
  if (cmd === 'views') return writeViews(rest, io);
  if (cmd === 'hub') return serveHub(rest, { stdout, stderr, serve });
  if (cmd !== 'verify') { stderr.write(USAGE); return 2; }
  return verify(rest, io);
}

// ---- §3: the keyfile ----

/** Two 32-byte seeds at 0600. This file is the identity; nothing anywhere else can reissue it. */
function loadKeyfile(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { key: signingKeyFromSeed(Buffer.from(j.seed, 'base64')), read: readingKeyFromSeed(Buffer.from(j.readSeed, 'base64')) };
}

function makeKey(flags, { stdout, stderr }) {
  const out = flag(flags, 'out');
  if (!out) { stderr.write('openfeed key --out <file>\n'); return 2; }
  if (fs.existsSync(out)) { stderr.write(`${out} exists — refusing to overwrite an identity\n`); return 2; }
  const seed = crypto.randomBytes(32), readSeed = crypto.randomBytes(32);
  const key = signingKeyFromSeed(seed), read = readingKeyFromSeed(readSeed);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify({ anchor: key.x, read: read.x, seed: seed.toString('base64'), readSeed: readSeed.toString('base64') }, null, 1)}\n`, { mode: KEY_MODE });
  fs.chmodSync(out, KEY_MODE);                                   // owner only, even if the file existed
  stdout.write(`${out}  (0600)\nanchor key   ${key.x}\nreading key  ${read.x}\nspoken code  ${spokenCode(key.x).join(' ')}\n\n`);
  // Said at the one moment it can still be acted on. §3.3 is the reason the second line is not a SHOULD here.
  stdout.write('This file is the identity. Back it up somewhere only you reach.\n');
  stdout.write('The recovery list is empty, so a lost key is a lost identity (§3.3). Widening it is a\nrotation, and §3.3 asks for a backup key of your own beside at least three other members.\n');
  return 0;
}

/** A publisher whose `keep` is §8.9's directory, resuming from the index it last wrote (§3.5). */
function publisherFor(keyfile, at, fetcher) {
  const { key, read } = loadKeyfile(keyfile);
  const dir = copyDirOf(keyfile);
  const keep = (p, bytes) => { const f = path.join(dir, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, bytes); };
  let last = null, highest = 0;
  try { last = fs.readFileSync(path.join(dir, 'index')); highest = parseBody(splitFile(last).body).highest; } catch { /* nothing kept yet */ }
  return { pub: createPublisher({ io: fetcher, key, at, keep, last }), key, read, dir, highest };
}

// ---- §8: publishing ----

async function claimName(flags, { stdout, stderr, fetcher }) {
  const keyfile = flag(flags, 'key'), at = flag(flags, 'at');
  if (!keyfile || !at) { stderr.write('openfeed claim --key <file> --at <location>\n'); return 2; }
  const { pub, key, read, dir } = publisherFor(keyfile, at, fetcher);
  const name = flag(flags, 'name') ?? new URL(at).pathname.replace(/^\//, '');
  try {
    await pub.claim({ anchor: key.x, version: 1, name, chain: [{ key: key.x }], recovery: { leaves: [] }, locations: [at], read: read.x });
  } catch (e) { stderr.write(`claim failed: ${e.message}\n`); return 3; }
  stdout.write(`claimed ${at} as "${name}"; your copy is ${dir}\n`);
  // §3.7: the address is not the identity, and a hub that introduces what it also serves introduces itself.
  stdout.write(`hand somebody the key, never just the address:\n  ${at}#${key.x}\nor read them the six words:\n  ${spokenCode(key.x).join(' ')}\n`);
  return 0;
}

async function publishPost(flags, { stdout, stderr, fetcher }) {
  const keyfile = flag(flags, 'key'), at = flag(flags, 'at'), text = flag(flags, 'text');
  if (!keyfile || !at || !text) { stderr.write('openfeed post --key <file> --at <location> --text <text>\n'); return 2; }
  const { pub, highest } = publisherFor(keyfile, at, fetcher);
  const time = flag(flags, 'time') ?? `${new Date().toISOString().slice(0, 19)}Z`;
  try {
    const number = await pub.publish(highest + 1, { at: time, text });   // §8.3: the post, then the index
    stdout.write(`${at}/posts/${number}\n`);
  } catch (e) { stderr.write(`post failed: ${e.message}\n`); return 3; }
  return 0;
}

/** §10: unsigned, regenerable, and not kept — a view is never evidence and never the index. */
async function writeViews(flags, { stdout, stderr, fetcher }) {
  const keyfile = flag(flags, 'key'), at = flag(flags, 'at');
  if (!keyfile || !at) { stderr.write('openfeed views --key <file> --at <location>\n'); return 2; }
  const { pub, key } = publisherFor(keyfile, at, fetcher);
  let r;
  try { r = await createReader({ get: (u) => fetcher.get(u) }).read({ learned: key.x, at }); } catch (e) { stderr.write(`no verdict — the read did not complete: ${e.message}\n`); return 3; }
  if (r.verdict !== 'ok') { stderr.write(`refusing to write views over a ${r.verdict} read — ${r.why}\n`); return 1; }
  try {
    await pub.putView('feed.json', jsonFeed(r, at), 'application/feed+json');
    await pub.putView('feed.xml', atom(r, at), 'application/atom+xml');
    await pub.putView('index.html', hcard(r, at), 'text/html');
  } catch (e) { stderr.write(`views failed: ${e.message}\n`); return 3; }
  stdout.write(`feed.json, feed.xml, index.html — unsigned, and no reader may treat one as evidence (§10)\n`);
  return 0;
}

// ---- §7: reading ----

async function verify(rest, { stdout, stderr, fetcher }) {
  const [learned, at, ...flags] = rest;
  if (!learned || !at) { stderr.write(USAGE); return 2; }
  let r;
  try {
    r = await createReader({ get: (u) => fetcher.get(u) }).read({ learned, at });
  } catch (e) {
    stderr.write(`no verdict — the read did not complete: ${e.message}\n`);
    return 3;
  }
  if (flags.includes('--json')) {
    stdout.write(`${JSON.stringify({ verdict: r.verdict, why: r.why, note: r.note, posts: r.posts ? [...r.posts.keys()] : undefined, name: r.name, locations: r.locations, restoredBy: r.chain?.restoredBy ?? undefined, spoken: r.verdict === 'ok' ? spokenCode(learned).join(' ') : undefined })}\n`);
  } else if (r.verdict === 'ok') {
    stdout.write(`ok — ${r.name ?? at}${r.note.length ? ` (${r.note.join('; ')})` : ''}\n${r.posts.size} post(s), ${r.media.size} media file(s); locations: ${r.locations.join(' ')}\nspoken code: ${spokenCode(learned).join(' ')}\n`);
    // §3.3: who vouched is in the link, and it is the only thing separating a rescue from a takeover.
    if (r.chain.restoredBy?.length) stdout.write(`restored by ${r.chain.restoredBy.length}: ${r.chain.restoredBy.map((k) => spokenCode(k).join(' ')).join(' / ')}\n`);
  } else {
    stdout.write(`${r.verdict === 'tampered' ? 'this hub is misbehaving' : 'this identity is contested'} — ${r.why}\n`);
  }
  return r.verdict === 'ok' ? 0 : 1;
}

// ---- §8, the other side: the hub as a process ----

async function serveHub(flags, { stdout, stderr, serve }) {
  const dir = flag(flags, 'data'), origin = flag(flags, 'origin');
  const port = Number(flag(flags, 'port', '4567')), host = flag(flags, 'host', '127.0.0.1');
  if (!Number.isInteger(port) || port < 0 || port > 65535) { stderr.write(`not a port: ${flag(flags, 'port')}\n`); return 2; }
  const hub = createHub({ store: dir ? fileStore(dir) : new Map(), origin });
  const srv = await serve(hub, { port, host });
  stdout.write(`hub on ${srv.url}${origin ? ` serving ${origin}` : ''} — ${hub.store.size} file(s) ${dir ? `in ${dir}` : 'in memory, and nothing here survives a restart'}\n`);
  // Worth saying at every start: this process is storage. Losing it loses files, not anybody's identity.
  stdout.write('It holds no key. It stores signed files and decides nothing about who anyone is (§8).\n');
  return 0;
}
