// The reader as a command: `openfeed verify <anchor-key> <location> [--json]`. Takes argv and
// streams as arguments so the command is testable as a function; bin/openfeed.js is the shim.
import { createFetcher } from './fetch.js';
import { createReader } from './reader.js';
import { spokenCode } from './spoken.js';

export async function main(argv, { stdout, stderr, fetcher = createFetcher() } = {}) {
  const [cmd, learned, at, ...flags] = argv;
  if (cmd !== 'verify' || !learned || !at) {
    stderr.write('usage: openfeed verify <anchor-key> <location> [--json]\n\nThe key is the identity and MUST come from somewhere other than the hub (§3.1).\n');
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
    stdout.write(`ok — ${r.name ?? at}${r.note.length ? ` (${r.note.join('; ')})` : ''}\n${r.posts.size} post(s), ${r.media.size} media file(s); locations: ${r.locations.join(' ')}\nspoken code: ${spokenCode(learned).join(' ')}\n`);
  } else {
    stdout.write(`${r.verdict === 'tampered' ? 'this hub is misbehaving' : 'this identity is contested'} — ${r.why}\n`);
  }
  return r.verdict === 'ok' ? 0 : 1;
}
