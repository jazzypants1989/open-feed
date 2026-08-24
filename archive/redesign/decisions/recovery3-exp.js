// Decision 6, third pass: ways to prove it is really you, scored on two numbers.
//   A) how long is Grandma locked out?   B) how long can Bob post as her?
const DAY = 'days';
const approaches = [
  { name: 'a key she kept (code, passkey, keychain)',
    grandma: 'not locked out — she proves it herself, on the spot',
    bob:     'never gets in: he does not have the code',
    catch:   'only works if she kept something. Not everyone will.' },

  { name: 'other people vouch, effective at once, no mark',
    grandma: 'back the same afternoon',
    bob:     'FOREVER — nothing is displayed, so nobody looks',
    catch:   'this is the current design, and it is the hole.' },

  { name: 'other people vouch, effective at once, permanently marked',
    grandma: 'back the same afternoon',
    bob:     `until someone reads the mark and phones her — ${DAY}, not minutes`,
    catch:   'her account carries "restored on 3 Jan, vouched by Bob" from then on, and her objection never expires.' },

  { name: 'other people vouch, after a 7-day wait',
    grandma: 'locked out for a week',
    bob:     'never gets in — she objects during the week',
    catch:   'the week is real, and it lands on the person who did nothing wrong.' },
];

console.log('\nFour ways to prove a new key is really you\n');
for (const a of approaches) {
  console.log(`  ${a.name}`);
  console.log(`     Grandma, who really lost her phone : ${a.grandma}`);
  console.log(`     Bob, faking it for Alice           : ${a.bob}`);
  console.log(`     catch                              : ${a.catch}\n`);
}

console.log(`The thing worth noticing: rows 1 and 4 are not competing. They answer different people.

  If you kept something — a code in your wallet, a passkey in your phone's cloud backup — you PROVE
  it directly by signing with it, and there is nothing to wait for and nobody to ask.

  The wait only ever applies to the other path, where you have nothing and other people have to
  speak for you. So most people never wait. The wait is the fallback for someone who kept nothing
  and has to lean on their family, which is exactly the case where a stranger's say-so is all the
  protocol has to go on.

That leaves the real question as row 3 versus row 4: let a vouched restore happen at once and mark
it forever, or make it wait a week and let the old key object.
`);
