// DID:PLC creation for AT Protocol. P-256 keys (native in Node's crypto).
// Creates the genesis operation, signs it, and derives the DID.
import crypto from 'node:crypto';
import { encode as dagCbor } from './dag-cbor.js';
import { encode as base32 } from './base32.js';
import { encode as base58btc } from './base58.js';

export function newP256Key() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    publicKeyEncoding: { type: 'spki', format: 'der' },
  });
  return { privateKey, publicKey };
}

export function p256DidKey(publicKeyDer) {
  const spki = crypto.createPublicKey({ key: publicKeyDer, format: 'der', type: 'spki' });
  const jwk = spki.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');
  const compressed = Buffer.concat([Buffer.from([y[y.length - 1] % 2 === 0 ? 0x02 : 0x03]), x]);
  // did:key multicodec: 0x1200 = P-256 public key
  const multicodec = Buffer.concat([Buffer.from([0x80, 0x24]), compressed]);
  return `did:key:z${base58btc(multicodec)}`;
}

function signOperation(operation, privateKeyDer) {
  const cbor = dagCbor(operation);
  const key = crypto.createPrivateKey({ key: privateKeyDer, format: 'der', type: 'pkcs8' });
  const sig = crypto.sign('SHA256', cbor, { key, dsaEncoding: 'ieee-p1363' });
  return sig.toString('base64url');
}

/** The DID is the first 120 bits of the SHA-256 of the signed genesis operation, base32'd. */
export function didFromOperation(signedOp) {
  const hash = crypto.createHash('sha256').update(dagCbor(signedOp)).digest();
  return `did:plc:${base32(hash.subarray(0, 15)).slice(0, 24)}`;
}

export function createGenesisOperation({ handle, pdsEndpoint, rotationKey, signingKey }) {
  const rotationDidKey = p256DidKey(rotationKey.publicKey);
  const signingDidKey = p256DidKey(signingKey.publicKey);

  const unsignedOp = {
    type: 'plc_operation',
    rotationKeys: [rotationDidKey],
    verificationMethods: { atproto: signingDidKey },
    alsoKnownAs: [`at://${handle}`],
    services: { atproto_pds: { type: 'AtprotoPersonalDataServer', endpoint: pdsEndpoint } },
    prev: null,
  };

  const sig = signOperation(unsignedOp, rotationKey.privateKey);
  const signedOp = { ...unsignedOp, sig };

  return { did: didFromOperation(signedOp), operation: signedOp };
}

export async function publishDid({ did, operation }, fetchFn = fetch) {
  const res = await fetchFn(`https://plc.directory/${did}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(operation),
  });
  return { ok: res.ok, status: res.status };
}
