import { test, expect } from 'vitest';
import { activeTasks, latestDeploy, lastDeployBy, readyReleases, lastReleased, guardBubbles, deployLine, TASKS_CARD_MAX, GUARD_BUBBLE_MS } from '../dashboard/src/office-data.ts';

const task = (id, state, progress) => ({ id, title: id, owner: 'admin', state, notes: '', progress, stage: '' });

test('activeTasks drops finished tasks, keeps board order, caps at 5', () => {
  const list = [task('A', 'done', 100), task('B', 'todo', 5), task('C', 'in_progress', 65), task('D', 'in_review', 100),
    task('E', 'in_review', 95), task('F', 'todo', 20), task('G', 'todo', 5), task('H', 'todo', 5)];
  expect(TASKS_CARD_MAX).toBe(5);
  expect(activeTasks(list).map((t) => t.id)).toEqual(['C', 'E', 'B', 'F', 'G']);
});

const dep = (org, agent, time, extra = {}) => ({ org, agent, result: 'passed', tests: '142/142', coverage: 87, task: null, time, ...extra });

test('latestDeploy and lastDeployBy pick the newest', () => {
  const list = [dep('a', 'admin', '2026-10-05T10:00:00Z'), dep('b', 'developer', '2026-10-05T10:02:00Z')];
  expect(latestDeploy(list).org).toBe('b');
  expect(latestDeploy([])).toBeNull();
  expect(lastDeployBy('admin', list).org).toBe('a');
  expect(lastDeployBy('qa', list)).toBeNull();
});

test('deployLine says pass or fail in words, not only a mark', () => {
  expect(deployLine(dep('a', 'x', 't'))).toBe('✓ passed · 142/142 tests · 87%');
  expect(deployLine(dep('a', 'x', 't', { result: 'failed', tests: null, coverage: null }))).toBe('✗ failed');
});

test('readyReleases newest first; lastReleased', () => {
  const r = [
    { task: 'A', state: 'released', components: 4, file: null, time: '2026-10-05T09:52:00Z' },
    { task: 'B', state: 'ready', components: 3, file: null, time: '2026-10-05T09:55:00Z' },
    { task: 'C', state: 'ready', components: 1, file: null, time: '2026-10-05T09:58:00Z' },
  ];
  expect(readyReleases(r).map((x) => x.task)).toEqual(['C', 'B']);
  expect(lastReleased(r).task).toBe('A');
  expect(lastReleased([])).toBeNull();
});

test('guardBubbles keeps blocks newer than a minute, newest per agent', () => {
  const now = '2026-10-05T10:10:00.000Z';
  const b = (agent, time) => ({ agent, command: 'x', reason: time, time });
  const out = guardBubbles([b('dev', '2026-10-05T10:08:00Z'), b('dev', '2026-10-05T10:09:30Z'), b('qa', '2026-10-05T10:08:59Z')], now);
  expect(GUARD_BUBBLE_MS).toBe(60_000);
  expect(Object.keys(out)).toEqual(['dev']);
  expect(out.dev.time).toBe('2026-10-05T10:09:30Z');
});
