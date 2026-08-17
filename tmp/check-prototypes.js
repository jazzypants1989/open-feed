// Run every prototype and report which ones still hold.
//
// This exists because a convention decayed silently. Each `tmp/*-prototype.js` ends in an
// assertion gate and a verdict, and the spec cites those verdicts as the reason its rules are
// what they are — but nothing re-ran them, so `src/` was free to drift out from under one.
// `itemurls-prototype.js` did exactly that: commit 932404c made `src/manifest.js` safer, which
// falsified the prototype's Q1 premise, and the file sat exiting 1 with `HANDOFF.md` still
// arguing §7.6's case from the number it no longer produced.
//
// A prototype is evidence. Evidence that nobody re-runs is a claim.
//
//   node tmp/check-prototypes.js          (also: npm run prototypes)

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const files = fs.readdirSync(here).filter((f) => f.endsWith('-prototype.js')).sort();

if (!files.length) {
  console.error('no prototypes found — did this move?');
  process.exit(1);
}

const failed = [];
for (const f of files) {
  const started = Date.now();
  let ok = true;
  let output = '';
  try {
    output = execFileSync(process.execPath, [path.join(here, f)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 300_000,
    });
  } catch (e) {
    ok = false;
    output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    failed.push({ f, output });
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${f.padEnd(34)} ${secs.padStart(6)}s`);
}

console.log();
if (failed.length) {
  for (const { f, output } of failed) {
    console.error(`--- ${f} ---`);
    // The gate prints why; the rest is the prototype's ordinary narration.
    console.error(output.split('\n').filter((l) => /FAIL|Error|did not hold/.test(l)).join('\n') || output.slice(-800));
  }
  console.error(`\n${failed.length} of ${files.length} prototypes no longer hold.`);
  console.error('Either the prototype is stale or the claim it supports is. Both are findings.');
  process.exit(1);
}
console.log(`all ${files.length} prototypes hold`);
