// Gate for tmp/prototypes/enctags.md — §15.2's envelope, checked against the shipped `src/enc.js`.
import crypto from 'node:crypto';

import { seal, open, slotTag, TAG_LABEL, encryptionKeyFor, EncError } from '../../src/enc.js';

const T0 = 1736899200;

function recipient(i) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
  const { x } = publicKey.export({ format: 'jwk' });
  return {
    priv: privateKey,
    document: {
      url: `https://r${i}.example/`, seq: 1, updated: T0,
      keys: [{ crv: 'X25519', iat: T0, kid: 'enc-1', kty: 'OKP', use: 'enc', x }],
    },
  };
}

const audience = Array.from({ length: 6 }, (_, i) => recipient(i));
const outsider = recipient(99);

const carrier = {
  id: 'urn:uuid:9d1f0a2b-3c4d-4e5f-8091-a2b3c4d5e6f7',
  authors: [{ url: 'https://author.example/' }],
  _openfeed: { feed_url: 'https://author.example/feed.json', version: 1 },
  content_text: '',
  date_published: '2025-02-20T12:00:00Z',
};
const sealOnce = () => seal({
  item: carrier,
  content: { content_text: 'The grandkids came over.' },
  recipients: audience.map((r) => r.document),
});

const envelope = sealOnce();
const sealed = { ...carrier, _openfeed: { ...carrier._openfeed, enc: envelope } };

const header = JSON.parse(Buffer.from(envelope.protected, 'base64url').toString('utf8'));
const sharedEpk = typeof header?.epk?.x === 'string';
const slotEpks = envelope.recipients.filter((r) => r.header.epk !== undefined).length;
const slotTags = envelope.recipients.filter((r) => typeof r.header._tag === 'string').length;
const slotKids = envelope.recipients.filter((r) => r.header.kid !== undefined).length;

// Recipient 3 reproduces its own tag from its private half and the one shared epk.
const epkPub = crypto.createPublicKey({
  key: { kty: 'OKP', crv: 'X25519', x: header.epk.x }, format: 'jwk',
});
const mine = slotTag(crypto.diffieHellman({ privateKey: audience[3].priv, publicKey: epkPub }));
const tagFound = envelope.recipients.some((r) => r.header._tag === mine);

// Same audience sealed twice: a repeated tag would relink a recipient across items.
const again = sealOnce();
const tagsRelink = envelope.recipients.some((r) => again.recipients.some((s) => s.header._tag === r.header._tag));

const wire = JSON.stringify(envelope);
const noRoster = audience.every((r) => !wire.includes(r.document.url));

let opens = false;
try {
  opens = open(sealed, { privateKeys: [audience[3].priv] }).content_text === 'The grandkids came over.';
} catch { /* stays false */ }
let shuts = false;
try { open(sealed, { privateKeys: [outsider.priv] }); }
catch (e) { shuts = e instanceof EncError; }

// A slot smuggling a `kid` back in must be refused at open, not silently tolerated.
const single = seal({ item: carrier, content: { content_text: 'x' }, recipients: [audience[0].document] });
single.recipients[0].header.kid = 'enc-1';
let kidRefused = false;
try { open({ ...carrier, _openfeed: { ...carrier._openfeed, enc: single } }, { privateKeys: [audience[0].priv] }); }
catch (e) { kidRefused = e instanceof EncError && e.message.includes('kid'); }

let revokedRefused = false;
try {
  encryptionKeyFor({
    url: 'https://retired.example/',
    keys: [{ ...audience[0].document.keys[0], revoked_at: T0 + 1 }],
  }, { now: T0 + 2 });
} catch (e) { revokedRefused = e instanceof EncError; }

const gate = [
  ['the shipped envelope carries one shared `epk` in the protected header and none per slot',
    sharedEpk && slotEpks === 0],
  ['every slot carries a `_tag` and no slot carries a `kid` (§15.2)',
    slotTags === envelope.recipients.length && slotKids === 0],
  ["the tag's domain separator is the wire constant `openfeed-slot-tag`", TAG_LABEL === 'openfeed-slot-tag'],
  ['a recipient finds its slot by computing `slotTag` from its own private half', tagFound],
  ['tags do not relink a recipient across two items (the property banning `kid` protected)',
    tagsRelink === false],
  ['the recipient list appears nowhere on the wire', noRoster],
  ['the envelope opens for a recipient and refuses an outsider', opens && shuts],
  ['a slot smuggling a `kid` is refused at open (§15.2 MUST NOT)', kidRefused],
  ['§15.1: a revoked encryption key is refused to a new sender', revokedRefused],
];

const failed = gate.filter(([, ok]) => !ok);
for (const [what, ok] of gate) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
if (failed.length) process.exit(1);
console.log('enctags: all claims hold');
