import { test, expect } from 'vitest';
import { freshSince } from '../dashboard/src/fresh.ts';

const k = (x) => x.id;

test('the first poll is history: nothing is fresh', () => {
  const r = freshSince(null, [{ id: 'a' }, { id: 'b' }], k);
  expect(r.fresh).toEqual([]);
  expect([...r.seen]).toEqual(['a', 'b']);
});

test('later polls return only new keys and remember them', () => {
  const first = freshSince(null, [{ id: 'a' }], k);
  const second = freshSince(first.seen, [{ id: 'a' }, { id: 'c' }], k);
  expect(second.fresh).toEqual([{ id: 'c' }]);
  expect(freshSince(second.seen, [{ id: 'a' }, { id: 'c' }], k).fresh).toEqual([]);
});

test('a key that changes (release ready → released) counts as new', () => {
  const key = (r) => `${r.task}|${r.state}`;
  const first = freshSince(null, [{ task: 'T-1', state: 'ready' }], key);
  expect(freshSince(first.seen, [{ task: 'T-1', state: 'released' }], key).fresh).toHaveLength(1);
});
