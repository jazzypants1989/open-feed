// Persistent state for a long-running bridge: keys, hub files, followers.
//
// A bridge that federates cannot be ephemeral. A remote instance caches the AP Actor's public key
// and keeps using it; if the process restarts with a fresh key, every signature the bridge sends is
// rejected against the key the other side still holds, and there is nothing to do but wait out its
// cache. So the three keys — the Open Feed signing key, the RSA bridge key, the Nostr key — are
// generated once and read back on every later boot, and the hub's files and the follower list with
// them.
//
// Nothing here is required by the spec: a hub store is "a Map-like of path → Buffer" (§8) and this
// is one that happens to survive a reboot.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { signingKeyFromSeed } from '../src/file.js';
// The hub's own persistent store lives with the hub (§8); the keys and followers below are the
// bridge's, and are not a protocol concern.
export { fileStore } from '../src/hub.js';
import { schnorrPubkey } from './schnorr.js';

const write = (file, data) => {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, file);                                   // atomic: a torn write loses the identity
};
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

/**
 * The three keys, generated on first boot and read back on every later one.
 * Shapes match `newSigningKey` (§2), `newBridgeKey` (bridge/actor.js) and `newNostrKey` (bridge/schnorr.js).
 */
export function loadKeys(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'keys.json');
  let stored = readJson(file);

  if (!stored) {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    stored = {
      seed: crypto.randomBytes(32).toString('base64'),        // the Open Feed anchor key (§3)
      rsa: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      nostr: crypto.randomBytes(32).toString('base64'),
    };
    write(file, JSON.stringify(stored, null, 1));
  }
  fs.chmodSync(file, 0o600);                                  // owner only, on every boot, not just the first

  const rsa = crypto.createPrivateKey(stored.rsa);
  const nostrPriv = Buffer.from(stored.nostr, 'base64');
  return {
    key: signingKeyFromSeed(Buffer.from(stored.seed, 'base64')),
    bridgeKey: { privateKey: rsa, publicKeyPem: crypto.createPublicKey(rsa).export({ type: 'spki', format: 'pem' }) },
    nostrKey: { privateKey: nostrPriv, pubkey: schnorrPubkey(nostrPriv).toString('hex') },
  };
}

/** Followers are the remote side's state as much as ours — losing them silently unfollows everyone. */
export function loadFollowers(dir) {
  return readJson(path.join(dir, 'followers.json')) ?? {};
}

export function saveFollowers(dir, followers) {
  fs.mkdirSync(dir, { recursive: true });
  write(path.join(dir, 'followers.json'), JSON.stringify(followers, null, 1));
}
