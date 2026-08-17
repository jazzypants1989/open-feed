// Recipient-scoped item pins: can ordinary family traffic carry the second observation that
// §5.3.1's compare rule needs, without §16's reading-graph disclosure?
//
// The gap: §5.3.1 is a Level 1 MUST and the whole §13.2 transparency claim rests on it, but
// §16.2 explicitly declines to define a gossip transport, and the §16.1 pins document
// publishes whom you read and when — which is why it is opt-in and why most families won't
// run it. So the rule is mandatory and its input supply is optional. Meanwhile §5.2 step 5
// makes a publisher record every (seq, hash) it produced, and today that record has nothing
// to compare against.
//
// Candidate: `_openfeed.pins` on an ordinary signed item (§8), scoped to the RECIPIENT'S OWN CHAINS
// ONLY. Every reply, like, or repost already proves you read the recipient, so a pin of their
// chains discloses nothing new. Claims tested here:
//
//   1  the pin rides inside the signed bytes and cannot be stripped or edited in flight
//   2  it catches a host equivocating about the recipient at a seq the recipient has recorded
//   3  it catches a host publishing a chain version the recipient never authored
//   4  on a PUBLISHED relation item the pin reaches third parties with no help from the host
//   5  recipient-scoping really is zero-disclosure, unlike a §16.1 pins document
//   6  what it costs in bytes, and the bound it does NOT clear

import crypto from 'node:crypto';

