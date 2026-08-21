// Decisions 3+4 together — sequential names, pretty aliases, and how small the index can be.
import crypto from 'node:crypto';

const alice = crypto.generateKeyPairSync('ed25519');
const oldStolen = crypto.generateKeyPairSync('ed25519');   // a key of Alice's, stolen last year
const sign = (obj, k = alice) => { const b = Buffer.from(JSON.stringify(obj)); return { bytes: b, stamp: crypto.sign(null, b, k.privateKey).toString('base64url') }; };
const stampOk = (f, k) => { try { return crypto.verify(null, f.bytes, k.publicKey, Buffer.from(f.stamp, 'base64url')); } catch { return false; } };
const fingerprint = (f) => crypto.createHash('sha256').update(f.bytes).digest('hex').slice(0, 12);

// Every post declares its own number inside the stamped bytes. That one habit is load-bearing below.
const makePost = (n, body, k = alice) => ({ n, ...sign({ n, body }, k) });
const posts = new Map([1, 2, 3, 4, 5, 6, 7].map((n) => [n, makePost(n, `post number ${n}`)]));

// --- three shapes of index, all stamped by Alice ---
const indexes = {
  'tiny counter':        (top, withdrawn, seq) => sign({ seq, top, withdrawn, prev: 'abc123' }),
  'full list of names':  (top, withdrawn, seq) => sign({ seq, names: [...posts.keys()].filter((n) => n <= top && !withdrawn.includes(n)), withdrawn }),
  'names + fingerprints':(top, withdrawn, seq) => sign({ seq, entries: [...posts.entries()].filter(([n]) => n <= top && !withdrawn.includes(n)).map(([n, p]) => [n, fingerprint(p)]), withdrawn }),
};

// --- what a reader does with each shape ---
function readerVerdict(shape, index, served) {
  const body = JSON.parse(index.bytes.toString());
  const complaints = [];
  if (!stampOk(index, alice)) return ['index is not stamped by Alice'];
  if (body.seq < PINNED) complaints.push(`index went backwards: ${body.seq} after ${PINNED}`);

  // withholding: is anything missing that should be there?
  const expected = shape === 'tiny counter'
    ? Array.from({ length: body.top }, (_, i) => i + 1).filter((n) => !body.withdrawn.includes(n))
    : (body.names ?? body.entries.map(([n]) => n));
  for (const n of expected) if (!served.has(n)) complaints.push(`#${n} is missing and was never withdrawn`);

  for (const [n, file] of served) {
    // Both keys are in Alice's published history, so BOTH stamps check out. The stolen one is not
    // detectable as a forgery — that is the whole difficulty of this row.
    if (![alice, oldStolen].some((k) => stampOk(file, k))) { complaints.push(`#${n} carries no stamp of Alice's`); continue; }
    const declared = JSON.parse(file.bytes.toString()).n;              // the post says which number it is
    if (declared !== n) complaints.push(`asked for #${n}, got #${declared}`);
    const top = body.top ?? Math.max(...expected);
    if (n > top) complaints.push(`#${n} is above the highest number Alice declared`);
    if (body.entries) {
      const listed = body.entries.find(([m]) => m === n);
      if (listed && listed[1] !== fingerprint(file)) complaints.push(`#${n} is not the bytes Alice listed`);
    }
  }
  return complaints;
}

// --- five things a hostile host might do ---
const PINNED = 12;                       // the sequence number this reader saw last time
const events = {
  'behaves':                     () => ({ served: new Map(posts), top: 7, seq: 12 }),
  'drops #4 quietly':            () => { const s = new Map(posts); s.delete(4); return { served: s, top: 7, seq: 12 }; },
  'serves #2 at the name of #7': () => { const s = new Map(posts); s.set(7, posts.get(2)); return { served: s, top: 7, seq: 12 }; },
  'adds #8 with a stolen key':   () => { const s = new Map(posts); s.set(8, makePost(8, 'vote for me', oldStolen)); return { served: s, top: 7, seq: 12 }; },
  'replays last month\'s index': () => ({ served: new Map([...posts].slice(0, 5)), top: 5, seq: 9 }),
  // Not an attack: Alice's own numbering has a hole, because #5 was a draft she abandoned.
  'nothing — Alice skipped #5':  () => { const s = new Map(posts); s.delete(5); return { served: s, top: 7, seq: 12, skipped: [5] }; },
};

console.log('\nWhat each index shape catches (Alice has 7 posts, none withdrawn)\n');
const width = 30;
console.log('  ' + 'the host...'.padEnd(30) + Object.keys(indexes).map((k) => k.padEnd(width)).join(''));
for (const [name, mk] of Object.entries(events)) {
  const cells = Object.entries(indexes).map(([shape, build]) => {
    const { served, top, seq, skipped = [] } = mk();
    const idx = build(top, skipped.length && shape !== 'tiny counter' ? skipped : [], seq);
    const c = readerVerdict(shape, idx, served);
    return (c.length ? 'CAUGHT: ' + c[0] : 'nothing to report').slice(0, width - 1).padEnd(width);
  });
  console.log('  ' + name.padEnd(30) + cells.join(''));
}

// --- how big does each get after ten years of a chatty family? ---
console.log('\nSize after 10 years at 3 posts a week (1,560 posts, 20 of them withdrawn)\n');
const many = Array.from({ length: 1560 }, (_, i) => i + 1);
const withdrawn = many.filter((n) => n % 78 === 0);
const sizes = {
  'tiny counter':         JSON.stringify({ seq: 12, top: 1560, withdrawn, prev: 'abc123' }).length,
  'full list of names':   JSON.stringify({ seq: 12, names: many, withdrawn }).length,
  'names + fingerprints': JSON.stringify({ seq: 12, entries: many.map((n) => [n, 'cdd58e3d6bcf']), withdrawn }).length,
};
for (const [k, v] of Object.entries(sizes)) console.log(`  ${k.padEnd(24)} ${String(v).padStart(7)} bytes   (re-fetched every time a reader checks in)`);

console.log(`
Why the tiny one keeps up: because the names are sequential, "the highest number is 1,560" already
says which posts exist — 1 through 1,560, minus the withdrawn list. Listing them out adds nothing.
And because a post cannot be written over, a smuggled post has nowhere to sit: every number at or
below the top is taken, and anything above it is above what Alice declared. That is the whole
defence against a stolen key, and it costs nothing.

The one thing it does not catch on its own is the middle row — the host serving genuine post #2 at
the name #7. What catches that is not the index at all: it is the post saying its own number inside
the stamped bytes. Free, and it is what makes a pretty alias safe. You can hang any nice name you
like on top, because the reader checks what came back rather than trusting where it came from.
`);
