// Decision 6, second pass. Two questions: must a voucher hold that much power, and what
// happens to someone with nobody to name?
import crypto from 'node:crypto';

const mk = (n) => { const k = crypto.generateKeyPairSync('ed25519'); k.name = n; return k; };
const pub = (k) => k.publicKey.export({ format: 'jwk' }).x;
const fingerprintOf = (keys) => keys.length === 0 ? null : crypto.createHash('sha256').update([...keys].sort().join('|')).digest('base64url').slice(0, 12);

console.log('\n--- Q1: does the list have to have people on it? ---\n');

// Four people, four completely different situations, ONE rule in the reader.
const mum = mk('mum'), sister = mk('sister'), aPrintedCode = mk('a code on paper in her wallet'), host = mk('the host she pays');
const folk = {
  'Alice (big family)':              [pub(mum), pub(sister)],
  'a man with nobody to name':       [pub(aPrintedCode)],       // the "list" is a key HE keeps
  'someone who trusts their host':   [pub(host)],
  'a new user, three posts old':     [],                        // no recovery at all
};

const readerRule = (profileList, claimSignedBy) => profileList.some((k) => claimSignedBy.includes(k));
for (const [who, list] of Object.entries(folk)) {
  const fp = fingerprintOf(list);
  console.log(`  ${who.padEnd(32)} profile says: ${(fp ? `"recovery": "${fp}…"` : '"recovery": null').padEnd(28)} ` +
    `stranger's claim -> ${readerRule(list, [pub(mk('a stranger'))]) ? 'accepted' : 'refused'}`);
}
console.log(`
  One rule covers all four, because "nobody can vouch for me" is just the empty list, and "a code
  in my wallet" is a list with one entry that happens to be a key rather than a person. The reader
  does the same membership check every time and never needs to know which situation it is looking at.

  So recovery does not have to be social. It has to be NAMED IN ADVANCE. Who or what gets named is
  the user's business, and the introvert picks a printed code or their password manager — which is
  exactly what your notes already push to app-level backup.

--- Q2: how much can a voucher actually do? ---
`);

// Bob has got in — mum vouched for him by mistake, or he turned. What can he do next?
const damage = {
  'anything the key can do': { key: true, wherSheLives: true, whoMayVouchNext: true, herName: true },
  'only the key':            { key: true, wherSheLives: false, whoMayVouchNext: false, herName: false },
};
for (const [rule, can] of Object.entries(damage)) {
  console.log(`  recovery may change: ${rule}`);
  console.log(`     he can post as her                       ${can.key ? 'yes' : 'no'}`);
  console.log(`     he can move her to a host he owns         ${can.wherSheLives ? 'YES — her family follows him and never sees her again' : 'no — her readers still look where she said'}`);
  console.log(`     he can replace the list of who may vouch  ${can.whoMayVouchNext ? 'YES — she can never take it back, ever' : 'no — her mother and sister can undo this'}`);
  console.log(`     he can change her display name            ${can.herName ? 'yes' : 'no'}\n`);
}
console.log(`  The second row is one sentence and it changes the attack from permanent to temporary.
  Taking someone's identity is bad; taking it in a way they can never claw back is a different
  thing entirely, and the difference is whether the takeover is allowed to rewrite the door locks.

--- Q3: who does a waiting period actually protect? (I got this wrong first time) ---
`);
const cases = [
  ['Grandma really did lose her phone', false, 'nobody objects, so after the wait the new key is hers. She waited.'],
  ['Bob fakes a recovery for Alice',    true,  'Alice STILL HAS HER KEY — she is not recovering, she is being attacked. She objects, and everyone sees "contested".'],
  ['Bob fakes it while Alice is also genuinely locked out', false, 'nobody can object. The wait buys nothing. This is the rare case.'],
];
for (const [what, canObject, outcome] of cases) console.log(`  ${what.padEnd(58)} ${canObject ? 'she can object' : 'she cannot   '}  ->  ${outcome}`);
console.log(`
  I dismissed this last time by saying it only helps someone who still holds their key. That is
  true and it is the wrong way round: the person who still holds their key is exactly the VICTIM
  of a fake recovery. The waiting period does not protect the person recovering. It protects
  everyone who is NOT recovering from having a recovery declared on their behalf.

  Its real price is the middle column of Grandma's row: she waits.
`);
