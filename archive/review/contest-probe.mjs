import crypto from 'node:crypto';
import { signingKeyFromSeed } from '../../src/file.js';
import { commit, rotation, restore, signProfile, verifyProfile } from '../../src/profile.js';
const key = (l) => signingKeyFromSeed(crypto.createHash('sha256').update(`openfeed/v1/vector:${l}`).digest());
const A = key('alice/anchor'), A2 = key('alice/rotated'), A3 = key('alice/restored'), EX = key('ex');
const mum = { key: key('mum'), salt: 'saltmum' }, sis = { key: key('sis'), salt: 'saltsis' }, ex = { key: EX, salt: 'saltex' };
const family = commit(1, [mum, sis, ex]);
const LOC = ['https://alice.example/alice'], anchor = { key: A.x };
const prof = (version, chain, recovery) => ({ anchor: A.x, version, name: 'Alice', chain, recovery, locations: LOC });
const read = (o, signer, pin = null) => verifyProfile(signProfile(o, signer), { learned: A.x, pin });
const pinOf = (r) => ({ profileVersion: r.raw.version, profileHash: r.profile.address, chain: r.raw.chain, recoveryLists: r.recoveryLists, fields: r.fields });
const L1 = rotation(A, A2, family), rotA3 = rotation(A2, A3, family), restA3 = restore(A2, A3, [mum, sis], family);
const lbl = { [A.x]: 'anchor', [A2.x]: 'A2', [A3.x]: 'A3', [EX.x]: 'EX' };

// Probe 1: block 5's setup (reader pinned on her rotation to A3, family list k=1, ex on the list),
// but the ex EXTENDS the chain with a self-vouched restore A3 -> EX instead of forking at A2.
const rotPin = pinOf(read(prof(3, [anchor, L1, rotA3], family), A3));
const extend = read(prof(4, [anchor, L1, rotA3, restore(A3, EX, [ex], family)], family), EX, rotPin);
console.log('probe 1 (extend, no split):', extend.verdict, extend.why ?? '', extend.verdict === 'ok' ? 'now following ' + lbl[extend.chain.current] : '');

// Probe 2: thief-first ordering. Reader pinned at version 2 (ends on A2, which he holds). He rotates
// A2 -> EX first; reader follows (no split). Then Alice's restore A2 -> A3 by mum+sis arrives.
const early = pinOf(read(prof(2, [anchor, L1], family), A2));
const his = read(prof(3, [anchor, L1, rotation(A2, EX, family)], family), EX, early);
console.log('probe 2a (his rotation first):', his.verdict, his.verdict === 'ok' ? 'following ' + lbl[his.chain.current] : his.why);
const hers = read(prof(4, [anchor, L1, restA3], family), A3, pinOf(his));
console.log('probe 2b (her majority restore vs pinned thief branch):', hers.verdict, hers.verdict === 'ok' ? 'switched to ' + lbl[hers.chain.current] : hers.why);
