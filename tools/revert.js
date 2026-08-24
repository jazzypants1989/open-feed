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
  ['weekend-gate', 'examples/weekend-reader/weekend-reader.js',
    "if (!post || post.address !== e.hash || post.obj.n !== n) return bad('host', `post ${n} is not what the index lists`);",
    "if (!post) return bad('host', `post ${n} is not what the index lists`);"],
  ['weekend-gate', 'examples/weekend-reader/weekend-reader.js',
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
  ['gapless-gate', 'examples/weekend-reader/weekend-reader.js',
    "if (typeof n !== 'number' || n > pin.top) continue;",
    'if (true) continue;'],
  ['gapless-gate', 'examples/_seeds/gapless-gate.js',
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
    'if (!linkSig(from, link.key, from, link.sig) && vouches(from, link, recovery) < recovery.k) return null;',
    'if (!linkSig(from, link.key, from, link.sig) && vouches(from, link, link.recovery) < link.recovery.k) return null;'],
  ['court-gate', 'examples/weekend-reader/weekend-reader.js',
    'const majority = (c) => vouches(c[i - 1].key, c[i], recoveryLists[i]) * 2 > (recoveryLists[i]?.leaves.length ?? Infinity);',
    'const majority = (c) => vouches(c[i - 1].key, c[i], recoveryLists[i]) >= 1;'],
  // The envelope moved to gates/envelope.js when the construction stopped being on trial; these
  // three rows follow it. They are the reason the move is safe: turn each rule off in its new home
  // and the gate that proved it still goes red.
  ['envelope-gate', 'examples/_seeds/envelope.js',
    'const bindAAD = (epk, carrier) => Buffer.concat([epk, Buffer.from(carrier)]);',
    'const bindAAD = (epk, carrier) => epk;'],
  ['envelope-gate', 'examples/_seeds/envelope.js',
    "export const POLICY = { pow2: { slotFloor: 1, bodyFloor: 32 }, floor: { slotFloor: 8, bodyFloor: 512 } };",
    "export const POLICY = { pow2: { slotFloor: 1, bodyFloor: 32 }, floor: { slotFloor: 1, bodyFloor: 32 } };"],
  ['envelope-gate', 'examples/_seeds/envelope.js',
    'const eph = ephemeral ?? xKey(`eph:${b64(crypto.randomBytes(8))}`);',
    "const eph = ephemeral ?? xKey('eph:fixed');"],
  ['twohubs-gate', 'examples/_seeds/twohubs-gate.js',
    'p.target.n === 1 && p.target.hash === momRead.pin.live.get(1)',
    'p.target.n === 1'],
  ['twohubs-gate', 'examples/_seeds/twohubs-gate.js',
    'checkedKey = await readKeyOf(mom, momAfter.pin);',
    'checkedKey = await naiveReadKeyOf(mom);'],
  ['twohubs-gate', 'examples/_seeds/twohubs-gate.js',
    'rumorFetches.M === 3 && rumorFetches.J === 0',
    'rumorFetches.J === 3 && rumorFetches.M === 0'],
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
  // ---- the examples (PLAN.md Stage B). These rows target `src/`, which is what the examples run. ----
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
];

// A row's first column names either a seed (`examples/_seeds/<gate>.js`) or an example
// (`examples/<gate>/<gate>.js`). As Stage B converts seeds into examples, only the file moves.
const scriptOf = (gate) => {
  const seed = path.join(root, 'examples', '_seeds', `${gate}.js`);
  return fs.existsSync(seed) ? seed : path.join(root, 'examples', gate, `${gate}.js`);
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
