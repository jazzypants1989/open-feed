// Brief I — what is the small signed thing a reader pins?
// Three shapes under five events. The hub is hostile and controls the directory listing.
import crypto from 'node:crypto';

const k = crypto.generateKeyPairSync('ed25519');
const stolen = crypto.generateKeyPairSync('ed25519');            // an old key, revoked after theft
const sign = (o, key = k) => ({ ...o, sig: crypto.sign(null, Buffer.from(JSON.stringify(o)), key.privateKey).toString('base64url') });
const H = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('base64url').slice(0, 8);

const items = ['i1', 'i2', 'i3', 'i4', 'i5'].map((id) => sign({ id, body: id }));
const live = (ids) => items.filter((i) => ids.includes(i.id));

// The three head shapes, each signed and sequenced.
const heads = {
  enumerating: (seq, ids, tombs, prev) => sign({ seq, ids, tombstones: tombs }),
  counting: (seq, ids, tombs, prev) => sign({ seq, count: ids.length, prev }),
  admission: (seq, ids, tombs, prev) => sign({ seq, ids, tombstones: tombs, admit_only_listed: true }),
};

// A reader pins the last head it verified and the ids it actually rendered.
function read(shape, head, served, pinned) {
  const out = { rendered: [], alarms: [] };
  if (pinned && head.seq < pinned.seq) out.alarms.push('rollback');
  for (const it of served) {
    // The stolen key WAS Alice's, so it is in her published key history: the signature checks out.
    const body = Buffer.from(JSON.stringify({ id: it.id, body: it.body }));
    const authentic = [k, stolen].some((key) => crypto.verify(null, body, key.publicKey, Buffer.from(it.sig, 'base64url')));
    const listed = head.ids ? head.ids.includes(it.id) : null;
    if (!authentic) { out.alarms.push(`bad sig ${it.id}`); continue; }
    if (shape === 'admission' && listed === false) { out.alarms.push(`not admitted: ${it.id}`); continue; }
    if (shape === 'enumerating' && listed === false) { out.alarms.push(`lag (pending): ${it.id}`); out.rendered.push(it.id); continue; }
    out.rendered.push(it.id);
  }
  if (head.ids) for (const id of head.ids) if (!served.some((s) => s.id === id)) out.alarms.push(`listed but withheld: ${id}`);
  if (head.count !== undefined && head.count !== served.length) out.alarms.push(`count says ${head.count}, ${served.length} served`);
  if (pinned) for (const id of pinned.saw) {
    const gone = !served.some((s) => s.id === id);
    const tombstoned = (head.tombstones ?? []).includes(id);
    if (gone && !tombstoned) out.alarms.push(`VANISHED without tombstone: ${id}`);
  }
  return out;
}

const all = items.map((i) => i.id);
const events = [
  ['honest publish',            (s) => ({ head: [6, all, [], 'p5'], served: items })],
  ['drop i3, reader HAD seen',  (s) => ({ head: [6, all, [], 'p5'], served: live(['i1', 'i2', 'i4', 'i5']), pinned: { seq: 5, saw: all } })],
  ['drop i3, reader NEVER saw', (s) => ({ head: [6, all, [], 'p5'], served: live(['i1', 'i2', 'i4', 'i5']) })],
  ['inject via stolen key',     (s) => ({ head: [6, all, [], 'p5'], served: [...items, sign({ id: 'evil', body: 'evil' }, stolen)] })],
  ['honest lag (item, no head)',(s) => ({ head: [6, all.slice(0, 4), [], 'p5'], served: items })],
  ['head rolled back to seq 4', (s) => ({ head: [4, all, [], 'p3'], served: items, pinned: { seq: 5, saw: all } })],
];

console.log('\nBrief I — five events against three head shapes (hostile hub owns the listing)\n');
console.log('  event                          | ' + Object.keys(heads).map((s) => s.padEnd(34)).join('| '));
for (const [name, mk] of events) {
  const cells = Object.entries(heads).map(([shape, build]) => {
    const { head: hargs, served, pinned } = mk(shape);
    const r = read(shape, build(...hargs), served, pinned);
    return (r.alarms.length ? r.alarms.join('; ') : `clean (${r.rendered.length} items)`).slice(0, 34).padEnd(34);
  });
  console.log('  ' + name.padEnd(30) + ' | ' + cells.join('| '));
}
console.log(`
  Reading, column by column:
   - ENUMERATING catches every withholding, named: the head says i3 exists and no i3 arrives. It
     pays for it in the "honest lag" row — an item published before its head reads as pending, which
     is the lag state GOALS.md:80 retires. That row is only a problem if the head is BATCHED; a head
     re-signed on every publish never lags, and then enumerating costs nothing but size.
   - COUNTING (kimi's fifty bytes) catches the drop as a NUMBER — "5 declared, 4 served" — and can
     never say which, cannot tell a drop from a tombstone, and needs the reader to fetch every item
     to notice at all. It is the only shape whose head does not grow with the feed.
   - ADMISSION (glm) is enumerating plus one rule: unlisted means not rendered. Look at the
     stolen-key row: the signature is genuine (the key really was Alice's before the theft), so the
     first two columns RENDER the injected item and only the head's silence hints at anything.
     Admission refuses it on the spot, with no revocation timestamps and no clock. Its price is the
     honest-lag row, now a hard refusal instead of a pending state.
   - Every column catches the rollback, because a pinned sequence is what does that work — that
     part of GOALS.md:79 is already load-bearing and cheap.
`);
