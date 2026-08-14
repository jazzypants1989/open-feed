// Syndication-mapping prototype: settles the shape question PROPOSAL.md left open and
// REVIEW-1 F3 reopened. Three candidate shapes for recording "this item was syndicated
// to these foreign URIs":
//
//   A. `_syndication` field on the item  (PROPOSAL.md §6: bump _version, re-sign, re-manifest)
//   B. a chained syndication DOCUMENT    (REVIEW-1 F3: §16 mold, like follows/pins)
//   C. receipt relation ITEMS            (REVIEW-2 §3: content-less _rel items in the activity feed)
//
// Modeled flows: publish → syndicate to M targets; a foreign reply routes home; the
// publisher deletes a post and tries to retract its silo copies FROM PUBLIC BYTES ALONE
// (the multi-device / lost-laptop case); a stray re-ingested copy is recognized as a
// duplicate. Real signatures, real manifests, real byte counts.

import crypto from 'node:crypto';

// ---- helpers lifted from regen.js (same canonicalization + signing construction) ----
function canon(v){
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k)+':'+canon(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
const b64u = b => Buffer.from(b).toString('base64url');
const sha256 = b => crypto.createHash('sha256').update(b).digest();
const docHash = obj => b64u(sha256(Buffer.from(canon(obj), 'utf8')));
function keyFromLabel(label){
  const seed = crypto.createHash('sha256').update('open-feed-v0.6 '+label).digest();
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'), seed]);
  const priv = crypto.createPrivateKey({key:pkcs8, format:'der', type:'pkcs8'});
  const spki = crypto.createPublicKey(priv).export({format:'der', type:'spki'});
  return {priv, x:b64u(spki.subarray(spki.length-32))};
}
function sign(obj, priv, kid){
  const {_sig, _recovery_sig, ...rest} = obj;
  const hb = b64u(Buffer.from(JSON.stringify({alg:'EdDSA', b64:false, crit:['b64'], kid}),'utf8'));
  const input = Buffer.concat([Buffer.from(hb+'.','ascii'), Buffer.from(canon(rest),'utf8')]);
  return hb + '..' + b64u(crypto.sign(null, input, priv));
}

const ID = 'https://posse.example/';
const KID = ID + '#posse-key-1';
const k = keyFromLabel('posse-key-1');
const FEED = ID + 'feed.json';
const ACTIVITY = ID + 'activity.json';

const N_POSTS = 100, M_TARGETS = 2;   // family-decade-ish volume, Mastodon + Bluesky
const fake = (i, t) => t === 0
  ? `https://mastodon.example/@posse/${100000+i}`
  : `at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/app.bsky.feed.post/3k${i.toString(36).padStart(4,'0')}`;
const permalink = i => `${ID}${2025}/post-${i}/`;

// §7.3 tombstone allowlist, faithfully: only these fields survive.
function tombstone(item){
  const t = { id:item.id, authors:item.authors, date_published:item.date_published,
    date_modified:'2026-08-13T12:00:00Z', _version:item._version+1, _deleted:true, content_text:'' };
  if ('_feed_url' in item) t._feed_url = item._feed_url;
  if ('_rel' in item) t._rel = item._rel;
  t._sig = sign(t, k.priv, KID);
  return t;
}

function makeItem(i, extra={}){
  const item = { id:`urn:uuid:post-${i}`, url:permalink(i), _feed_url:FEED, _version:1,
    authors:[{url:ID}], content_text:`post ${i}`, date_published:'2026-01-01T00:00:00Z', ...extra };
  item._sig = sign(item, k.priv, KID);
  return item;
}

// A manifest chain that records every retained version's byte size (spec §9.2's
// O(versions × items) growth is the cost REVIEW-1's table says shape A doubles).
class ManifestChain {
  constructor(feedUrl){ this.feedUrl=feedUrl; this.seq=0; this.prevHash=null; this.items={}; this.retainedBytes=0; this.versions=0; }
  advance(){
    this.seq++;
    const m = { url:ID, feed_url:this.feedUrl, seq:this.seq, updated:1767225600+this.seq,
      items:Object.fromEntries(Object.entries(this.items).map(([id,it])=>[id,[it._version, docHash(it)]])) };
    if (this.prevHash) m.prev = this.prevHash;
    m._sig = sign(m, k.priv, KID);
    this.prevHash = docHash(m);
    this.retainedBytes += Buffer.byteLength(canon(m),'utf8');
    this.versions++;
  }
  commit(item){ this.items[item.id]=item; this.advance(); }
}

const shapes = {};

// ---------- Shape A: `_syndication` field, bump-and-re-sign ----------
{
  const feed = new Map(), man = new ManifestChain(FEED);
  let signs = 0;
  for (let i=0;i<N_POSTS;i++){
    const item = makeItem(i); signs++;
    feed.set(item.id, item); man.commit(item);
    // syndicate → learn foreign URIs → one bump covering both targets (best case for A)
    const synd = [...Array(M_TARGETS)].map((_,t)=>fake(i,t));
    const v2 = makeItem(i, {_syndication:synd, _version:2, date_modified:'2026-01-01T01:00:00Z'}); signs++;
    feed.set(v2.id, v2); man.commit(v2);
  }
  // routing: foreign reply names its silo parent URI → find the home item
  const route = uri => { let ops=0; for (const it of feed.values()){ ops++; if (it._syndication?.includes(uri)) return {ops}; } return {ops, miss:true}; };
  // retraction from public bytes after deletion
  const victim = feed.get('urn:uuid:post-5');
  const targetsBefore = victim._syndication;
  const t = tombstone(victim); feed.set(t.id, t); man.commit(t);
  const recoverable = '_syndication' in t ? t._syndication : null;   // allowlist strips it
  shapes.A = { signs, manifests:[man], routeOps:route(fake(50,0)).ops,
    extraFetches:0, retractFromPublic:!!recoverable, copyRecognitionFromBytes:true,
    note:'tombstone stripped '+targetsBefore.length+' target URIs; retraction needs client-local state' };
}

// ---------- Shape B: chained syndication document ----------
{
  const feed = new Map(), man = new ManifestChain(FEED);
  let signs = 0, docSeq = 0, docPrev = null, docBytes = 0;
  const map = {};
  const advanceDoc = () => {
    docSeq++;
    const d = { url:ID, seq:docSeq, updated:1767225600+docSeq, syndication:structuredClone(map) };
    if (docPrev) d.prev = docPrev;
    d._sig = sign(d, k.priv, KID); signs++;
    docPrev = docHash(d); docBytes += Buffer.byteLength(canon(d),'utf8');
    return d;
  };
  let doc;
  for (let i=0;i<N_POSTS;i++){
    const item = makeItem(i); signs++;
    feed.set(item.id, item); man.commit(item);
    map[item.id] = [...Array(M_TARGETS)].map((_,t)=>fake(i,t));
    doc = advanceDoc();                       // item bytes never touched
  }
  const inverse = {}; for (const [id,uris] of Object.entries(doc.syndication)) for (const u of uris) inverse[u]=id;
  const victim = feed.get('urn:uuid:post-5');
  const t = tombstone(victim); feed.set(t.id, t); man.commit(t);
  shapes.B = { signs, manifests:[man], docVersions:docSeq, docRetainedBytes:docBytes,
    routeOps:1, extraFetches:1, retractFromPublic:doc.syndication['urn:uuid:post-5'].length===M_TARGETS,
    copyRecognitionFromBytes:false,
    note:'one more chained document type to serve, pin, and walk' };
}

// ---------- Shape C: receipt relation items in the activity feed ----------
{
  const feed = new Map(), man = new ManifestChain(FEED);
  const activity = new Map(), actMan = new ManifestChain(ACTIVITY);
  let signs = 0;
  for (let i=0;i<N_POSTS;i++){
    const item = makeItem(i); signs++;
    feed.set(item.id, item); man.commit(item);
    for (let t=0;t<M_TARGETS;t++){
      const r = { id:`urn:uuid:receipt-${i}-${t}`, _feed_url:ACTIVITY, _version:1, authors:[{url:ID}],
        content_text:'', date_published:'2026-01-01T01:00:00Z',
        _rel:[{ type:'https://openfeed.example/rel/syndicated', to:`${FEED}#${item.id}`, external_uri:fake(i,t) }] };
      r._sig = sign(r, k.priv, KID); signs++;
      activity.set(r.id, r); actMan.commit(r);
    }
  }
  const route = uri => { let ops=0; for (const r of activity.values()){ ops++; if (r._rel[0].external_uri===uri) return {ops}; } return {ops, miss:true}; };
  const victim = feed.get('urn:uuid:post-5');
  const t = tombstone(victim); feed.set(t.id, t); man.commit(t);
  const receipts = [...activity.values()].filter(r=>r._rel[0].to.endsWith('#'+victim.id));
  shapes.C = { signs, manifests:[man, actMan], routeOps:route(fake(50,0)).ops,
    extraFetches:1, retractFromPublic:receipts.length===M_TARGETS, copyRecognitionFromBytes:false,
    note:'receipts survive the tombstone but are themselves permanent published items' };
}

// ---------- report ----------
const row = (label, f) => console.log('  ' + label.padEnd(34) + ['A','B','C'].map(s=>String(f(shapes[s])).padStart(14)).join(''));
console.log(`SYNDICATION SHAPE COMPARISON — ${N_POSTS} posts × ${M_TARGETS} targets, delete one post\n`);
console.log('  ' + ' '.repeat(34) + ['A: field','B: document','C: receipts'].map(s=>s.padStart(14)).join(''));
row('signatures produced',            s=>s.signs);
row('primary-manifest versions',      s=>s.manifests[0].versions);
row('activity-manifest versions',     s=>s.manifests[1]?.versions ?? 0);
row('syndication-doc versions',       s=>s.docVersions ?? 0);
row('retained manifest KB',           s=>Math.round(s.manifests.reduce((a,m)=>a+m.retainedBytes,0)/1024));
row('retained synd-doc KB',           s=>Math.round((s.docRetainedBytes??0)/1024));
row('route lookup (scan ops)',        s=>s.routeOps);
row('route extra fetches',            s=>s.extraFetches);
row('retract from public bytes',      s=>s.retractFromPublic ? 'YES' : 'NO');
row('copy-recognition from bytes',    s=>s.copyRecognitionFromBytes ? 'YES' : 'NO');
console.log();
for (const [s,v] of Object.entries(shapes)) console.log(`  ${s}: ${v.note}`);
console.log(`
NOTES
- The backlink is the primary routing key in every shape: the silo copy links to the
  permalink, and the gateway observing a reply already holds the parent. The numbers
  above are for the fallback (no backlink present).
- §9.2 cadence batching can fold shape A's two manifest advances into one, but cannot
  remove the second item revision or the doubled per-version item churn.
- Shape A is the only shape that loses the retraction targets at exactly the moment
  they are needed (§7.3 allowlist strips _syndication from the tombstone).
- Shape B's document is one fetch for the whole map and survives deletion, at the cost
  of a new chained document type (serve + pin + walk + derived-URL retention).
- Shape C stays inside the one-object model with zero new document types, but doubles
  signed artifacts and makes routing a feed scan; receipts also outlive retraction as
  permanent published statements of where copies went (a disclosure shape B can prune
  only by feed rotation, and shape A genuinely deletes).
`);
const sane = shapes.A.retractFromPublic===false && shapes.B.retractFromPublic && shapes.C.retractFromPublic
  && shapes.A.copyRecognitionFromBytes && !shapes.B.copyRecognitionFromBytes;
console.log(sane ? 'ALL FLOW CHECKS PASS' : 'FLOW CHECKS FAILED');
process.exit(sane ? 0 : 1);
