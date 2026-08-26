// An ActivityPub Actor derived from an Open Feed profile.
//
// The Actor's publicKey is the BRIDGE's key, not the identity's. This decouples AP from
// Open Feed key rotation: the bridge re-reads the updated identity and the AP Actor is
// unchanged. The bridge is the AP identity, backed by the Open Feed identity.
//
// Uses RSA-2048 for the AP key because Mastodon's legacy publicKey field requires RSA.
// Ed25519 in that field was tried against mastodon.social and is rejected *silently* — no error
// anywhere, the Actor just never verifies. Ed25519 support (FEP-521a assertionMethod/Multikey)
// would avoid RSA but only works with Mastodon 4.7+ — RSA works everywhere.
import crypto from 'node:crypto';

const AP_CONTEXT = ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1'];

export function publicKeyPem(bridgeKey) {
  if (bridgeKey.publicKeyPem) return bridgeKey.publicKeyPem;
  const key = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: bridgeKey.x }, format: 'jwk' });
  return key.export({ type: 'spki', format: 'pem' });
}

export function newBridgeKey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return { privateKey: crypto.createPrivateKey(privateKey), publicKeyPem: publicKey };
}

export function actor(read, bridgeOrigin, bridgeKey) {
  const name = read.name ?? 'unknown';
  const id = `${bridgeOrigin}/users/${name}`;
  return {
    '@context': AP_CONTEXT,
    id,
    type: 'Person',
    preferredUsername: name,
    name,
    inbox: `${id}/inbox`,
    outbox: `${id}/outbox`,
    followers: `${id}/followers`,
    url: `${id}`,
    summary: '',
    publicKey: {
      id: `${id}#main-key`,
      owner: id,
      publicKeyPem: publicKeyPem(bridgeKey),
    },
  };
}
