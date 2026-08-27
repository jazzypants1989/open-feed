// The reader and the hub as one command. `main` takes argv and its streams as arguments so every
// verb is testable as a function; `bin/openfeed.js` is the shim that supplies the real ones.
//
//   openfeed verify <anchor-key> <location> [--json]
//   openfeed hub [--port N] [--host H] [--data DIR] [--origin ORIGIN]
import { createFetcher } from './fetch.js';
import { createHub, fileStore, listen } from './hub.js';
import { createReader } from './reader.js';
import { spokenCode } from './spoken.js';

const USAGE = `usage: openfeed verify <anchor-key> <location> [--json]
       openfeed hub [--port N] [--host H] [--data DIR] [--origin ORIGIN]

The key is the identity and MUST come from somewhere other than the hub (§3.1).
`;

const flag = (flags, name, fallback = null) => { const i = flags.indexOf(`--${name}`); return i < 0 || i + 1 >= flags.length ? fallback : flags[i + 1]; };

export async function main(argv, { stdout, stderr, fetcher = createFetcher(), serve = listen } = {}) {
  const [cmd, ...rest] = argv;
  if (cmd === 'hub') return serveHub(rest, { stdout, stderr, serve });

  const [learned, at, ...flags] = rest;
  if (cmd !== 'verify' || !learned || !at) { stderr.write(USAGE); return 2; }
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

/** §8 as a process: the pure handler behind a socket, over a store that may outlive it. */
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
