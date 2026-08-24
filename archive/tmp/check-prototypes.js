// Run every prototype gate in tmp/prototypes/ and report which ones still hold.
//
// This exists because a convention decayed silently. Each gate ends in assertions, and the spec
// cites their verdicts as the reason its rules are what they are — but nothing re-ran them, so
// `src/` was free to drift out from under one (see 932404c). The originals these gates distill
// live in `tmp/archive/`; the contract for a gate is `tmp/prototypes/README.md`.
//
// A prototype is evidence. Evidence that nobody re-runs is a claim.
//
//   node tmp/check-prototypes.js          (also: npm run prototypes)

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const dir = path.join(here, 'prototypes');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();

if (!files.length) {
  console.error('no prototype gates found in tmp/prototypes/ — an empty run proves nothing');
  process.exit(1);
}

const failed = [];
const results = [];
for (const f of files) {
  const started = Date.now();
  let ok = true;
  let output = '';
  try {
    output = execFileSync(process.execPath, [path.join(dir, f)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 300_000,
    });
  } catch (e) {
    ok = false;
    output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    failed.push({ f, output });
  }
  const seconds = Number(((Date.now() - started) / 1000).toFixed(1));
  results.push({ prototype: f, ok, seconds, ...(ok ? {} : { tail: output.slice(-2000) }) });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${f.padEnd(34)} ${seconds.toFixed(1).padStart(6)}s`);
}

// The full run costs minutes, so its outcome is written down every time: a later reader (human
// or agent) who saw only a truncated terminal — or is wondering whether a rerun is needed at
// all — reads this instead of paying for the run again. Failures keep their output tail.
fs.writeFileSync(path.join(here, 'prototype-results.json'), JSON.stringify({
  ranAt: new Date().toISOString(),
  allHold: failed.length === 0,
  results,
}, null, 2) + '\n');

console.log();
if (failed.length) {
  for (const { f, output } of failed) {
    console.error(`--- ${f} ---`);
    // The gate prints why; the rest is the prototype's ordinary narration.
    console.error(output.split('\n').filter((l) => /FAIL|Error|did not hold/.test(l)).join('\n') || output.slice(-800));
  }
  console.error(`\n${failed.length} of ${files.length} prototypes no longer hold.`);
  console.error('Either the prototype is stale or the claim it supports is. Both are findings.');
  console.error(`Per-prototype results (with failure output) in tmp/prototype-results.json.`);
  process.exit(1);
}
console.log(`all ${files.length} prototypes hold  (results written to tmp/prototype-results.json)`);
