// A self-signed certificate, built here because there is no other way to test the real thing.
//
// §3.7 says an identity URL is HTTPS, and every layer enforces it: `normalizeIdentityUrl`
// refuses anything else, so a `kid` cannot name a plaintext identity and an item published
// under one would not verify. That is correct, and it means an end-to-end test either runs
// over TLS or does not run over the transport the protocol actually specifies.
//
// Node's `crypto` parses X.509 and does not issue it, and this repo has no dependencies, so
// the certificate is encoded by hand. It is ~70 lines of DER because a minimal certificate is
// a small structure: the only fields that matter here are the subject alternative names, which
// are what let the test reach `https://mom.example:PORT/` and have validation pass.
//
// Ed25519 throughout, which the protocol already requires everywhere else (§6.2).

import crypto from 'node:crypto';

const tag = (t, body) => {
  const len = body.length;
  if (len < 0x80) return Buffer.concat([Buffer.from([t, len]), body]);
  const size = Buffer.from(len.toString(16).padStart(len > 0xffff ? 6 : len > 0xff ? 4 : 2, '0'), 'hex');
  return Buffer.concat([Buffer.from([t, 0x80 | size.length]), size, body]);
};

const SEQUENCE = (...parts) => tag(0x30, Buffer.concat(parts));
const SET = (...parts) => tag(0x31, Buffer.concat(parts));
const INTEGER = (bytes) => tag(0x02, bytes[0] & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes);
const UTF8String = (s) => tag(0x0c, Buffer.from(s, 'utf8'));
const UTCTime = (s) => tag(0x17, Buffer.from(s, 'ascii'));
const BITSTRING = (bytes) => tag(0x03, Buffer.concat([Buffer.from([0]), bytes]));
const OCTETSTRING = (bytes) => tag(0x04, bytes);
const explicit = (n, body) => tag(0xa0 | n, body);

const OID = {
  ed25519: Buffer.from('06032b6570', 'hex'),   // 1.3.101.112
  commonName: Buffer.from('0603550403', 'hex'), // 2.5.4.3
  subjectAltName: Buffer.from('0603551d11', 'hex'), // 2.5.29.17
};

const AlgorithmIdentifier = SEQUENCE(OID.ed25519);
const Name = (cn) => SEQUENCE(SET(SEQUENCE(OID.commonName, UTF8String(cn))));

const utc = (date) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(date.getUTCFullYear() % 100)}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}`
    + `${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
};

/**
 * `names` are subject alternative names: a string is a dNSName, and a dotted quad is an
 * iPAddress. A certificate without them validates against nothing modern.
 */
function subjectAltName(names) {
  const generalNames = names.map((name) => (
    /^\d+\.\d+\.\d+\.\d+$/.test(name)
      ? tag(0x87, Buffer.from(name.split('.').map(Number)))   // [7] iPAddress
      : tag(0x82, Buffer.from(name, 'ascii'))                 // [2] dNSName
  ));
  return SEQUENCE(OID.subjectAltName, OCTETSTRING(SEQUENCE(Buffer.concat(generalNames))));
}

/**
 * A self-signed Ed25519 certificate valid for the given names.
 *
 * Returns PEM key and cert, plus the DER, so a test can hand the certificate to a fetcher as a
 * pinned CA rather than turning certificate validation off — which would quietly stop testing
 * TLS validation in the one place it could be tested.
 */
export function selfSignedCertificate(names, { commonName = names[0], days = 1 } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' });

  const now = new Date();
  const tbs = SEQUENCE(
    explicit(0, INTEGER(Buffer.from([2]))),                 // v3
    INTEGER(crypto.randomBytes(8)),                          // serial
    AlgorithmIdentifier,
    Name(commonName),                                        // issuer == subject: self-signed
    SEQUENCE(
      UTCTime(utc(new Date(now.getTime() - 60_000))),
      UTCTime(utc(new Date(now.getTime() + days * 86400_000))),
    ),
    Name(commonName),
    spki,
    explicit(3, SEQUENCE(subjectAltName(names))),
  );

  const certificate = SEQUENCE(tbs, AlgorithmIdentifier, BITSTRING(crypto.sign(null, tbs, privateKey)));
  const pem = (label, der) => `-----BEGIN ${label}-----\n${der.toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n$/, '')}\n-----END ${label}-----\n`;

  return {
    key: privateKey.export({ format: 'pem', type: 'pkcs8' }),
    cert: pem('CERTIFICATE', certificate),
    der: certificate,
  };
}
