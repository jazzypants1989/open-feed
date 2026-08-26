// HTTP Signatures for ActivityPub delivery (draft-cavage-http-signatures).
// Signs with RSA-SHA256 for broadest fediverse compatibility.
import crypto from 'node:crypto';

export function sign(request, keyId, privateKey) {
  const { method, url, headers, body } = request;
  const target = new URL(url);
  const date = headers.date ?? new Date().toUTCString();
  const digest = body ? `SHA-256=${crypto.createHash('sha256').update(body).digest('base64')}` : null;
  const host = target.host;

  const signed = ['(request-target)', 'host', 'date'];
  if (digest) signed.push('digest');

  const lines = signed.map(h => {
    if (h === '(request-target)') return `(request-target): ${method.toLowerCase()} ${target.pathname}`;
    if (h === 'host') return `host: ${host}`;
    if (h === 'date') return `date: ${date}`;
    if (h === 'digest') return `digest: ${digest}`;
    return `${h}: ${headers[h]}`;
  });

  const signingString = lines.join('\n');
  const signature = crypto.sign('SHA256', Buffer.from(signingString), privateKey).toString('base64');

  return {
    ...headers,
    date,
    host,
    ...(digest ? { digest } : {}),
    signature: `keyId="${keyId}",algorithm="rsa-sha256",headers="${signed.join(' ')}",signature="${signature}"`,
  };
}

export function verify(request, publicKeyPem) {
  const sigHeader = request.headers.signature;
  if (!sigHeader) return false;

  const parts = {};
  for (const part of sigHeader.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim().replace(/^"|"$/g, '');
    parts[k] = v;
  }

  const headers = (parts.headers ?? '').split(' ');
  const lines = headers.map(h => {
    if (h === '(request-target)') return `(request-target): ${request.method.toLowerCase()} ${new URL(request.url).pathname}`;
    return `${h}: ${request.headers[h]}`;
  });

  const signingString = lines.join('\n');
  const key = crypto.createPublicKey(publicKeyPem);
  return crypto.verify('SHA256', Buffer.from(signingString), key, Buffer.from(parts.signature, 'base64'));
}
