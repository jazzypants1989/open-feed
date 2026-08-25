// Revert-check the examples and their seeds: apply each recorded mutation, require the script that
// proves the rule to FAIL, restore the file. A script already red on the clean tree is not credited —
// a failing check proves nothing. The rows are the executable record of "break the thing, watch it
// fail"; a rule with no row here is a claim.
//
//   node tools/revert.js              # every row
//   node tools/revert.js court-gate   # one script's rows
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const M = [
  ['weekend-gate', 'examples/weekend-reader/weekend-reader.js',
    "if (!raw || raw.anchor !== learned) return bad('identity', 'not the identity this reader learned');",
    "if (!raw) return bad('identity', 'not the identity this reader learned');"],
  ['weekend-gate', 'examples/weekend-reader/weekend-reader.js',
    'let index = hf && openFile(hf, chain.current);',
    'let index = hf && openFile(hf, chain.keys);'],
  ['weekend-gate', 'examples/weekend-reader/weekend-reader.js',                    // §7.4 the address half; the `n` half is the weekend-reader row below
    "if (!post || post.address !== e.hash || post.obj.n !== n) return bad('host', `post ${n} is not what the index lists`);",
    "if (!post) return bad('host', `post ${n} is not what the index lists`);"],
  ['weekend-gate', 'examples/weekend-reader/weekend-reader.js',                    // §7.5 one line per person (this gate sees only the de-dup half)
    'if (t.n > seen.get(t.key).top && !out.includes(line)) out.push(line);',
    'out.push(line);'],
  ['weekend-gate', 'examples/weekend-reader/weekend-reader.js',
    'if (t.n <= seen.get(t.key).top) continue;                         // withdrawn, or superseded — quiet',
    'if (false) continue;'],
  ['weekend-gate', 'examples/weekend-reader/weekend-reader.js',
    'if (!refreshed.has(t.key)) {',
    'if (true) {'],
  ['gapless-gate', 'examples/weekend-reader/weekend-reader.js',
    "if (!Array.isArray(e) || e.length > 2 || (typeof e[0] !== 'number' && typeof e[0] !== 'string')) return null;",
    "if (!Array.isArray(e) || (typeof e[0] !== 'number' && typeof e[0] !== 'string')) return null;"],
  ['gapless-gate', 'examples/weekend-reader/weekend-reader.js',                    // §7.2 step 9 — the whole back-check; a `>=` slip is not staged on this side
    "if (typeof n !== 'number' || n > pin.top) continue;",
    'if (true) continue;'],
  ['gapless-gate', 'examples/_seeds/gapless-gate.js',                              // §8.5 — the seed's stand-in hub, not an implementation
    'if (this.owners(m[1], this.files.get(key), n) || !this.owners(m[1], b, n)) return { status: 409 };',
    'if (!this.owners(m[1], b, n)) return { status: 409 };'],
  ['court-gate', 'examples/weekend-reader/weekend-reader.js',
    'let i = raw.chain.findIndex((h, j) => j < pin.chain.length && pin.chain[j].key !== h.key);',
    'let i = -1;'],
  ['court-gate', 'examples/weekend-reader/weekend-reader.js',
    'if (i < 0 && raw.chain.length < pin.chain.length && raw.version > pin.profileVersion) i = raw.chain.length;',
    'if (false) i = raw.chain.length;'],
  ['court-gate', 'examples/weekend-reader/weekend-reader.js',
    'raw.chain.forEach((h, j) => { if (j >= from && h.recovery && !(j in recoveryLists)) recoveryLists[j] = h.recovery; }); if (raw.chain.length >= from) recoveryLists[raw.chain.length] ??= raw.recovery;',
    'raw.chain.forEach((h, j) => { if (h.recovery) recoveryLists[j] = h.recovery; }); recoveryLists[raw.chain.length] = raw.recovery;'],
  ['court-gate', 'examples/weekend-reader/weekend-reader.js',
    'if (!linkSig(from, link.key, from, link.sig) && !majority(from, link, recovery)) return null;',
    'if (!linkSig(from, link.key, from, link.sig) && !majority(from, link, link.recovery)) return null;'],
  ['court-gate', 'examples/weekend-reader/weekend-reader.js',
    'const majority = (from, link, recovery) => vouches(from, link, recovery) * 2 > (recovery?.leaves?.length ?? Infinity);',
    'const majority = (from, link, recovery) => vouches(from, link, recovery) >= 1;'],
  // The envelope moved to gates/envelope.js when the construction stopped being on trial; these
  // three rows follow it. They are the reason the move is safe: turn each rule off in its new home
  // and the gate that proved it still goes red.
  ['envelope-gate', 'examples/_seeds/envelope.js',
    'const bindAAD = (epk, carrier) => Buffer.concat([epk, Buffer.from(carrier)]);',
    'const bindAAD = (epk, carrier) => epk;'],
  ['envelope-gate', 'examples/_seeds/envelope.js',                                // §6.4 the floor is a SHOULD
    "export const POLICY = { pow2: { slotFloor: 1, bodyFloor: 32 }, floor: { slotFloor: 8, bodyFloor: 512 } };",
    "export const POLICY = { pow2: { slotFloor: 1, bodyFloor: 32 }, floor: { slotFloor: 1, bodyFloor: 32 } };"],
  ['envelope-gate', 'examples/_seeds/envelope.js',                                // §6.1 one ephemeral per message; §6.3's blinding is what the gate measures
    'const eph = ephemeral ?? xKey(`eph:${b64(crypto.randomBytes(8))}`);',
    "const eph = ephemeral ?? xKey('eph:fixed');"],
  ['twohubs-gate', 'examples/_seeds/twohubs-gate.js',                              // §5.4 — mutates the seed's own thread(); the weekend reader's §5.4 line is unobservable by any gate
    'p.target.n === 1 && p.target.hash === momRead.pin.live.get(1)',
    'p.target.n === 1'],
  ['twohubs-gate', 'examples/_seeds/twohubs-gate.js',
    'checkedKey = await readKeyOf(mom, momAfter.pin);',
    'checkedKey = await naiveReadKeyOf(mom);'],
  ['twohubs-gate', 'examples/weekend-reader/weekend-reader.js',                    // §7.5 look again at the author's hub
    'if (!refreshed.has(t.key)) {',
    'if (false) {'],
  ['twohubs-gate', 'examples/_seeds/twohubs-gate.js',
    "loc: momNew }, text: 'welcome home' }",
    "loc: mom.at }, text: 'welcome home' }"],
  ['media-gate', 'examples/weekend-reader/weekend-reader.js',
    "if (typeof n === 'string') { if (sha256(f) !== n) return bad('host', `media file ${n} is not what the index lists`); media.set(n, f); continue; }",
    "if (typeof n === 'string') { media.set(n, f); continue; }"],
  ['media-gate', 'examples/weekend-reader/weekend-reader.js',
    "if (typeof n !== 'number' || n > pin.top) continue;",
    'if (n > pin.top) continue;'],
  ['media-gate', 'examples/_seeds/media-gate.js',
    'if (m[3] && this.contentCheck && sha(this.files.get(key)) !== m[3] && sha(b) === m[3]) { this.files.set(key, b); return { status: 200 }; }',
    'if (false) { this.files.set(key, b); return { status: 200 }; }'],
  // The 2026-08-23 review gates. Each row turns off the repair a gate prices, or the staging that
  // makes the finding visible, and the gate must go red either way.
  ['coldcourt-gate', 'examples/weekend-reader/weekend-reader.js',
    'const link = p.chain[i], from = p.chain[i - 1].key, recovery = recoveryLists[i];',
    'const link = p.chain[i], from = p.chain[i - 1].key, recovery = link.recovery;'],
  ['coldcourt-gate', 'examples/weekend-publisher/weekend-publisher.js',
    "export const vouched = (h, from, vouchers) => ({ ...h, vouchers: [...(h.vouchers ?? []), ...restore(from, { x: h.key }, vouchers, h.recovery).vouchers] });",
    "export const vouched = (h, from, vouchers) => ({ ...h });"],
  ['oldkey-gate', 'examples/_seeds/hub.js',
    "return listed || verify(f, keys.at(-1));",
    "return keys.some((x) => verify(f, x));"],
  ['oldkey-gate', 'examples/weekend-reader/weekend-reader.js',
    'if (had && (had !== hash || live.has(n))) return null;',
    'if (had && live.has(n)) return null;'],
  ['oldkey-gate', 'examples/weekend-reader/weekend-reader.js',
    "for (const [n, h] of pin.live) if (!set.live.has(n)) { say(`withdrawn: ${n}`); withdrawn.set(n, h); }",
    "for (const [n, h] of pin.live) if (!set.live.has(n)) { say(`withdrawn: ${n}`); }"],
  ['hubwrite-gate', 'examples/_seeds/hub.js',
    "if (this.verifyWrites) { const keys = walk(o); if (!keys || !verify(b, keys.at(-1))) return { status: 403 }; }",
    "if (false) { const keys = walk(o); if (!keys || !verify(b, keys.at(-1))) return { status: 403 }; }"],
  ['pending-gate', 'examples/weekend-reader/weekend-reader.js',
    "if (!Array.isArray(e) || e.length > 2 || (typeof e[0] !== 'number' && typeof e[0] !== 'string')) return null;",
    "if (!Array.isArray(e) || (typeof e[0] !== 'number' && typeof e[0] !== 'string')) return null;"],
  ['pending-gate', 'examples/weekend-reader/weekend-reader.js',
    "if (!was) return bad('host', `post ${n} is listed now and was not before`);",
    "if (!was) continue;"],
  ['audience-gate', 'examples/_seeds/audience-gate.js',
    "const audience2 = [mom, jesse, sis].map((p) => ({ key: p.key.x, read: p.read.x, at: at[p.name] }));",
    "const audience2 = [mom, jesse, sis].map((p) => ({ key: p.key.x, read: p.read.x, at: at.mom }));"],
  ['audience-gate', 'examples/weekend-reader/weekend-reader.js',
    "if (!raw || raw.anchor !== learned) return bad('identity', 'not the identity this reader learned');",
    "if (!raw) return bad('identity', 'not the identity this reader learned');"],
  ['spoken-gate', 'examples/_seeds/spoken-gate.js',
    "const repaired = [spoken(alice.chain.at(-1).key), spoken(thief.chain.at(-1).key)];",
    "const repaired = [spoken(alice.anchor), spoken(thief.anchor)];"],
  // ---- The capstone's own demo: the rows the seed gates cannot see. ----
  ['weekend-reader', 'examples/weekend-reader/weekend-reader.js',                  // §7.4 `n` equals the number served at
    "if (!post || post.address !== e.hash || post.obj.n !== n) return bad('host', `post ${n} is not what the index lists`);",
    "if (!post || post.address !== e.hash) return bad('host', `post ${n} is not what the index lists`);"],
  ['weekend-reader', 'examples/weekend-reader/weekend-reader.js',                  // §4 `entries` MUST come first
    "Object.keys(index.obj)[0] !== 'entries' ? 'entries is not the first member' :",
    "false ? 'entries is not the first member' :"],
  // ---- Stage B's examples. Every row here targets `src/`, which is what the examples run. ----
  // ---- §2's three, written first; they set the house style. ----
  ['signed-file', 'src/file.js',
    "if (b.length !== bytes || b.toString('base64url') !== text) return null;",
    'if (b.length !== bytes) return null;'],
  ['signed-file', 'src/file.js',
    'export const address = (bytes) => { const s = splitFile(bytes); return s ? sha256(s.body) : null; };',
    'export const address = (bytes) => sha256(bytes);'],
  ['signed-file', 'src/file.js',
    "try { if (crypto.verify(null, s.body, publicKey(x), sig)) { by = x; break; } } catch { /* a malformed key verifies nothing */ }",
    'by = x; break;'],
  ['no-canonicalization', 'src/file.js',
    'const i = bytes.lastIndexOf(0x0a);',
    'const i = bytes.indexOf(0x0a);'],
  ['no-canonicalization', 'src/file.js',
    "try { if (crypto.verify(null, s.body, publicKey(x), sig)) { by = x; break; } } catch { /* a malformed key verifies nothing */ }",
    "try { if (crypto.verify(null, Buffer.from(JSON.stringify(parseBody(s.body))), publicKey(x), sig)) { by = x; break; } } catch { /* a malformed key verifies nothing */ }"],
  ['json-hygiene', 'src/file.js',
    'if (seen.has(key)) throw this.error(`duplicate member name ${JSON.stringify(key)}`);',
    'if (false) throw this.error(`duplicate member name ${JSON.stringify(key)}`);'],
  ['json-hygiene', 'src/file.js',
    "if (key === '__proto__') throw this.error('reserved member name \"__proto__\"');",
    "if (false) throw this.error('reserved member name \"__proto__\"');"],
  ['json-hygiene', 'src/file.js',
    'if (/^-?\\d+$/.test(token) && (BigInt(token) > 9007199254740991n || BigInt(token) < -9007199254740991n)) throw this.error(`integer ${token} outside ±(2^53 − 1)`);',
    'if (false) throw this.error(`integer ${token} outside ±(2^53 − 1)`);'],
  ['json-hygiene', 'src/file.js',
    "if (/[\\ud800-\\udbff](?![\\udc00-\\udfff])|(?:^|[^\\ud800-\\udbff])[\\udc00-\\udfff]/.test(out)) throw this.error('unpaired surrogate in string');",
    "if (false) throw this.error('unpaired surrogate in string');"],
  // first-contact
  ["first-contact", "src/profile.js",
    "if (!parsedRaw || parsedRaw.anchor !== learned) return bad('identity', 'not the identity this reader learned');",
    "if (!parsedRaw) return bad('identity', 'not the identity this reader learned');"],
  ["first-contact", "src/spoken.js",
    "'openfeed/v1/spoken', 9",
    "'openfeed/v1/spoke', 9"],
  ["first-contact", "src/spoken.js",
    "& 0x7ffn",
    "& 0x3ffn"],
  ["first-contact", "src/profile.js",
    "current: p.chain.at(-1).key",
    "current: p.chain[0].key"],
  // the-chain
  ["the-chain", "src/profile.js",
    "Buffer.from(`${from}->${to}`, 'ascii')",
    "Buffer.from(`${to}->${from}`, 'ascii')"],
  ["the-chain", "src/profile.js",
    "&& leaves.has(leaf(v.salt, v.key))",
    "&& true"],
  ["the-chain", "src/profile.js",
    "ok.add(v.key)",
    "ok.add(`${v.key}:${ok.size}`)"],
  ["the-chain", "src/profile.js",
    "p.chain.slice(pin.chain.length).some((h) => h.sig === undefined) &&",
    "false &&"],
  ["the-chain", "src/profile.js",
    "const link = p.chain[i], from = p.chain[i - 1].key, recovery = recoveryLists[i];",
    "const link = p.chain[i], from = p.chain[i - 1].key, recovery = recoveryLists[i] ?? link.recovery;"],
  // recovery-list
  ["recovery-list", "src/profile.js",
    "`${salt}|${x}`",
    "`${x}`"],
  ["recovery-list", "src/profile.js",
    "leaves.has(leaf(v.salt, v.key))",
    "true"],
  ["recovery-list", "src/profile.js",
    "!majority(from, link, recovery)) return null;",
    "vouches(from, link, recovery) < 1) return null;"],
  ["recovery-list", "src/profile.js",
    "!(j in recoveryLists)",
    "true"],
  // the-index
  ["the-index", "src/index.js",
    "if (had !== undefined && (had !== b || live.has(a))) return null;     // one hash per number, ever",
    "if (had !== undefined && live.has(a)) return null;     // one hash per number, ever"],
  ["the-index", "src/index.js",
    "if (b === null) { if (!live.has(a)) return null; live.delete(a); continue; }",
    "if (b === null) { live.delete(a); continue; }"],
  ["the-index", "src/index.js",
    "if (Object.keys(obj)[0] !== 'entries') return 'entries is not the first member';",
    "if (false) return 'entries is not the first member';"],
  ["the-index", "src/reader.js",
    "let index = hf && verifyIndex(hf.bytes, chain.current);",
    "let index = hf && verifyIndex(hf.bytes, chain.keys);"],
  // top-and-rumors
  ["top-and-rumors", "src/publish.js",
    "const rewrite = () => amendIndex((h) => ({ ...h, entries: liveEntries(h.entries) }));",
    "const rewrite = () => amendIndex((h) => ({ ...h, entries: liveEntries(h.entries), top: Math.max(0, ...liveEntries(h.entries).filter((e) => typeof e[0] === 'number').map((e) => e[0])) }));"],
  ["top-and-rumors", "src/index.js",
    "if (index.obj.top < pin.top) return bad('the highest number used went backwards');",
    "if (false) return bad('the highest number used went backwards');"],
  ["top-and-rumors", "src/reader.js",
    "if (t.n <= s.top) continue;",
    "if (false) continue;"],
  ["top-and-rumors", "src/reader.js",
    "if (!refreshed.has(t.key)) {",
    "if (true) {"],
  ["top-and-rumors", "src/reader.js",
    "if (t.n > seen.get(t.key).top && !out.includes(line)) out.push(line);",
    "if (t.n > seen.get(t.key).top) out.push(line);"],
  // media
  ["media", "src/reader.js",
    "sha256(f.bytes) !== n",
    "false"],
  ["media", "src/reader.js",
    "if (!f) return bad('host',",
    "if (!f) continue; if (false) return bad('host',"],
  ["media", "src/reader.js",                                                     // §4.4 a media file the index does not list is not there
    "      posts.set(n, post.obj);",
    "      posts.set(n, post.obj); for (const h of post.obj.media ?? []) { const mf = await get(`${at}/media/${h}`); if (mf) media.set(h, mf.bytes); }"],
  ["media", "src/envelope.js",
    "crypto.createHash('sha256').update(bytes).digest('base64url')",
    "crypto.createHash('sha256').update(plain).digest('base64url')"],
  // rewrite
  ["rewrite", "src/index.js",
    "for (const e of entries) { const [a, b] = e; if (e.length === 2 && b === null) m.delete(a); else m.set(a, typeof a === 'string' ? [a] : [a, b]); }",
    "for (const e of entries) { const [a, b] = e; m.set(a, typeof a === 'string' ? [a] : [a, b]); }"],
  ["rewrite", "src/index.js",                                                    // §4.2 the fold's withdrawal; the rewrite's safety argument is live-set identity
    "if (b === null) { if (!live.has(a)) return null; live.delete(a); continue; }",
    "if (b === null) { if (!live.has(a)) return null; continue; }"],
  ["rewrite", "src/index.js",
    "for (const [n, h] of pin.live) if (!set.live.has(n)) { notes.push(`withdrawn: ${n}`); withdrawn.set(n, h); }",
    "for (const [n, h] of pin.live) if (!set.live.has(n)) { notes.push(`withdrawn: ${n}`); }"],
  ["rewrite", "src/index.js",
    "if (was !== e.hash) return bad(`post ${n} changed after the reader saw it`);",
    "if (false) return bad(`post ${n} changed after the reader saw it`);"],
  ["rewrite", "src/index.js",                                                    // §7.2 step 9 — media files are exempt
    "if (typeof n !== 'number' || n > pin.top) continue;",
    "if (n > pin.top) continue;"],
  // moving
  ["moving", "src/reader.js",
    "locations: [...new Set([...(pin?.locations ?? []), ...raw.locations])],      // \u00a73.7: every location ever named",
    "locations: [...raw.locations],"],
  ["moving", "src/reader.js",
    "for (const where of [...new Set([...(s.locations ?? []), t.loc])]) {",
    "for (const where of [...new Set([...(s.locations ?? [])])]) {"],
  ["moving", "src/profile.js",
    "  const profile = verifyFile(bytes, chain.current);",
    "  const profile = verifyFile(bytes, chain.current) ?? { address: sha256(bytes) };"],
  ["moving", "src/profile.js",
    "else if (p.version < pin.profileVersion) return bad('identity', 'an older profile than the one this reader saw');",
    "else if (false) return bad('identity', 'an older profile than the one this reader saw');"],
  // fetching
  ["fetching", "src/addresses.js",
    "[0xa9fe0000, 16],",
    "// [0xa9fe0000, 16],"],
  ["fetching", "src/addresses.js",
    "if (!/^(0|[1-9][0-9]{0,2})$/.test(p)) return null;",
    "if (!/^[0-9]{1,4}$/.test(p)) return null;"],
  ["fetching", "src/addresses.js",
    "if (g4 === 0xffff && g5 === 0) return isPublicIPv4(embedded(g6, g7));",
    "if (g4 === 0xffff && g5 === 1) return isPublicIPv4(embedded(g6, g7));"],
  ["fetching", "src/fetch.js",
    "const allowed = addresses.filter((a) => isAddressAllowed(a.address));",
    "const allowed = addresses;"],
  ["fetching", "src/fetch.js",
    "if (++links > maxRedirects)",
    "if (++links > maxRedirects + 1)"],
  // views
  ["views", "src/views.js",
    "id: `urn:openfeed:${read.anchor}:${n}`",
    "id: `${loc}/posts/${n}`"],
  ["views", "src/views.js",
    ".filter(([, p]) => p.encrypted === undefined)",
    ".filter(([, p]) => (p.text ??= JSON.stringify(p.encrypted)))"],
  ["views", "src/views.js",
    "export function hcard(read, loc) {\n  const name = read.name ?? loc.split('/').pop();",
    "export function hcard(read, loc) {\n  const name = loc.split('/').pop();"],
  ["views", "src/views.js",                                                      // §11 says MAY: this pins src/views.js's choice, not a rule
    "href=\"${esc(`${loc}/#${read.anchor}`)}\"",
    "href=\"${esc(`${loc}/`)}\""],
  ["views", "src/index.js",                                                      // §4.2 the fold; "withdrawn posts are absent" holds by construction in views.js
    "if (b === null) { if (!live.has(a)) return null; live.delete(a); continue; }",
    "if (b === null) { if (!live.has(a)) return null; continue; }"],
  // contest
  ["contest", "src/profile.js",
    "let i = p.chain.findIndex((h, j) => j < pin.chain.length && pin.chain[j].key !== h.key);",
    "let i = -1;"],
  ["contest", "src/profile.js",
    "if (i < 0 && p.chain.length < pin.chain.length && p.version > pin.profileVersion) i = p.chain.length;",
    "if (false) i = p.chain.length;"],
  ["contest", "src/profile.js",
    "if (p.chain.length >= from && !(p.chain.length in recoveryLists)) recoveryLists[p.chain.length] = p.recovery;",
    "if (p.chain.length >= from) recoveryLists[p.chain.length] = p.recovery;"],
  ["contest", "src/profile.js",
    "theirs = majority(p.chain[i - 1].key, p.chain[i], recoveryLists[i]);",
    "theirs = majority(p.chain[i - 1].key, p.chain[i], p.chain[i]?.recovery ?? recoveryLists[i]);"],
  ["contest", "src/profile.js",
    "const majority = (from, link, recovery) => vouches(from, link, recovery) * 2 > (recovery?.leaves.length ?? Infinity);",
    "const majority = (from, link, recovery) => vouches(from, link, recovery) >= 1;"],
  ["contest", "src/profile.js",
    "if (mine === theirs) return bad('identity', 'contested: two histories, and no majority settles it');",
    "if (false) return bad('identity', 'contested: two histories, and no majority settles it');"],
  // envelope
  ["envelope", "src/envelope.js",
    "const bindAAD = (epk, carrier) => Buffer.concat([epk, Buffer.from(carrier, 'ascii')]);",
    "const bindAAD = (epk, carrier) => Buffer.concat([epk]);"],
  ["envelope", "src/envelope.js",
    "let ck; try { ck = unaead(kek, knonce, unb64(slot[1]), epk); } catch { continue; }",
    "let ck; try { ck = unaead(kek, knonce, unb64(slot[1]), epk); } catch { return null; }"],
  ["envelope", "src/envelope.js",
    "const plain = Buffer.from(JSON.stringify({ audience, ...content }), 'utf8');",
    "const plain = Buffer.from(JSON.stringify({ ...content }), 'utf8');"],
  ["envelope", "src/envelope.js",
    "return [b64(tag), b64(aead(kek, knonce, ck, epk))];",
    "return [b64(tag), b64(aead(kek, knonce, ck, Buffer.alloc(0)))];"],
  ["envelope", "src/envelope.js",
    "export const INFO = 'openfeed/v1/slot';",
    "export const INFO = 'openfeed/v1/slot/x';"],
  // the-reader
  ["the-reader", "src/profile.js",
    "if (!parsedRaw || parsedRaw.anchor !== learned) return bad('identity', 'not the identity this reader learned');",
    "if (!parsedRaw) return bad('identity', 'not the identity this reader learned');"],
  ["the-reader", "src/reader.js",
    "let index = hf && verifyIndex(hf.bytes, chain.current);",
    "let index = hf && verifyIndex(hf.bytes, chain.keys);"],
  ["the-reader", "src/reader.js",
    "if (!post || post.address !== e.hash || post.obj.n !== n) return bad('host', `post ${n} is not what the index lists`);",
    "if (!post) return bad('host', `post ${n} is not what the index lists`);"],
  ["the-reader", "src/reader.js",
    "if (sha256(f.bytes) !== n) return bad('host', `media file ${n} is not what the index lists`);",
    "if (false) return bad('host', `media file ${n} is not what the index lists`);"],
  ["the-reader", "src/profile.js",
    "} else if (p.version < pin.profileVersion) return bad('identity', 'an older profile than the one this reader saw');",
    "} else if (false) return bad('identity', 'an older profile than the one this reader saw');"],
  ["the-reader", "src/reader.js",
    "if (restoredAt !== null && now - restoredAt < WEEK) say('recently restored');",
    "if (false) say('recently restored');"],
  ["the-reader", "src/index.js",                                                 // §7.2 step 9 index `version` MUST NOT go backwards (a rollback that keeps `top`)
    "if (index.obj.version < pin.indexVersion) return bad('an index older than the one this reader saw');",
    "if (false) return bad('an index older than the one this reader saw');"],
  ["the-reader", "src/index.js",                                                 // §7.2 step 9 the same `version` at a different address is host
    "if (index.obj.version === pin.indexVersion && index.address !== pin.indexHash) return bad('two indexes at one version');",
    "if (false) return bad('two indexes at one version');"],
  ["the-reader", "src/reader.js",                                                // §7.4 a post that verifies under no chain key is host
    "      const post = verifyFile(f.bytes, chain.keys);",
    "      const post = verifyFile(f.bytes, chain.keys) || { address: e.hash, obj: { n } };"],
  ["the-reader", "src/reader.js",                                                // §7.4 a listed file that is not served is host
    "if (!f) return bad('host', `${isMedia ? 'media file' : 'post'} ${n} is listed and not served`);",
    "if (!f) continue;"],
  // your-copy
  ["your-copy", "src/publish.js",
    "const kept = keep ?? ((path, bytes) => copy.set(path, bytes));",
    "const kept = keep ?? ((path, bytes) => copy);"],
  ["your-copy", "src/publish.js",
    "if (r.status === 200 || r.status === 201) kept(path, bytes); return r; };",
    "if (r.status === 200 || r.status === 201) kept(path, Buffer.concat([bytes, Buffer.from('\\n')])); return r; };"],
  ["your-copy", "src/index.js",                                                  // §4.2 the fold; §10's "last index is the table of contents" is downstream of it
    "if (b === null) { if (!live.has(a)) return null; live.delete(a); continue; }",
    "if (b === null) { if (!live.has(a)) return null; continue; }"],
  ["your-copy", "src/reader.js",
    "if (!post || post.address !== e.hash || post.obj.n !== n) return bad('host', `post ${n} is not what the index lists`);",
    "if (!post) return bad('host', `post ${n} is not what the index lists`);"],
  // publish-interface
  ["publish-interface", "src/hub.js",
    "if ((cur ? etag(cur) : null) !== ifMatch) return { status: 412",
    "if (ifMatch && (cur ? etag(cur) : null) !== ifMatch) return { status: 412"],
  ["publish-interface", "src/publish.js",                                        // §8.1 the loser folds into what is served — the naive retry, its own entries under the hub's tag
    "const next = change({ entries: obj.entries, version: obj.version + 1, top: obj.top });",
    "const next = change({ entries: [], version: obj.version + 1, top: obj.top });"],
  ["publish-interface", "src/hub.js",                                            // §8.4 a later profile write MUST carry a `version` that has advanced
    "if (old && (old.anchor !== o.anchor || !(o.version > old.version))) return { status: 409, headers: CORS };",
    "if (old && old.anchor !== o.anchor) return { status: 409, headers: CORS };"],
  ["publish-interface", "src/hub.js",
    "if (ownersFile(name, cur, n) || !ownersFile(name, bytes, n)) return { status: 409, headers: CORS };",
    "if (!ownersFile(name, bytes, n)) return { status: 409, headers: CORS };"],
  ["publish-interface", "src/hub.js",
    "return listed(name, n, sha256(s.body)) || !!verifyFile(bytes, chain.current);",
    "return listed(name, n, sha256(s.body)) || !!verifyFile(bytes, chain.keys);"],
  ["publish-interface", "src/hub.js",
    "if (!chain || !verifyFile(bytes, chain.current)) return { status: 403, headers: CORS };",
    "if (!chain) return { status: 403, headers: CORS };"],
  ["publish-interface", "src/hub.js",
    "if (cur && sha256(cur) === hash) return { status: 409, headers: CORS };",
    "if (cur) return { status: 409, headers: CORS };"],
  ["publish-interface", "src/hub.js",
    "if (!h) return { status: 403, headers: CORS };",
    "if (false) return { status: 403, headers: CORS };"],
  ["publish-interface", "src/hub.js",
    "const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'ETag' };",
    "const CORS = { 'access-control-allow-origin': '*' };"],
  ["publish-interface", "src/publish.js",
    "await amendIndex((h) => h);",
    "if (fields.version === 0) await amendIndex((h) => h);"],
  // posts-and-targets
  ["posts-and-targets", "src/reader.js",
    "if (!post || post.address !== e.hash || post.obj.n !== n) return bad('host', `post ${n} is not what the index lists`);",
    "if (!post) return bad('host', `post ${n} is not what the index lists`);"],
  ["posts-and-targets", "src/hub.js",
    "const s = splitFile(bytes); const o = s && body(bytes); if (!o || o.n !== n) return false;",
    "const s = splitFile(bytes); const o = s && body(bytes); if (!o) return false;"],
  ["posts-and-targets", "src/reader.js",
    "if (listed !== undefined && listed !== t.hash) { t.unresolved = true; continue; }",
    "if (false && listed !== undefined && listed !== t.hash) { t.unresolved = true; continue; }"],
  ["posts-and-targets", "src/reader.js",                                         // §5.4 all 43 characters: a prefix match is another post
    "if (listed !== undefined && listed !== t.hash) { t.unresolved = true; continue; }",
    "if (listed !== undefined && !listed.startsWith(t.hash)) { t.unresolved = true; continue; }"],
  ["posts-and-targets", "src/index.js",
    "for (const [n, h] of pin.live) if (!set.live.has(n)) { notes.push(`withdrawn: ${n}`); withdrawn.set(n, h); }",
    "for (const [n, h] of pin.live) if (!set.live.has(n)) { notes.push(`withdrawn: ${n}`); }"],
];

