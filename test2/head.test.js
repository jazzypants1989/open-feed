// §5 — the head: the fold, one hash per number, photos, top, the pinned checks, the rewrite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, checkHead, checkAgainstPin, liveEntries } from '../src2/head.js';

const live = (s) => [...s.live.keys()];

test('§5.2 the fold: admit, withdraw, re-list at the identical hash only', () => {
  assert.deepEqual(live(fold([[1, 'a'], [2, 'b'], [1, null]])), [2]);
  assert.equal(fold([[1, 'a'], [1, null], [1, 'b']]), null, 'another hash, ever');
  assert.deepEqual(live(fold([[1, 'a'], [1, null], [1, 'a']])), [1], 'the same bytes come back');
  assert.equal(fold([[1, 'a'], [1, 'a']]), null, 'a live number listed twice');
  assert.equal(fold([[2, null]]), null, 'a withdrawal of nothing');
  assert.equal(fold([[0, 'a']]), null); assert.equal(fold([[1.5, 'a']]), null); assert.equal(fold([[1, 'a', 'pending']]), null, 'the retired three-element line');
  assert.equal(fold([[1, 'a'], [1, null], [1, null]]), null, 'withdrawn twice');
  assert.equal(fold([[1, 'a'], [1, null], [1, 'a'], [1, null]]).live.size, 0);
  assert.equal(fold([[1, 'a'], [2, 'b'], [2, null]]).top, 2, 'top counts what was issued');
});

test('§5.4 photos: listed by hash, new whenever they appear, withdrawn by [hash, null]', () => {
  assert.deepEqual(live(fold([['h1'], ['h2'], ['h1', null]])), ['h2']);
  assert.equal(fold([['h1'], ['h1']]), null);
  assert.equal(fold([['h1', null]]), null);
  assert.deepEqual(live(fold([['h1'], ['h1', null], ['h1']])), ['h1'], 'a withdrawn photo may return');
  assert.equal(fold([['h1', 'x']]), null);
});

test('§5 / §5.3 the head\'s shape: entries first, hseq and top integers, top at or above the highest number', () => {
  const set = fold([[3, 'c']]);
  assert.equal(checkHead({ entries: [[3, 'c']], hseq: 1, top: 3 }, set), null);
  assert.match(checkHead({ hseq: 1, entries: [[3, 'c']], top: 3 }, set), /first member/);
  assert.match(checkHead({ entries: [[3, 'c']], hseq: 1, top: 2 }, set), /top/);
  assert.match(checkHead({ entries: [[3, 'c']], hseq: -1, top: 3 }, set), /hseq/);
  assert.equal(checkHead({ entries: [[3, 'c']], hseq: 1, top: 7 }, set), null, 'top may run ahead of what is listed');
});

test('§8.2 step 9 against a pin: no rollback, no insertion below top, no change, withdrawn hashes remembered', () => {
  const pin = { hseq: 2, hhash: 'H2', top: 3, live: new Map([[1, 'a'], [3, 'c']]), withdrawn: new Map([[2, 'b']]) };
  const ok = (entries, hseq = 3, top = 3, address = 'H3') => checkAgainstPin({ obj: { hseq, top }, address }, fold(entries), pin);
  assert.equal(ok([[1, 'a'], [3, 'c']]).notes.length, 0);
  assert.equal(ok([[1, 'a'], [3, 'c']], 1).why, 'a head older than the one this reader saw');
  assert.equal(ok([[1, 'a'], [3, 'c']], 2, 3, 'other').why, 'two heads at one version');
  assert.equal(ok([[1, 'a'], [3, 'c']], 2, 3, 'H2').notes.length, 0, 'the same head again');
  assert.equal(ok([[1, 'a'], [3, 'c']], 3, 2).why, 'the highest number used went backwards');
  assert.equal(ok([[1, 'a'], [2, 'b'], [3, 'c']]).notes.length, 0, 'post 2 comes back at the hash it had');
  assert.equal(ok([[1, 'a'], [2, 'x'], [3, 'c']]).why, 'post 2 changed after the reader saw it');
  assert.equal(ok([[1, 'x'], [3, 'c']]).why, 'post 1 changed after the reader saw it');
  assert.equal(ok([[1, 'a'], [3, 'c']], 3, 5).notes.length, 0, 'top may rise without posts');
  assert.equal(ok([[1, 'a'], [3, 'c'], [4, 'd']], 3, 4).notes.length, 0, 'a new number above the old top');
  assert.equal(ok([[1, 'a'], [3, 'c'], [2, 'z']], 3, 3).why, 'post 2 changed after the reader saw it');
  assert.equal(checkAgainstPin({ obj: { hseq: 3, top: 3 }, address: 'H3' }, fold([[1, 'a'], [3, 'c']]), { ...pin, withdrawn: new Map(), live: new Map([[1, 'a'], [3, 'c']]) }).notes.length, 0);
  assert.equal(checkAgainstPin({ obj: { hseq: 3, top: 3 }, address: 'H3' }, fold([[1, 'a'], [2, 'b'], [3, 'c']]), { ...pin, withdrawn: new Map() }).why, 'post 2 is listed now and was not before');
  const r = ok([[3, 'c']]);
  assert.deepEqual(r.notes, ['withdrawn: 1']); assert.equal(r.withdrawn.get(1), 'a'); assert.equal(r.withdrawn.get(2), 'b');
  assert.deepEqual(live(fold([[1, 'a'], [3, 'c'], ['p']])), [1, 3, 'p']);
  assert.equal(ok([[1, 'a'], [3, 'c'], ['p']]).notes.length, 0, 'a photo is exempt: it has no number');
});

test('§5.7 a rewrite keeps the live set, in order, and drops what withdrawals left behind', () => {
  assert.deepEqual(liveEntries([[1, 'a'], [2, 'b'], ['p'], [1, null], [3, 'c'], ['p', null], [1, 'a']]), [[2, 'b'], [3, 'c'], [1, 'a']]);
});
