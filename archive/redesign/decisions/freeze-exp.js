// Brief A — can a frozen copy ever read as stale?
// Stages: hostile hub serves Alice's profile frozen at seq 5 forever, correctly signed.
// Readers: Mom (received the out-of-band link), Cousin (did not).
// Options compared: 1 baseline location-list, 2 declared next-update deadline,
// 5 location gossiped through interaction targets. Then option 2 vs a key custodian.
import crypto from 'node:crypto';

const DAY = 86400;
const key = (n) => { const k = crypto.generateKeyPairSync('ed25519'); k.name = n; return k; };
const sign = (obj, k) => ({ ...obj, sig: crypto.sign(null, Buffer.from(JSON.stringify(obj)), k.privateKey).toString('base64url') });
const verify = (doc, k) => { const { sig, ...body } = doc; return crypto.verify(null, Buffer.from(JSON.stringify(body)), k.publicKey, Buffer.from(sig, 'base64url')); };

const alice = key('alice');
const mom = key('mom');

// Two hubs. The ex owns HOSTILE and keeps serving seq 5; Alice moved to NEWHUB and published seq 6.
const HOSTILE = 'https://family.example/alice';
const NEWHUB = 'https://newhub.net/alice';

const profileAt = (seq, locations, t, { nextUpdate = null } = {}) =>
  sign({ seq, locations, published_at: t, ...(nextUpdate !== null ? { next_update: nextUpdate } : {}) }, alice);

// Day 0: Alice publishes seq 5 from the ex's hub. Day 10: she publishes seq 6 naming both.
const seq5 = (opts) => profileAt(5, [HOSTILE], 0 * DAY, opts);
const seq6 = (opts) => profileAt(6, [NEWHUB, HOSTILE], 10 * DAY, opts);

// The hostile hub is frozen: it serves seq 5 at its own URL forever and 404s anything else.
const hostileHub = (opts) => (url) => (url === HOSTILE ? seq5(opts) : null);
const newHub = (opts) => (url) => (url === NEWHUB ? seq6(opts) : url === HOSTILE ? seq5(opts) : null);

// A reader: a set of remembered locations, a highest-seen sequence, and a verdict.
function reader(name, known) { return { name, known: [...known], seq: 0, doc: null, verdict: 'unknown' }; }

function poll(r, fetchers, now, { ceiling = 7 * DAY, useDeadline = false } = {}) {
  let best = null;
  for (const loc of r.known) {
    for (const f of fetchers) { const d = f(loc); if (d && verify(d, alice) && (!best || d.seq > best.seq)) best = d; }
  }
  if (!best) return (r.verdict = 'unreachable');
  if (best.seq > r.seq) { r.seq = best.seq; r.doc = best; for (const l of best.locations) if (!r.known.includes(l)) r.known.push(l); }
  const d = r.doc;
  const deadline = useDeadline && d.next_update != null ? Math.min(d.next_update, d.published_at + ceiling) : Infinity;
  r.verdict = now > deadline ? 'STALE' : 'her, currently';
  if (r.known.includes(NEWHUB) && r.seq >= 6) r.verdict = 'FOLLOWED to new hub';
  return r.verdict;
}

const rows = [];
const run = (label, mk, opts, extra = () => {}) => {
  const fetchers = [hostileHub(opts), newHub(opts)];
  const readers = mk();
  extra(readers, fetchers);
  for (const t of [5, 8, 20, 90]) for (const r of readers) poll(r, fetchers, t * DAY, opts);
  rows.push([label, ...readers.map((r) => `${r.name}: ${r.verdict}`)]);
};

// --- Option 1: baseline. Mom got the link (so she knows NEWHUB); Cousin knows only the ex's hub.
run('1  location list only',
  () => [reader('Mom(link)', [HOSTILE, NEWHUB]), reader('Cousin', [HOSTILE])], {});

// --- Option 2: Alice's seq 5 declared a next-update 7 days out; the reader ceiling is 7 days too.
run('2  declared deadline',
  () => [reader('Mom(link)', [HOSTILE, NEWHUB]), reader('Cousin', [HOSTILE])],
  { nextUpdate: 7 * DAY, useDeadline: true });

// --- Option 5: gossip. Mom replies to Alice after the move; her item names Alice's key AND location.
run('5  gossip via interaction',
  () => [reader('Mom(link)', [HOSTILE, NEWHUB]), reader('Cousin', [HOSTILE])], {},
  (readers, fetchers) => {
    const momItem = sign({ author: 'mom', target: { key: alice.publicKey.export({ format: 'jwk' }).x, location: NEWHUB, seq: 6 } }, mom);
    const cousin = readers[1];
    if (verify(momItem, mom)) cousin.known.push(momItem.target.location);   // the one new reader rule
  });

// --- Option 2's stated limit: the hub holds the key and advances an empty head on schedule.
{
  const custodial = (url) => (url === HOSTILE ? profileAt(5, [HOSTILE], 84 * DAY, { nextUpdate: 91 * DAY }) : null);
  const r = reader('Cousin', [HOSTILE]);
  poll(r, [custodial], 90 * DAY, { useDeadline: true });
  rows.push(['2* custodian advances empty head', `${r.name}: ${r.verdict}`]);
}

console.log('\nBrief A — frozen hostile hub, day 90 verdicts\n');
for (const [label, ...cells] of rows) console.log('  ' + label.padEnd(34) + cells.join('   |   '));
console.log(`
  Reading:
   - Option 1 leaves the cousin at "her, currently": the promise in scenario 1 does not hold for her.
   - Option 2 buys the SIGNAL for every reader (cousin reads STALE) but not REACHABILITY: she still
     cannot find the new hub. It is the difference between "she went quiet" and "she left"; it is
     not the difference between "she left" and "she is here now".
   - Option 5 buys REACHABILITY for any reader with a social path, and nothing for one without.
   - 2* is option 2's limit, stated in the spec beside it: a custodian who can sign never goes stale.
     In the divorce the ex cannot sign, so the deadline does bind him.
`);
