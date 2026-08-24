// A Level 1 verifier you can point at a URL.
//
//   openfeed verify <identity-url> [--pins FILE] [--json]
//
// The `--pins` file is the feature, not a convenience. §12 makes pinning a MUST because the
// guarantee it buys only exists *across* observations: a verifier that checks signatures and
// keeps no pin re-establishes trust at every fetch, so a host holding the signing key can hand
// it any history it likes, forever, without ever forking anything. A run without `--pins` is
// §12's narrow no-persistent-storage exception — still a useful check, and it says so out loud
// rather than letting the green output imply more than it proved.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { createReader, ObservationStore, PinStore, MigrationStore } from '../src/index.js';

const USAGE = `Usage: openfeed verify <identity-url> [--pins FILE] [--json]

  --pins FILE   Read and write the pin store and first-observation record here.
                Without it this run cannot provide the §13.2 guarantees.
  --json        Emit the whole result as JSON instead of a report.

Exit codes: 0 verified, 1 findings, 2 unverifiable (equivocation, rollback, violation), 64 usage.
`;

export function parseArgs(argv) {
  const args = { command: null, target: null, pins: null, json: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--pins') args.pins = argv[++i] ?? null;
    else if (arg === '--help' || arg === '-h') return { ...args, help: true };
    else if (arg.startsWith('-')) throw new Error(`unknown option ${arg}`);
    else rest.push(arg);
  }
  [args.command, args.target] = rest;
  return args;
}

/**
 * The pin store, the first-observation record, and the migration store live in one file; they
 * are one memory.
 *
 * The third is not optional bookkeeping. §4.5 makes retaining the predecessor's recovery pin a
 * MUST for any consumer that intends to honor a recovery-based migration, and it can only be
 * recorded while the predecessor is still readable — which is before the move, with no second
 * chance. A command that collected it during a run and dropped it at exit would satisfy the
 * rule for the length of one process and fail it exactly when it matters.
 */
export function loadState(file) {
  if (!file || !fs.existsSync(file)) {
    return { pins: new PinStore(), observations: new ObservationStore(), migrations: new MigrationStore() };
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    pins: PinStore.fromJSON(raw.pins),
    observations: ObservationStore.fromJSON(raw.observations),
    migrations: MigrationStore.fromJSON(raw.migrations),
  };
}

export function saveState(file, { pins, observations, migrations }) {
  if (!file) return;
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ pins, observations, migrations }, null, 2)}\n`);
}

export function report(result, { pinFile }) {
  const lines = [];
  const { identity, manifest, items, findings } = result;
  lines.push(`identity  ${identity.identity}`);
  lines.push(`          ${identity.document.name ?? '(no name)'} — ${identity.document.keys.length} key(s)`);
  lines.push(`chains    openfeed.json seq ${identity.pin.seq}  ·  manifest seq ${manifest.pin.seq}`);
  lines.push(
    `items     ${items.live.length} live, ${items.deleted.length} tombstoned` +
    `${items.pending.length ? `, ${items.pending.length} pending (manifest lag)` : ''}` +
    `${items.copies.length ? `, ${items.copies.length} copies` : ''}` +
    `${items.withheld.length ? `, ${items.withheld.length} WITHHELD` : ''}`,
  );

  if (result.tofu) {
    lines.push('');
    lines.push('  ! first contact: trust-on-first-use (§5.3). Tampering is detectable from the');
    lines.push('    second observation onward, so this run establishes the pin and proves nothing');
    lines.push('    about what came before it.');
  }
  if (!pinFile) {
    lines.push('');
    lines.push('  ! no pin store (--pins): this run cannot provide the §13.2 guarantees. §12');
    lines.push('    permits a consumer with no persistent storage, and requires it to say so.');
  }
  if (!manifest.contiguous) {
    lines.push('');
    lines.push('  · the manifest chain was walked by skip links (§9.1.1), so versions between the');
    lines.push('    landings were not observed — a weaker witness for others (§16.1).');
  }

  if (findings.length) {
    lines.push('');
    lines.push(`findings  ${findings.length}`);
    for (const f of findings) lines.push(`  [${f.kind}] ${f.message}`);
  } else {
    lines.push('');
    lines.push('findings  none');
  }
  return lines.join('\n');
}

/**
 * The whole command, with its three seams passed in: argv, the two output streams, and how a
 * reader is built. The last one is not a testing affordance bolted on — a reader is a fetch
 * policy (§13.5's dedicated restrictive client, §13.3's certificate validation) plus persistent
 * state, and a caller embedding this in something larger has its own of both.
 */
export async function run({
  argv = [],
  stdout = process.stdout,
  stderr = process.stderr,
  readerFor = (state) => createReader(state),
} = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    stderr.write(`${e.message}\n\n${USAGE}`);
    return 64;
  }
  if (args.help || !args.command) {
    stdout.write(USAGE);
    return args.help ? 0 : 64;
  }
  if (args.command !== 'verify' || !args.target) {
    stderr.write(`${USAGE}`);
    return 64;
  }

  const state = loadState(args.pins);
  // All three stores, not two. The migration store is the one whose omission is silent: the
  // reader would build a fresh one, record the §4.5 recovery pin into it during the run, and
  // `saveState` would then write the *loaded* store back — untouched, forever. That satisfies
  // §4.5 for the length of one process and fails it exactly when it matters, which is the
  // failure mode the comment on `loadState` exists to rule out.
  const reader = readerFor({ pins: state.pins, observations: state.observations, migrations: state.migrations });

  try {
    const result = await reader.read(args.target);
    // Written whatever the verdict: a run that found withholding still advanced its knowledge
    // of the chains, and discarding that would mean re-deriving it — from the host that is
    // under suspicion — on the next run.
    saveState(args.pins, state);
    stdout.write(args.json
      ? `${JSON.stringify(result, null, 2)}\n`
      : `${report(result, { pinFile: args.pins })}\n`);
    // Exit 2 is "unverifiable" — equivocation, rollback, violation — and it is reached two
    // ways: a chain that threw out of the read (the catch below), and a finding of that
    // severity gathered from a *listed* feed whose failure did not abort the primary read. A
    // publisher listing an equivocating archive must draw the same 2 as one equivocating on its
    // headline feed, or the severe verdict is escapable by moving the attack one entry over.
    if (result.findings.some((f) => f.kind === 'invariant')) return 2;
    return result.findings.length ? 1 : 0;
  } catch (e) {
    // A freeze or a refused walk is state worth keeping — §5.3.1's response is to hold the pin
    // and accept nothing further *until a human re-pins*, which is not a decision this tool
    // makes and not one it should forget between runs.
    saveState(args.pins, state);
    stderr.write(`${e.name}: ${e.message}\n`);
    if (e.url) stderr.write(`  at ${e.url}\n`);
    return 2;
  } finally {
    reader.fetcher?.close?.();
  }
}
