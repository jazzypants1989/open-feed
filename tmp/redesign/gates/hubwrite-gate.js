// hubwrite-gate: what a hub that "MAY check nothing on the ordinary path" (§9.5) lets a stranger do
// to the two overwritable files. §9.4 asks a later profile write to carry the same genesis and a
// higher pseq; §9.1's entity tag is whatever GET returns; §13's hub MUSTs never say "verify". So
// a stranger PUTs a profile with her genesis, pseq+1 and a garbage signature line, and a head
// signed by nobody. Finding A3 of the 2026-08-23 review. Kill criteria: the clobber refused by the
// text as written; the repair refusing an honest rotation or an honest head.
import { read } from './weekend-reader.js';
import * as pub from './weekend-publisher.js';
import { Hub, io } from './hub.js';

const claims = [];
const claim = (what, ok) => { claims.push([what, ok]); console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`); };

const G = pub.newKey(), K2 = pub.newKey(), S = pub.newKey();
const REC = pub.commit(1, [{ key: pub.newKey(), salt: 's' }]);
const AT = '/alice';
const prof = (pseq, chain, key) => pub.profile({ genesis: G.x, pseq, chain, recovery: REC, locations: ['https://alice.example'] }, key);
const c1 = [{ key: G.x }], c2 = [...c1, pub.rotation(G, K2, REC)];
// A stranger's forgery: her genesis, a higher pseq, the right shape, his own signature.
const forged = (pseq) => prof(pseq, c1, S);
// Honest-looking but garbage: the bytes of her real profile with pseq bumped — the signature no longer matches.
const tampered = (pseq) => { const f = prof(1, c1, G); return Buffer.concat([Buffer.from(f.subarray(0, f.lastIndexOf(0x0a)).toString().replace('"pseq":1', `"pseq":${pseq}`)), f.subarray(f.lastIndexOf(0x0a))]); };

async function scene(verifyWrites) {
  const hub = await new Hub({ verifyWrites }).listen(), net = io(hub);
  await net.put(`${AT}/profile`, prof(1, c1, G), null);
  await pub.publish(net, AT, G, 1, { at: '2026-08-01', text: 'post 1' });
  const pinned = (await read(net.get, { learned: G.x, at: AT })).pin;
  const etag = (k) => hub.tag(k);                                    // what a GET returns to anyone
  const see = async (pin) => { const r = await read(net.get, { learned: G.x, at: AT, pin }); return r.verdict === 'ok' ? 'ok' : `${r.verdict}: ${r.why}`; };
  return { hub, net, pinned, etag, see };
}

for (const verifyWrites of [false, true]) {
  console.log(`\n${verifyWrites ? 'Repaired: the hub verifies the profile and the head before storing them.' : 'As written: the hub checks nothing but the entity tag, genesis and pseq.'}\n`);
  const s = await scene(verifyWrites);
  const p1 = await s.net.put(`${AT}/profile`, forged(2), s.etag('alice/profile'));
  const after1 = [await s.see(s.pinned), await s.see(null)];
  const p2 = await s.net.put(`${AT}/profile`, tampered(3), s.etag('alice/profile'));
  const after2 = [await s.see(s.pinned), await s.see(null)];
  // Alice's own repair costs her one PUT — and the stranger's next one costs him one.
  const aliceBack = await s.net.put(`${AT}/profile`, prof(4, c1, G), s.etag('alice/profile'));
  const h1 = await s.net.put(`${AT}/head`, pub.head({ entries: [], hseq: 99, top: 0 }, S), s.etag('alice/head'));
  const after3 = [await s.see(s.pinned), await s.see(null)];
  // The honest case the repair must not break: a real rotation, then the head re-signed.
  const rot = await s.net.put(`${AT}/profile`, prof(5, c2, K2), s.etag('alice/profile'));
  let resigned = 'threw'; try { await pub.resignHead(s.net, AT, K2); resigned = 'ok'; } catch (e) { resigned = e.message; }
  const honest = await s.see(null);
  s.hub.close();
  const label = verifyWrites ? 'repaired' : 'as written';
  if (!verifyWrites) {
    claim(`${label}: the stranger's profile is stored (${p1}); pinned reader ${after1[0]} · cold reader ${after1[1]}`, p1 === 200 && after1.every((v) => v.startsWith('identity')));
    claim(`${label}: her own bytes with pseq bumped are stored too (${p2}); readers ${after2[0]}`, p2 === 200 && after2.every((v) => v.startsWith('identity')));
    claim(`${label}: Alice writes herself back (${aliceBack}) — one PUT each way, a write war with no end`, aliceBack === 200);
    claim(`${label}: a head signed by nobody is stored (${h1}); pinned reader ${after3[0]} · cold reader ${after3[1]}`, h1 === 200 && after3[0].startsWith('ok') && after3[1].startsWith('host'));
  } else {
    claim(`${label}: the stranger's profile is refused (${p1}); readers ${after1[0]}`, p1 === 403 && after1.every((v) => v === 'ok'));
    claim(`${label}: her tampered bytes are refused (${p2}); readers ${after2[0]}`, p2 === 403 && after2.every((v) => v === 'ok'));
    claim(`${label}: the unsigned head is refused (${h1}); readers ${after3[0]}`, h1 === 403 && after3.every((v) => v === 'ok'));
  }
  claim(`${label}: her real rotation is stored (${rot}), the head re-signed (${resigned}), a cold reader ${honest}`, rot === 200 && resigned === 'ok' && honest === 'ok');
}

const failed = claims.filter(([, ok]) => !ok);
console.log(failed.length ? `\n${failed.length} claim(s) did not hold` : `\nall ${claims.length} claims hold`);
process.exit(failed.length ? 1 : 0);
