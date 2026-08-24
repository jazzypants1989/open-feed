// Brief F — "tell Grandma I'm leaving" with the ex owning Alice's hub.
// Four options: pull-only unlisted item, glm's dead-drop box, kimi's narrow push, minimax's inbox.
// Tracks two things: does it ARRIVE, and what does the hostile hub OBSERVE.
const hub = { name: 'family.example (the ex)', log: [] };
const observe = (s) => hub.log.push(s);

const options = {
  '1 unlisted item on own hub': () => {
    observe('a write from Alice, ~1.4 KB, encrypted, at 21:04');
    observe('a GET of that exact path from Grandma\'s IP, 3 h later');
    // The ex owns the path. He does not have to read it to defeat it.
    const delivered = false;                                  // he declines to serve it
    return { delivered, note: 'he need not decrypt: withholding the path is enough, and the write itself told him a private message exists' };
  },
  '2 dead-drop box (glm)': () => {
    observe('nothing — the PUT went to grandma-chosen-box.net');
    return { delivered: true, note: 'the box host sees a blind PUT of ~1.4 KB from some IP to a random token; Alice\'s hub sees nothing at all' };
  },
  '3 narrow push (kimi)': () => {
    observe('nothing — the POST went device -> Grandma\'s hub');
    return { delivered: true, note: 'Grandma\'s hub learns an envelope arrived for her, from some IP; needs the IP-then-author rate ladder' };
  },
  '4 mandatory inbox (minimax)': () => {
    observe('nothing outbound');
    return { delivered: true, note: 'same arrival, plus ordering, dedup, retention and spam rules — §10 regrown (~2,000 words vs ~1,000)' };
  },
};

console.log('\nBrief F — the covert outbound message, hostile hub in the path\n');
for (const [name, run] of Object.entries(options)) {
  hub.log = [];
  const { delivered, note } = run();
  console.log(`  ${name}`);
  console.log(`     arrives: ${delivered ? 'YES' : 'NO — the hub simply does not serve it'}`);
  console.log(`     the ex sees: ${hub.log.join(' | ')}`);
  console.log(`     ${note}\n`);
}
console.log(`  Reading: this is channel-gate's finding restated for the four shapes now on the table.
  Option 1 is GOALS.md as written, and it fails the one message the threat model is about — not
  because the ex can read it, but because every byte of Alice's outbound path is his. Options 2-4
  all move the outbound path off his hub; they differ only in who runs the receiving end and how
  much spec that costs. Option 2 is the cheapest of the three because the recipient's box is a
  dumb blob store with no protocol semantics — no ordering, no dedup, no delivery receipt.
  Run \`node tmp/redesign/gates/channel-gate.js\` for the measured version of the (1) vs (3) axis.
`);
