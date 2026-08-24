// headrange-gate: can a reader that cached the last head reconstruct the new one from a tail
// fetch, and is a wrong reconstruction ever accepted? Both field orders; an append, a digit
// carry in hseq, and a middle edit.
// Kill criteria: a cached prefix that changes under an append; a reconstruction after a middle
// edit that verifies; a reorder that costs bytes.
import { makeKey, makeHead, split, verify, entriesEnd, H } from './lastline.js';

const alice = makeKey('alice');
const hash = (n) => H(Buffer.from(`post ${n}`));
const entries = (ns) => ns.map((n) => [n, hash(n)]);
const stable = (file) => entriesEnd(split(file).body) - 1;              // up to, not including, the closing ']'
const prefixOf = (file) => split(file).body.subarray(0, stable(file));
const startOfEntries = (file) => split(file).body.indexOf('"entries":[') + '"entries":'.length;

// The reader under test: keeps the bytes it verified up to the last entry, fetches everything
// after that offset from the new file, and accepts the reconstruction only if it verifies.
const accept = (file) => verify(file, alice.x);
function tailReconstruct(cachedFile, newFile, order) {
  if (order === 'entries-first') {
    const cut = stable(cachedFile);
    return Buffer.concat([prefixOf(cachedFile), newFile.subarray(cut)]);
  }
  // prefix-first: re-read the new prefix, keep the cached middle, fetch the tail at the shifted offset.
  const newPrefix = newFile.subarray(0, startOfEntries(newFile));
  const middle = split(cachedFile).body.subarray(startOfEntries(cachedFile), stable(cachedFile));
  const cut = newPrefix.length + middle.length;
  return Buffer.concat([newPrefix, middle, newFile.subarray(cut)]);
}

const rows = [];
for (const order of ['prefix', 'entries-first']) {
  const v9 = makeHead({ hseq: 9, prev: hash('p8'), entries: entries([1, 2, 3, 4, 5]) }, alice, order);
  const v10 = makeHead({ hseq: 10, prev: H(split(v9).body), entries: entries([1, 2, 3, 4, 5, 6]) }, alice, order);
  const edited = makeHead({ hseq: 11, prev: H(split(v10).body), entries: entries([1, 2, 99, 4, 5, 6]) }, alice, order);
  const withdrawn = makeHead({ hseq: 11, prev: H(split(v10).body), entries: entries([1, 2, 4, 5, 6]) }, alice, order);
  const appended = tailReconstruct(v9, v10, order);
  const afterEdit = tailReconstruct(v10, edited, order);
  const afterWithdraw = tailReconstruct(v10, withdrawn, order);
  const middle9 = split(v9).body.subarray(startOfEntries(v9), stable(v9));
  const middle10 = split(v10).body.subarray(startOfEntries(v10), stable(v9) + (startOfEntries(v10) - startOfEntries(v9)));
  rows.push([order, {
    prefixStable: order === 'entries-first' ? prefixOf(v9).equals(split(v10).body.subarray(0, stable(v9))) : middle9.equals(middle10),
    shift: startOfEntries(v10) - startOfEntries(v9),
    appendOK: accept(appended) && appended.equals(v10),
    editRejected: !accept(afterEdit),
    withdrawRejected: !accept(afterWithdraw),
    tailBytes: v10.length - stable(v9),
    fullBytes: v10.length,
  }]);
}
const sizes = ['prefix', 'entries-first'].map((o) => makeHead({ hseq: 10, prev: hash('p'), entries: entries([1, 2, 3, 4, 5, 6]) }, alice, o).length);
const byOrder = Object.fromEntries(rows);

console.log('  order          prefix stable   hseq 9->10 shifts by   append tail / full   edit rejected   withdraw rejected');
for (const [o, r] of rows) console.log(`  ${o.padEnd(14)} ${String(r.prefixStable).padEnd(15)} ${String(r.shift).padEnd(22)} ${`${r.tailBytes} / ${r.fullBytes} B`.padEnd(19)} ${String(r.editRejected).padEnd(15)} ${r.withdrawRejected}\n`);

const gate = [
  ['entries-first: the bytes before the last entry are unchanged by an append', byOrder['entries-first'].prefixStable],
  ['prefix-first: the entries are unchanged by an append but shift by one byte when hseq gains a digit', byOrder.prefix.prefixStable && byOrder.prefix.shift === 1],
  ['a tail reconstruction after an append verifies and is byte-identical to the served head (both orders)', byOrder.prefix.appendOK && byOrder['entries-first'].appendOK],
  ['a tail reconstruction after a middle edit does not verify — the fallback is detected, never silently wrong', byOrder.prefix.editRejected && byOrder['entries-first'].editRejected],
  ['a tail reconstruction after a withdrawal does not verify either', byOrder.prefix.withdrawRejected && byOrder['entries-first'].withdrawRejected],
  ['entries-first costs zero bytes over prefix-first', sizes[0] === sizes[1]],
  ['the append tail is smaller than the full head under both orders', rows.every(([, r]) => r.tailBytes < r.fullBytes)],
];

const failed = gate.filter(([, ok]) => !ok);
for (const [what, ok] of gate) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
if (failed.length) process.exit(1);
console.log('headrange-gate: all claims hold');
