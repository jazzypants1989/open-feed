// Decision 1 — the very first time Mom's phone looks up Alice.
// Alice lives on her ex-husband's server. He gets to write the file Mom downloads.
import crypto from 'node:crypto';

// A "key" is just a big random number the app makes when you install it. You get two halves:
// a private half that stays on the phone and stamps things, and a public half you hand out.
const newKey = (who) => { const k = crypto.generateKeyPairSync('ed25519'); k.who = who; return k; };
const publicHalf = (k) => k.publicKey.export({ format: 'jwk' }).x;

const stamp = (file, k) => ({ ...file, stamp: crypto.sign(null, Buffer.from(JSON.stringify(file)), k.privateKey).toString('base64url') });
const stampChecksOut = (file, publicHalfToCheckAgainst) => {
  const { stamp: s, ...rest } = file;
  try {
    const key = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicHalfToCheckAgainst }, format: 'jwk' });
    return crypto.verify(null, Buffer.from(JSON.stringify(rest)), key, Buffer.from(s, 'base64url'));
  } catch { return false; }
};

const alice = newKey('Alice');
const ex = newKey('the ex-husband');

// The file Mom downloads. It says who you are and shows your public half, and it is stamped.
const profileFile = (k) => stamp({ address: 'family.example/alice', name: 'Alice', publicHalf: publicHalf(k) }, k);

const honestServer = () => profileFile(alice);           // what an honest host serves
const exsServer    = () => profileFile(ex);              // same name, same address, HIS key

// A short code a person can read out loud. Five syllables standing in for the key.
const words = ['marble', 'violet', 'ember', 'cedar', 'quartz', 'harbor', 'lantern', 'thistle', 'copper', 'meadow'];
const spokenCode = (publicHalfValue) => {
  const h = crypto.createHash('sha256').update(Buffer.from(publicHalfValue, 'base64url')).digest();
  return `${words[h[0] % 10]}-${words[h[1] % 10]}-${String(h[2]).padStart(2, '0')}`;
};

function momLooksUpAlice(howSheChecks, whichServer, whatSheWasToldInAdvance) {
  const file = whichServer();
  if (!stampChecksOut(file, file.publicHalf)) return 'refuse: the stamp does not match the file';
  if (howSheChecks === 'nothing')  return `ACCEPT and remember this key forever`;
  if (howSheChecks === 'link')     return file.publicHalf === whatSheWasToldInAdvance ? 'accept: matches the key in the link' : 'REFUSE: this is not the key in the link';
  if (howSheChecks === 'phonecall')return spokenCode(file.publicHalf) === whatSheWasToldInAdvance ? 'accept: the code matches' : `REFUSE: this reads "${spokenCode(file.publicHalf)}", Alice said "${whatSheWasToldInAdvance}"`;
}

console.log('\nThe first time Mom looks Alice up\n');
console.log(`Alice's real code, if she read it over the phone: "${spokenCode(publicHalf(alice))}"\n`);

const checks = [
  ['she checks nothing',              'nothing',   null],
  ['Alice texted her a link',         'link',      publicHalf(alice)],
  ['Alice read her a code by phone',  'phonecall', spokenCode(publicHalf(alice))],
];
for (const [label, how, told] of checks) {
  console.log(`  ${label}`);
  console.log(`     honest host   : ${momLooksUpAlice(how, honestServer, told)}`);
  console.log(`     the ex's host : ${momLooksUpAlice(how, exsServer, told)}\n`);
}

console.log(`What just happened, in one paragraph:

The ex's file is not broken, forged, or malformed. It passes every check a computer can do on its
own, because the stamp on it was made by the key printed inside it, and he chose both. It is an
ID card he printed himself, with his photo, in her name. Mom's phone has nothing to compare it to,
so it says yes, and from that moment on everything he writes really is Alice as far as she is
concerned. She will never get a warning, because nothing is ever inconsistent again.

The only thing that changes the answer is Mom knowing something about Alice's key BEFORE she asks
his server — and learning it by a route he does not control. A text message. A code read out loud.
A square barcode scanned across the dinner table. Any of those, and his file gets refused.
`);
