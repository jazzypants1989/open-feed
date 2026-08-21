// Decision 2 — "you can always leave, because the copy was always on your device."
// What happens when the app tidied up and the host stops cooperating.
import crypto from 'node:crypto';

const alice = crypto.generateKeyPairSync('ed25519');
const stamp = (post) => ({ ...post, stamp: crypto.sign(null, Buffer.from(JSON.stringify(post)), alice.privateKey).toString('base64url') });
const checks = (post) => { const { stamp: s, ...rest } = post; return crypto.verify(null, Buffer.from(JSON.stringify(rest)), alice.publicKey, Buffer.from(s, 'base64url')); };

const posts = ['first day of school', 'the dog got out again', 'hospital, everything is fine',
               'her first word', 'christmas at the lake'].map((body, i) => stamp({ n: i + 1, body }));

// Three places the same bytes can sit. Note they are the SAME bytes everywhere — a post is signed
// once, by Alice, and stays valid no matter whose disk it is sitting on.
const world = {
  phone:      [...posts],   // her app kept what it published
  exsServer:  [...posts],   // the host's copy
  momsPhone:  [...posts],   // her mother read them, so her app has them too
};

const tidyUp = () => { world.phone = []; };                 // the app freed up space after upload
const divorce = () => { world.exsServer = []; };            // he deletes them, or just stops serving

const moveToNewHost = (source) => {
  const carried = world[source].filter(checks);
  return { from: source, arrivedWith: carried.length, of: posts.length };
};

const show = (label, r) => console.log(`  ${label.padEnd(46)} she arrives with ${r.arrivedWith} of ${r.of} posts`);

console.log('\nAlice leaves. What does she take with her?\n');
show('app kept its copy (what the notes assume)', moveToNewHost('phone'));
tidyUp();
divorce();
show('app tidied up, then he pulled the plug', moveToNewHost('phone'));
show('...but she asks her mother for them', moveToNewHost('momsPhone'));

console.log(`
Her key is fine in all three rows. She can stand up a new home, keep her name, and her family can
follow her there with one tap. Row 2 is her arriving at that new home with an empty shelf.

Row 3 is the part worth noticing, and it is not in the review. A post is stamped once, by Alice,
and the stamp keeps checking out no matter whose disk the bytes are sitting on. So her mother —
who has been reading all along — can hand the whole archive back, and every post still verifies as
Alice's. Her family is a backup nobody set up on purpose.

What row 3 does NOT cover: anything her mother could not see, and there is no way to know whether
what comes back is everything. It is a real fallback, not a guarantee.
`);
