// The reader as a command: `openfeed2 verify <genesis-key> <location> [--json]`. Takes argv and
// streams as arguments so the command is testable as a function; bin/openfeed2.js is the shim.
import { createFetcher } from './fetch.js';
import { createReader } from './reader.js';
import { spokenCode } from './spoken.js';

export async function main(argv, { stdout, stderr, fetcher = createFetcher() } = {}) {
  const [cmd, learned, at, ...flags] = argv;
  if (cmd !== 'verify' || !learned || !at) {
    stderr.write('usage: openfeed2 verify <genesis-key> <location> [--json]\n\nThe key is the identity and MUST come from somewhere other than the host (§4.1).\n');
    return 2;
  }
  let r;
  try {
    r = await createReader({ get: (u) => fetcher.get(u) }).read({ learned, at });
  } catch (e) {
    stderr.write(`no verdict — the read did not complete: ${e.message}\n`);
    return 3;
  }
  if (flags.includes('--json')) {
    stdout.write(`${JSON.stringify({ verdict: r.verdict, why: r.why, note: r.note, posts: r.posts ? [...r.posts.keys()] : undefined, name: r.name, locations: r.locations, spoken: r.verdict === 'ok' ? spokenCode(learned).join(' ') : undefined })}\n`);
  } else if (r.verdict === 'ok') {
    stdout.write(`ok — ${r.name ?? at}${r.note.length ? ` (${r.note.join('; ')})` : ''}\n${r.posts.size} post(s), ${r.media.size} photo(s); locations: ${r.locations.join(' ')}\nspoken code: ${spokenCode(learned).join(' ')}\n`);
  } else {
    stdout.write(`${r.verdict === 'host' ? 'this host is misbehaving' : 'this identity is in question'} — ${r.why}\n`);
  }
  return r.verdict === 'ok' ? 0 : 1;
}