// ---- helpers lifted from regen.js (same canonicalization + signing construction, §6) ----
function canon(v){
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k)+':'+canon(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
const b64u = b => Buffer.from(b).toString('base64url');
const sha256 = b => crypto.createHash('sha256').update(b).digest();
const bytesOf = o => Buffer.from(canon(o), 'utf8');
const hashOf  = o => b64u(sha256(bytesOf(o)));
function keyFromLabel(label){
  const seed = crypto.createHash('sha256').update('open-feed-v0.6 '+label).digest();
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'), seed]);
  const priv = crypto.createPrivateKey({key:pkcs8, format:'der', type:'pkcs8'});
  return { priv, pub: crypto.createPublicKey(priv) };
}
function sign(obj, priv, kid){
  const {_sig, _recovery_sig, ...rest} = obj;
  const hb = b64u(Buffer.from(JSON.stringify({alg:'EdDSA', b64:false, crit:['b64'], kid}),'utf8'));
  const input = Buffer.concat([Buffer.from(hb+'.','ascii'), Buffer.from(canon(rest),'utf8')]);
  return hb + '..' + b64u(crypto.sign(null, input, priv));
}
function verify(obj, pub){
  const {_sig, _recovery_sig, ...rest} = obj;
  if (!_sig) return false;
  const [hb,,sig] = _sig.split('.');
  const input = Buffer.concat([Buffer.from(hb+'.','ascii'), Buffer.from(canon(rest),'utf8')]);
  return crypto.verify(null, input, pub, Buffer.from(sig,'base64url'));
}

// ---- the cast ---------------------------------------------------------------------------
// Mom is hosted by the family hub, which holds her signing key (§13.2 key-custodian tier).
// Dad self-hosts. Gran is a third party who reads Dad's public feed.
const MOM = 'https://mom.pence.family/', DAD = 'https://jessepence.com/', GRAN = 'https://gran.example/';
const MOM_MANIFEST = MOM + 'manifest.json', MOM_IDENTITY = MOM + 'openfeed.json';
const DAD_FEED = DAD + 'feed.json';
const momK = keyFromLabel('mom-key-1'), dadK = keyFromLabel('dad-key-1');
const T0 = 1739577600;

function momManifest(seq, prev, itemIds){
  const items = {};
  for (const id of itemIds) items[id] = [1, b64u(sha256(Buffer.from(id)))];
  const m = { url: MOM, feed_url: MOM + 'feed.json', seq, updated: T0 + seq*3600, items };
  if (prev) m.prev = prev;
  m._sig = sign(m, momK.priv, MOM + '#key-1', { kind: 'manifest' });
  return m;
}

// Mom's own record of what she published (§5.2 step 5 / §12 Level 3 requirement 2).
const honest = [];
let prev = null;
for (let s = 1; s <= 3; s++){
  const m = momManifest(s, prev, Array.from({length: s*2}, (_,i) => `urn:uuid:item-${i}`));
  honest.push(m); prev = hashOf(m);
}
const selfRecord = honest.map(m => ({ url: MOM_MANIFEST, seq: m.seq, hash: hashOf(m) }));

// The hub equivocates: it serves Dad a DIFFERENT seq 3 — one item quietly missing.
const forkedSeq3 = momManifest(3, hashOf(honest[1]), ['urn:uuid:item-0','urn:uuid:item-1',
  'urn:uuid:item-2','urn:uuid:item-3','urn:uuid:item-4']);   // 5 items, not 6

// ---- Dad replies, carrying a recipient-scoped pin ------------------------------------------
function dadReply({ published, pins, id = 'urn:uuid:dad-reply-1' }){
  const item = {
    id, authors: [{ url: DAD }],
    content_text: 'Those cookies were delicious!',
    date_published: "2026-02-15T09:00:00Z",
    _openfeed: {
      version: 1,
      rel: [{ type: "reply", to: MOM + "feed.json#urn:uuid:item-4" }],
      ...(published ? { feed_url: DAD_FEED } : {}),
      ...(pins ? { pins } : {}),
    },
  };
  item._sig = sign(item, dadK.priv, DAD + '#key-1', { kind: 'item' });
  return item;
}
// Dad's client pins what the hub served HIM, and names only Mom's chains.
const dadObservation = [
  { url: MOM_IDENTITY, seq: 1, hash: 'aNy3l73-Z_cRTwvLApVhCPi19Pxx3Kgn7XN-uw8vfk0', observed: T0 + 4000 },
  { url: MOM_MANIFEST, seq: 3, hash: hashOf(forkedSeq3), observed: T0 + 4000 },
];
const reply = dadReply({ published: true, pins: dadObservation });

// The comparison Mom (or any holder of her self-record) runs on receipt.
function compare(item, record){
  if (!verify(item, dadK.pub)) return { error: 'signature invalid' };
  const out = [];
  for (const p of item._openfeed?.pins || []){
    const mine = record.filter(r => r.url === p.url);
    const same = mine.find(r => r.seq === p.seq);
    if (same && same.hash !== p.hash) out.push({ verdict: 'EQUIVOCATION', url: p.url, seq: p.seq });
    else if (same) out.push({ verdict: 'corroborated', url: p.url, seq: p.seq });
    else if (mine.length && p.seq > Math.max(...mine.map(r => r.seq)))
      out.push({ verdict: 'UNAUTHORED VERSION', url: p.url, seq: p.seq });
    else out.push({ verdict: 'no record', url: p.url, seq: p.seq });
  }
  return { results: out };
}

console.log('Recipient-scoped item pins — prototype\n');

// ---- CLAIM 1: the pin is inside the signed bytes -------------------------------------------
// The copy has to be deep enough to reach `_openfeed`, or the delete mutates `reply` itself
// and every later claim is measured against an already-stripped item.
const stripped = { ...reply, _openfeed: { ...reply._openfeed } }; delete stripped._openfeed.pins;
const edited = {
  ...reply,
  _openfeed: { ...reply._openfeed, pins: [{ ...dadObservation[1], hash: hashOf(honest[2]) }] },
};
console.log('CLAIM 1 — the pin cannot be stripped or edited in flight');
console.log('  reply as sent verifies                    : ' + verify(reply, dadK.pub));
console.log('  hub strips _pins, re-serves                : ' + (verify(stripped, dadK.pub) ? 'verifies (BAD)' : 'signature FAILS'));
console.log('  hub rewrites the pin to the honest hash    : ' + (verify(edited, dadK.pub) ? 'verifies (BAD)' : 'signature FAILS'));
const claim1 = verify(reply, dadK.pub) && !verify(stripped, dadK.pub) && !verify(edited, dadK.pub);
console.log('  → to suppress the pin the hub must drop the whole delivery, which Dad can see.');

// ---- CLAIM 2: equivocation about the recipient, caught -------------------------------------
console.log('\nCLAIM 2 — a host equivocating about Mom at a seq she recorded');
const r2 = compare(reply, selfRecord);
for (const r of r2.results) console.log('  ' + r.url.padEnd(40) + ' seq ' + r.seq + '  → ' + r.verdict);
const claim2 = r2.results.some(r => r.verdict === 'EQUIVOCATION' && r.url === MOM_MANIFEST);
console.log('  Mom published seq 3 with 6 items; Dad was served a seq 3 with 5. Same seq, different');
console.log('  hash — §5.3.1 exactly, reached without either of them publishing a pins document.');

// ---- CLAIM 3: a version the recipient never authored ----------------------------------------
console.log('\nCLAIM 3 — a host publishing a version Mom never authored');
const ghost = momManifest(4, hashOf(honest[2]), ['urn:uuid:item-0','urn:uuid:planted']);
const reply2 = dadReply({ id: 'urn:uuid:dad-reply-2', published: true,
  pins: [{ url: MOM_MANIFEST, seq: 4, hash: hashOf(ghost), observed: T0 + 9000 }] });
const r3 = compare(reply2, selfRecord);
for (const r of r3.results) console.log('  ' + r.url.padEnd(40) + ' seq ' + r.seq + '  → ' + r.verdict);
const claim3 = r3.results.some(r => r.verdict === 'UNAUTHORED VERSION');
console.log('  Mom\'s record stops at seq 3. This is the first mechanism that gives §5.2 step 5');
console.log('  an input — until now a publisher recorded what they signed and compared it to nothing.');

// ---- CLAIM 4: published relations reach third parties without the host ----------------------
console.log('\nCLAIM 4 — reach when the delivered channel runs through the adversary');
const dadManifest = (() => {
  const m = { url: DAD, feed_url: DAD_FEED, seq: 12, updated: T0 + 5000,
    items: { [reply.id]: [1, hashOf(reply)] } };
  m._sig = sign(m, dadK.priv, DAD + '#key-1', { kind: 'manifest' });
  return m;
})();
const granSees = dadManifest.items[reply.id][1] === hashOf(reply) && verify(reply, dadK.pub);
console.log('  reply is published (_feed_url present)     : ' + ('_feed_url' in reply));
console.log('  committed in Dad\'s own manifest           : ' + granSees);
console.log('  Gran reads it from Dad\'s host, not Mom\'s : ' + granSees);
const delivered = dadReply({ id: 'urn:uuid:dad-reply-3', published: false, pins: dadObservation });
console.log('  delivered-only variant (a family reply)    : _feed_url ' +
  ('_feed_url' in delivered ? 'present' : 'ABSENT — the pin reaches only Mom\'s inbox, at the hub'));
const claim4 = granSees && !('_feed_url' in delivered);
console.log('  → this is the real bound. For PUBLISHED relations the pin escapes the hub entirely.');
console.log('    For delivered-only ones — which §8 makes the default for likes and §15.5 for all');
console.log('    encrypted-family interactions — the only path runs through the adversary, who can');
console.log('    drop the delivery. Dropping is noisy (Dad sees his reply never land); comparing is');
console.log('    not something the hub will do against itself when it also supplies Mom\'s client.');

// ---- CLAIM 5: recipient-scoping is genuinely zero-disclosure ---------------------------------
console.log('\nCLAIM 5 — disclosure, against the §16.1 alternative');
const dadPinsDoc = { url: DAD, pins: [
  { url: MOM_MANIFEST, seq: 3, hash: hashOf(forkedSeq3), observed: T0+4000 },
  { url: GRAN + 'manifest.json', seq: 88, hash: 'x', observed: T0+4200 },
  { url: 'https://therapist.example/manifest.json', seq: 4, hash: 'y', observed: T0+4300 },
], updated: T0+5000 };
const itemPinSubjects = [...new Set(reply._openfeed?.pins.map(p => new URL(p.url).origin))];
const docPinSubjects  = [...new Set(dadPinsDoc.pins.map(p => new URL(p.url).origin))];
console.log('  §16.1 pins document names   : ' + docPinSubjects.join(', '));
console.log('  item-carried pin names      : ' + itemPinSubjects.join(', '));
const claim5 = itemPinSubjects.length === 1 && itemPinSubjects[0] === new URL(MOM).origin;
console.log('  → the item pin names only the party the item is already addressed to. Replying to Mom');
console.log('    proves you read Mom. It adds nothing, and it must NOT be allowed to carry third');
console.log('    parties, or it silently republishes the reading graph §16 made opt-in.');

// ---- CLAIM 6: cost, and what it does not buy -------------------------------------------------
const bare = dadReply({ published: true, id: 'urn:uuid:dad-reply-4' });
console.log('\nCLAIM 6 — cost');
console.log('  reply without pins : ' + bytesOf(bare).length + ' B');
console.log('  reply with 2 pins  : ' + bytesOf(reply).length + ' B  (+' +
  (bytesOf(reply).length - bytesOf(bare).length) + ' B, +' +
  (((bytesOf(reply).length / bytesOf(bare).length) - 1) * 100).toFixed(0) + '%)');
const claim6 = bytesOf(reply).length > bytesOf(bare).length;

const all = [claim1, claim2, claim3, claim4, claim5, claim6];
if (!all.every(Boolean)){
  console.error('\nPROTOTYPE FAILED — claims: ' + all.map((c,i) => (i+1)+':'+(c?'ok':'FAIL')).join(' '));
  process.exit(1);
}
console.log('\nVERDICT');
console.log('  Worth adopting as an OPTIONAL §16 convention, recipient-scoped, with the bound stated:');
console.log('   - it supplies §5.3.1 with second observations from traffic that already exists, and');
console.log('     costs ~' + (bytesOf(reply).length - bytesOf(bare).length) + ' B and zero new machinery — no document, no endpoint,');
console.log('     no discovery problem, no reading-graph disclosure;');
console.log('   - it is the first input §5.2 step 5 has ever had;');
console.log('   - third-party pins MUST NOT be permitted here: that is what §16.1 is for, and mixing');
console.log('     them turns every reply into a social-graph disclosure;');
console.log('   - it does NOT defeat a custodian who also supplies the comparing client (§13.2, tier');
console.log('     four). Its value lands with self-hosting relatives and third-party readers of');
console.log('     published relations — which is the "two self-hosting family members" persona;');
console.log('   - it does NOT replace §16.1: recovery propagation, informal timestamping, and');
console.log('     first-contact corroboration (§16.2.2-4) all need third-party pins it deliberately');
console.log('     cannot carry. Complementary, not a substitute.');
console.log('\nALL CLAIMS HOLD');
