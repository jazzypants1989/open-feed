// Shared model for the Open Feed 2 candidate gates: compact-JWS events (encoded payload,
// RFC 7515 without RFC 7797), content-addressed tokens, the fold, and checkpoints.
// CANDIDATE code — it tests a design on trial and imports src/ only for primitives
// (Ed25519, hashing, I-JSON parse) whose behavior both designs share.
import crypto from 'node:crypto';
import { parseIJSON } from '../../../src/canonical.js';
import { sha256, b64u } from '../../../src/hash.js';

export class GateError extends Error {}

// Strict base64url (RFC 4648 §5, no padding, canonical spelling): the one spelling rule the
// candidates keep from §5.1, because bytes-are-identity designs are frameable through decoder
// leniency — a lenient decoder reads two spellings as one signature while the file bytes differ.
export function b64uStrict(seg, what = 'segment') {
  if (typeof seg !== 'string' || seg.length === 0 || /[^A-Za-z0-9_-]/.test(seg)) {
    throw new GateError(`${what}: not base64url`);
  }
  const buf = Buffer.from(seg, 'base64url');
  if (buf.toString('base64url') !== seg) throw new GateError(`${what}: non-canonical base64url spelling`);
  return buf;
}

export function makeKey(kid) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const { x } = publicKey.export({ format: 'jwk' });
  return { kid, x, privateKey, publicKey };
}

// The producer serializes its payload ONCE; nobody ever re-serializes it. Key order, spacing,
// and unicode form are whatever the producer emitted — the token's bytes are the identity.
export function signEvent(payload, { privateKey, kid }, { payloadText } = {}) {
  const header = { alg: 'EdDSA', kid, typ: 'of2-event' };
  const h = b64u(Buffer.from(JSON.stringify(header), 'utf8'));
  const p = b64u(Buffer.from(payloadText ?? JSON.stringify(payload), 'utf8'));
  const sig = crypto.sign(null, Buffer.from(`${h}.${p}`, 'ascii'), privateKey);
  return `${h}.${p}.${b64u(sig)}`;
}

// The one hashing rule: base64url SHA-256 of the token's bytes as served.
export const eventId = (token) => b64u(sha256(Buffer.from(token, 'utf8')));

// Verification never re-serializes anything: the signature is checked over the token's own
// bytes, and the payload is parsed only to be READ. parseIJSON carries the two hygiene
// rejections the candidates keep (duplicate members, __proto__) plus lone surrogates and
// out-of-range integer tokens — all semantic-divergence hygiene, not signature integrity.
export function verifyEvent(token, resolvePublicKey) {
  if (typeof token !== 'string' || /\s/.test(token)) throw new GateError('event: not a single token');
  const segs = token.split('.');
  if (segs.length !== 3) throw new GateError('event: not three segments');
  const [h, p, s] = segs;
  const headerBytes = b64uStrict(h, 'header');
  const payloadBytes = b64uStrict(p, 'payload');
  const sigBytes = b64uStrict(s, 'signature');
  const header = parseIJSON(headerBytes.toString('utf8'));
  if (header.alg !== 'EdDSA' || header.typ !== 'of2-event' || typeof header.kid !== 'string') {
    throw new GateError('event: bad header');
  }
  const publicKey = resolvePublicKey(header.kid);
  if (!publicKey) throw new GateError(`event: unresolvable kid ${header.kid}`);
  if (!crypto.verify(null, Buffer.from(`${h}.${p}`, 'ascii'), publicKey, sigBytes)) {
    throw new GateError('event: signature invalid');
  }
  return { header, payload: parseIJSON(payloadBytes.toString('utf8')) };
}

// ---- the fold ----
// The live set is DEFINED by the fold; there is no removal operation but `delete`, so the old
// §9.3 invariant 1 has no violation to check. What IS checked per hop is O(1) each.
export function newState() {
  return { live: new Map(), deleted: new Map(), lastSeq: 0, lastTs: 0 };
}

export function foldHop(state, payload, id) {
  if (payload.seq !== state.lastSeq + 1) throw new GateError(`seq ${payload.seq} is not ${state.lastSeq + 1}: not contiguous`);
  if (payload.ts < state.lastTs) throw new GateError(`ts walked backward at seq ${payload.seq}`);
  switch (payload.type) {
    case 'post': {
      if (state.deleted.has(payload.id)) throw new GateError(`resurrection: ${payload.id} was deleted`);
      if (state.live.has(payload.id)) throw new GateError(`post reuses live id ${payload.id}`);
      state.live.set(payload.id, { version: 1, blob: payload.blob, event: id });
      break;
    }
    case 'edit': {
      const cur = state.live.get(payload.id);
      if (!cur) throw new GateError(`edit of nonexistent id ${payload.id}`);
      if (payload.version !== cur.version + 1) throw new GateError(`version ${payload.version} of ${payload.id} does not increment ${cur.version}`);
      state.live.set(payload.id, { version: payload.version, blob: payload.blob, event: id });
      break;
    }
    case 'delete': {
      const cur = state.live.get(payload.id);
      if (!cur) throw new GateError(`delete of nonexistent id ${payload.id}`);
      state.live.delete(payload.id);
      state.deleted.set(payload.id, cur.version + 1);
      break;
    }
    default: break; // genesis / key / profile / checkpoint advance the chain, not the content maps
  }
  state.lastSeq = payload.seq;
  state.lastTs = payload.ts;
  return state;
}

// A checkpoint's state blob: an ordinary content-addressed file; its bytes ARE the file.
export function stateBlob(state, { prevCheckpoint = null, prevState = null } = {}) {
  const bytes = Buffer.from(JSON.stringify({
    live: Object.fromEntries([...state.live].map(([id, v]) => [id, [v.version, v.blob]])),
    deleted: Object.fromEntries(state.deleted),
    ...(prevCheckpoint ? { prev_checkpoint: prevCheckpoint } : {}),
    ...(prevState ? { prev_state: prevState } : {}),
  }), 'utf8');
  return { bytes, hash: b64u(sha256(bytes)) };
}

// The any-two-checkpoints diff: every id in the older state must appear in the newer one, in
// `live` at the same-or-higher version or in `deleted` — one map comparison, never a fold.
export function checkpointDiffViolations(oldState, newState_) {
  const out = [];
  for (const [id, ver] of Object.entries(oldState.live)) {
    const now = newState_.live[id];
    if (now && now[0] >= ver[0]) continue;
    if (now && now[0] < ver[0]) { out.push(`version rollback: ${id} ${ver[0]} -> ${now[0]}`); continue; }
    if (id in newState_.deleted) continue;
    out.push(`silent vanish: ${id}`);
  }
  for (const [id] of Object.entries(oldState.deleted)) {
    if (id in newState_.live) out.push(`resurrection: ${id}`);
  }
  return out;
}
