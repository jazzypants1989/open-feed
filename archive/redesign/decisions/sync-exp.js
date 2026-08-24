// Decision 2, option 2 — what "publishing means syncing my copy up" actually costs.
// Two ways of defining the write, same three events.
import crypto from 'node:crypto';

const alice = crypto.generateKeyPairSync('ed25519');
const stamp = (p) => ({ ...p, stamp: crypto.sign(null, Buffer.from(JSON.stringify(p)), alice.privateKey).toString('base64url') });
const all = ['first day of school', 'dog got out', 'hospital', 'her first word', 'christmas'].map((b, i) => stamp({ n: i + 1, body: b }));

// Alice's two devices. The laptop is new: she set it up in December, so it only has the last two.
const devices = () => ({ phone: [...all], laptop: all.slice(3) });
const newPost = stamp({ n: 6, body: 'we found a house' });

// Two definitions of what "publish" means.
const handUpOneFile = (host, device, post) => [...host, post];
const syncMyCopyUp  = (host, device, post) => [...device, post];      // the host mirrors the device

const run = (label, publish) => {
  const host = [...all];
  const d = devices();
  const after = publish(host, d.laptop, newPost);
  const lost = all.filter((p) => !after.some((q) => q.n === p.n)).map((p) => p.n);
  console.log(`  ${label.padEnd(34)} host holds ${String(after.length).padStart(2)} posts` +
    (lost.length ? `   LOST: ${lost.map((n) => '#' + n).join(', ')}` : '   nothing lost'));
};

console.log('\nAlice posts from her laptop. Her phone has everything; the laptop has the last two.\n');
run('"hand up one file"', handUpOneFile);
run('"sync my copy up"',  syncMyCopyUp);

console.log(`
And here is the part that makes it worse rather than merely sad: her mother already read posts
1, 2 and 3. They now disappear from the host with no note saying they were deleted. Every
completeness rule you are considering reads that as the HOST withholding her words — so the
protocol's response to Alice using her own laptop is to accuse her ex of censorship.

Two more things "sync my copy up" rules out:

  a borrowed laptop, web client, no local store   ->  cannot publish at all: it has no copy to sync
  a scheduled post handed over to be released     ->  it is not part of "my copy right now"

  A thin client is a real thing you want to keep — it is someone posting a photo from a friend's
  computer, and it is also the simplest possible second implementation.
`);
