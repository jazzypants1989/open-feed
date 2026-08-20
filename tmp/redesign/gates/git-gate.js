// git-gate: is "Open Feed 2 as a git repo convention" real? Clone over dumb HTTP from a static
// server, verify ssh-ed25519 commit signatures, pin heads, catch a history rewrite and a silent
// drop, and open a sealed item with carrier binding — all from a script this size.
// Kill criteria: verification needing libgit2-scale machinery (proxy: this file > 200 lines);
// dumb-HTTP clone failing on a stock static server; shallow clones breaking the pin walk in a
// way the profile cannot forbid cheaply.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seal, open, EncError } from '../../../src/enc.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = fs.mkdtempSync(path.join(HERE, '.gitwork-'));
const sh = (cwd, cmd, args, opts = {}) => execFileSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' }, ...opts });
const fails = (fn) => { try { fn(); return false; } catch { return true; } };
let serverProc = null;

try {
  // ---- mom's device: an ssh-ed25519 key, which doubles as git's signing key ----
  sh(WORK, 'ssh-keygen', ['-t', 'ed25519', '-N', '', '-q', '-f', 'momkey', '-C', 'mom@pence.family']);
  const pub = fs.readFileSync(path.join(WORK, 'momkey.pub'), 'utf8').trim().split(' ');
  fs.writeFileSync(path.join(WORK, 'allowed_signers'), `mom@pence.family ${pub[0]} ${pub[1]}\n`);
  const SIGN = ['-c', 'user.name=Mom', '-c', 'user.email=mom@pence.family', '-c', 'gpg.format=ssh',
    '-c', `user.signingkey=${path.join(WORK, 'momkey')}`, '-c', 'commit.gpgsign=true'];
  const VERIFY = ['-c', `gpg.ssh.allowedSignersFile=${path.join(WORK, 'allowed_signers')}`];

  // ---- the repo: identity.json + items + one sealed item, each an ordinary file ----
  const repo = path.join(WORK, 'mom');
  fs.mkdirSync(path.join(repo, 'items'), { recursive: true });
  sh(repo, 'git', ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(repo, 'identity.json'), JSON.stringify({ name: 'Mom', signers: [`${pub[0]} ${pub[1]}`] }));
  fs.writeFileSync(path.join(repo, 'items/day-1.json'), JSON.stringify({ id: 'day-1', content_text: 'planted the tomatoes' }));
  const grandma = (() => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
    const { x } = publicKey.export({ format: 'jwk' });
    return { privateKey, document: { url: 'https://grandma.example/', keys: [{ kid: 'enc-1', kty: 'OKP', crv: 'X25519', use: 'enc', x, iat: 1736899200 }] } };
  })();
  const carrier = { id: 'day-2', authors: [{ url: 'https://pence.family/mom.git' }] };
  fs.writeFileSync(path.join(repo, 'items/day-2.enc.json'), JSON.stringify({
    ...carrier, _openfeed: { enc: seal({ item: carrier, content: { content_text: 'surprise party is saturday' }, recipients: [grandma.document] }) },
  }));
  sh(repo, 'git', [...SIGN, 'add', '-A']);
  sh(repo, 'git', [...SIGN, 'commit', '-q', '-m', 'genesis: identity + first items']);

  // ---- publish: a bare mirror served as STATIC FILES over plain HTTP (the dumb protocol) ----
  const bare = path.join(WORK, 'bare.git');
  sh(WORK, 'git', ['clone', '-q', '--bare', repo, bare]);
  const republish = () => { sh(repo, 'git', ['push', '-q', '--force', bare, 'main']); sh(bare, 'git', ['update-server-info']); };
  sh(bare, 'git', ['update-server-info']);
  // The static server runs in a CHILD process: the gate's own git commands are synchronous, and
  // an in-process server deadlocks against them. A stock static host: resolve the path, ignore
  // the query string, know nothing about git.
  const serverJs = `
    const http = require('http'), fs = require('fs'), path = require('path');
    const root = process.argv[1];
    http.createServer((req, res) => {
      const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200); res.end(fs.readFileSync(p));
    }).listen(0, '127.0.0.1', function () { console.log(this.address().port); });`;
  serverProc = spawn('node', ['-e', serverJs, WORK], { stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((r) => serverProc.stdout.once('data', (d) => r(String(d).trim())));
  const url = `http://127.0.0.1:${port}/bare.git`;

  // ---- the reader: clone, verify, pin ----
  const reader = path.join(WORK, 'reader');
  sh(WORK, 'git', ['clone', '-q', url, reader]);                       // dumb-HTTP clone (kill #2)
  const verified = sh(reader, 'git', [...VERIFY, 'verify-commit', 'HEAD'], { stdio: ['pipe', 'pipe', 'pipe'] })
    || sh(reader, 'git', [...VERIFY, 'log', '-1', '--format=%G?']).trim();
  assert.equal(sh(reader, 'git', [...VERIFY, 'log', '-1', '--format=%G?']).trim(), 'G', 'KILL: signature did not verify as Good');
  const pin = sh(reader, 'git', ['rev-parse', 'HEAD']).trim();

  // ---- honest advance: fetch is a fast-forward from the pin ----
  fs.writeFileSync(path.join(repo, 'items/day-3.json'), JSON.stringify({ id: 'day-3', content_text: 'jam day' }));
  sh(repo, 'git', [...SIGN, 'add', '-A']); sh(repo, 'git', [...SIGN, 'commit', '-q', '-m', 'day 3']); republish();
  sh(reader, 'git', ['fetch', '-q', 'origin']);
  sh(reader, 'git', ['merge-base', '--is-ancestor', pin, 'origin/main']); // exits 0: fast-forward
  assert.equal(sh(reader, 'git', [...VERIFY, 'log', '-1', '--format=%G?', 'origin/main']).trim(), 'G');

  // ---- silent drop: a commit deleting an item with no tombstone is a one-command finding ----
  fs.rmSync(path.join(repo, 'items/day-1.json'));
  sh(repo, 'git', [...SIGN, 'add', '-A']); sh(repo, 'git', [...SIGN, 'commit', '-q', '-m', 'tidy']); republish();
  sh(reader, 'git', ['fetch', '-q', 'origin']);
  const dropped = sh(reader, 'git', ['diff', '--name-status', `${pin}..origin/main`]).split('\n')
    .filter((l) => l.startsWith('D\t') && l.includes('items/')).map((l) => l.split('\t')[1]);
  assert.deepEqual(dropped, ['items/day-1.json']);
  const tombstoned = fs.existsSync(path.join(reader, 'tombstones'));
  assert.equal(tombstoned, false); // no tombstone entry -> the reader reports a silent removal

  // ---- rewrite: a non-fast-forward is detected by every holder of the old head ----
  // The reader advances its pin on every verified fetch (the §5.3 discipline), so the pin sits
  // at the tip the rewrite is about to replace — an amend below the pin is what "rewrite" means.
  const pin2 = sh(reader, 'git', ['rev-parse', 'origin/main']).trim();
  sh(repo, 'git', [...SIGN, 'commit', '-q', '--amend', '-m', 'history, laundered']); republish();
  sh(reader, 'git', ['fetch', '-q', 'origin']);
  const newHead = sh(reader, 'git', ['rev-parse', 'origin/main']).trim();
  assert.notEqual(newHead, pin2);
  assert.ok(fails(() => sh(reader, 'git', ['merge-base', '--is-ancestor', pin2, newHead])),
    'KILL: a rewritten history still read as a continuation of the pin');
  // …the GENESIS pin still holds (the rewrite was above it), and the replaced bytes are still
  // in the reader's own object store, as evidence:
  sh(reader, 'git', ['merge-base', '--is-ancestor', pin, newHead]);
  sh(reader, 'git', ['cat-file', '-e', pin2]);

  // ---- the sealed item opens for grandma, and a relocated envelope is refused ----
  const encItem = JSON.parse(fs.readFileSync(path.join(reader, 'items/day-2.enc.json'), 'utf8'));
  const plain = open(encItem, { privateKeys: [grandma.privateKey] });
  assert.equal(plain.content_text, 'surprise party is saturday');
  assert.throws(() => open({ ...encItem, id: 'someone-elses-slot' }, { privateKeys: [grandma.privateKey] }), EncError);

  // ---- shallow clones cannot walk to a pin: the profile must require full clones ----
  const shallow = path.join(WORK, 'shallow');
  let shallowBroken = false;
  try {
    sh(WORK, 'git', ['clone', '-q', '--depth', '1', url, shallow], { stdio: ['pipe', 'pipe', 'pipe'] });
    shallowBroken = fails(() => sh(shallow, 'git', ['merge-base', '--is-ancestor', pin, 'HEAD']));
  } catch { shallowBroken = true; } // dumb HTTP refuses shallow clones outright — same conclusion
  assert.ok(shallowBroken, 'a shallow clone verified ancestry it does not hold');

  // ---- the weekend-implementability proxy ----
  const lines = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').length;
  assert.ok(lines <= 200, `KILL: the verifier needed ${lines} lines`);

  console.log('git-gate: ok');
  console.log('  dumb-HTTP clone from a stock static server: works (query strings ignored, files only)');
  console.log('  ssh-ed25519 commit signature: Good; pin = commit hash; fast-forward check = merge-base');
  console.log('  silent drop: one `git diff --name-status pin..head` finding; rewrite: non-fast-forward, pinned bytes retained as evidence');
  console.log('  sealed item opened via src/enc.js; relocated envelope refused; shallow clones cannot fake ancestry');
  console.log(`  whole gate, publisher and verifier included: ${lines} lines`);
} finally {
  serverProc?.kill();
  fs.rmSync(WORK, { recursive: true, force: true });
}