// A row's first column names either a seed (`examples/_seeds/<gate>.js`) or an example
// (`examples/<gate>/<gate>.js`). As Stage B converts seeds into examples, only the file moves.
const scriptOf = (gate) => {
  const example = path.join(root, 'examples', gate, `${gate}.js`);
  return fs.existsSync(example) ? example : path.join(root, 'examples', '_seeds', `${gate}.js`);
};
const runGate = (gate) => spawnSync(process.execPath, [scriptOf(gate)], { cwd: root, encoding: 'utf8' }).status;
const only = process.argv.slice(2);
const rows = only.length ? M.filter(([g]) => only.includes(g)) : M;
const red = new Set([...new Set(rows.map(([g]) => g))].filter((g) => runGate(g) !== 0));

let bad = 0;
for (const [gate, file, from, to] of rows) {
  if (red.has(gate)) {
    bad++;
    console.log(`  FAIL  ${gate.padEnd(20)} ${file.padEnd(34)} GATE ALREADY RED — a failing gate proves nothing`);
    continue;
  }
  const full = path.join(root, file);
  const before = fs.readFileSync(full, 'utf8');
  const n = before.split(from).length - 1;
  let verdict;
  try {
    if (n !== 1) {
      verdict = `FROM-TEXT MATCHES ${n} TIMES`;
    } else {
      fs.writeFileSync(full, before.replace(from, to));
      verdict = runGate(gate) !== 0 ? 'caught' : 'NOT CAUGHT — gate stayed green';
    }
  } finally {
    fs.writeFileSync(full, before);
  }
  if (verdict !== 'caught') bad++;
  console.log(`  ${verdict === 'caught' ? 'ok  ' : 'FAIL'}  ${gate.padEnd(20)} ${file.padEnd(34)} ${verdict}`);
}
console.log();
if (bad) { console.log(`${bad} mutation(s) NOT caught — those gates or proposals need work`); process.exit(1); }
console.log(`all ${rows.length} mutations caught by their gates`);
