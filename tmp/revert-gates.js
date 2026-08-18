// Revert-check every prototype gate: apply each recorded mutation to src/, require the gate to
// FAIL, restore with `git checkout --`. The table below is the executable record of the checks the
// verdict cards cite — a stamped date in a card is a claim; this is the same check, re-runnable.
// Refuses to start if src/ is dirty. Add a row here whenever a gate lands.
//
//   node tmp/revert-gates.js          (also: npm run prototypes:revert)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });

const M = [
  ['threshold', 'src/chain.js',
    "const recoveryKeys = (pinnedAncestor.keys ?? []).filter((k) => k?.use === 'recovery');",
    'const recoveryKeys = (pinnedAncestor.keys ?? []).filter((k) => k?.use);'],
  ['withholding', 'src/reader.js',
    'itemUrlsDeclared: entry.items === true,',
    'itemUrlsDeclared: false,'],
  ['withholding', 'src/reader.js',
    'if (!controlServed && !declared) return idle;',
    'if (false) return idle;'],
  ['itemurls', 'src/manifest.js',
    'const probed = unobtainable.has(id);',
    'const probed = true;'],
  ['itemurls', 'src/chain.js',
    'return `${base}/items/${hash}.json`;',
    'return `${base}/item/${hash}.json`;'],
  ['enctags', 'src/enc.js',
    "return { header: { alg: ALG, _tag: slotTag(z) }, encrypted_key: wrapped.toString('base64url') };",
    "return { header: { alg: ALG, kid: jwk.kid, _tag: slotTag(z) }, encrypted_key: wrapped.toString('base64url') };"],
  ['enctags', 'src/enc.js',
    "export const TAG_LABEL = 'openfeed-slot-tag';",
    "export const TAG_LABEL = 'openfeed-slot-tag-v2';"],
  ['inbox', 'src/inbox.js',
    "if (!relevant(item) && !tombstoneOfStored) return out('not_relevant');",
    "if (false) return out('not_relevant');"],
  ['inbox', 'src/inbox.js',
    'holders.set(existing?.author ?? me, version);',
    'holders.set(me, version);'],
  ['delivery-chain', 'src/publish.js',
    'if (last) entry.prev = last.hash;',
    '// if (last) entry.prev = last.hash;'],
  ['delivery-chain', 'src/inbox.js',
    'if (d.seq > st.seq + 1) {',
    'if (d.seq > st.seq + 2) {'],
  ['freshness', 'src/manifest.js',
    'const deadline = Math.min(declared, manifest.updated + ceiling);',
    'const deadline = Math.max(declared, manifest.updated + ceiling);'],
  ['freshness', 'src/reader.js',
    'const stale = freshness(manifest.manifest, { now: now(), ceiling: lagCeiling });',
    'const stale = null;'],
  ['migration', 'src/chain.js',
    'if (identityUrl !== identity) throw new VerifyError(`kid names ${identityUrl}, not ${identity}`);',
    'if (identityUrl !== identityUrl) throw new VerifyError(`kid names ${identityUrl}, not ${identity}`);'],
  ['migration', 'src/manifest.js',
    'for (const id of Object.keys(lastObserved.items)) {',
    'for (const id of Object.keys(lastObserved.items).slice(0, 0)) {'],
  ['export', 'src/chain.js',
    'if (identityUrl !== identity) throw new VerifyError(',
    'if (identityUrl === identity) throw new VerifyError('],
  ['export', 'src/manifest.js',
    "record(id, gone ? 'deleted' : 'live', { version, hash });",
    "record(id, 'live', { version, hash });"],
  ['canonicality', 'src/canonical.js',
    'if (!served.equals(expected)) {',
    "if (!served.equals(expected) && !served.equals(Buffer.concat([expected, Buffer.from('\\n')]))) {"],
  ['canonicality', 'src/publish.js',
    'out.set(url.slice(this.identity.length), canonicalBytes(doc));',
    "out.set(url.slice(this.identity.length), Buffer.from(JSON.stringify(doc, null, 2), 'utf8'));"],
  ['feedbinding', 'src/jws.js',
    'return url.href;',
    "return url.origin + '/';"],
  ['feedbinding', 'open-feed-spec.md',
    'which is the safe reading.',
    'which is the safest reading.'],
];

const targets = [...new Set(M.map(([, f]) => f))];
const dirty = git('status', '--porcelain', '--', ...targets).trim();
if (dirty) { console.error(`refusing: a target file is dirty\n${dirty}`); process.exit(2); }

let bad = 0;
for (const [gate, file, from, to] of M) {
  const full = path.join(root, file);
  const before = fs.readFileSync(full, 'utf8');
  const n = before.split(from).length - 1;
  let verdict;
  try {
    if (n !== 1) {
      verdict = `FROM-TEXT MATCHES ${n} TIMES`;
    } else {
      fs.writeFileSync(full, before.replace(from, to));
      const r = spawnSync(process.execPath, [`tmp/prototypes/${gate}.js`], { cwd: root, encoding: 'utf8' });
      verdict = r.status !== 0 ? 'caught' : 'NOT CAUGHT — gate stayed green';
    }
  } finally {
    git('checkout', '--', file);
  }
  if (verdict !== 'caught') bad++;
  console.log(`  ${verdict === 'caught' ? 'ok  ' : 'FAIL'}  ${gate.padEnd(15)} ${file.padEnd(18)} ${verdict}`);
}
console.log();
if (bad) { console.log(`${bad} mutation(s) NOT caught — those gates or proposals need work`); process.exit(1); }
console.log(`all ${M.length} mutations caught by their gates`);
