import { test, expect } from 'vitest';
import { validateEvent, DEPLOY_RESULTS, EVENT_TYPES } from '../lib/events.mjs';

const ok = (e) => expect(validateEvent({ source: 'cli', ...e })).toEqual({ ok: true });
const bad = (e, msg) => {
  const r = validateEvent({ source: 'cli', ...e });
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(msg);
};

test('lists the new types and deploy results', () => {
  for (const t of ['deploy', 'release', 'released', 'guard_blocked']) expect(EVENT_TYPES).toContain(t);
  expect(DEPLOY_RESULTS).toEqual(['passed', 'failed']);
});

test('deploy', () => {
  ok({ type: 'deploy', agent: 'admin', org: 'uat', result: 'passed' });
  ok({ type: 'deploy', agent: 'developer', org: 'uat', result: 'failed', tests: '37/38', coverage: 91, task: 'T-012' });
  bad({ type: 'deploy', agent: 'admin', org: 'uat' }, /result/);
  bad({ type: 'deploy', agent: 'admin', org: 'uat', result: 'ok' }, /result/);
  bad({ type: 'deploy', agent: 'admin', result: 'passed' }, /org/);
  bad({ type: 'deploy', agent: 'admin', org: 'uat', result: 'passed', coverage: 101 }, /coverage/);
  bad({ type: 'deploy', agent: 'admin', org: 'uat', result: 'passed', coverage: 9.5 }, /coverage/);
  bad({ type: 'deploy', agent: 'admin', org: 'uat', result: 'passed', tests: '38' }, /tests/);
});

test('release and released', () => {
  ok({ type: 'release', agent: 'planner', task: 'T-012', components: 9, file: 'docs/release/T-012-changeset.md' });
  bad({ type: 'release', agent: 'planner', task: 'T-012' }, /components/);
  bad({ type: 'release', agent: 'planner', task: 'T-012', components: 0 }, /components/);
  ok({ type: 'released', agent: 'planner', task: 'T-012' });
  bad({ type: 'released', agent: 'planner' }, /task/);
});

test('guard_blocked', () => {
  ok({ type: 'guard_blocked', agent: 'developer', reason: 'not a sandbox', command: 'Running sf project', source: 'hook' });
  bad({ type: 'guard_blocked', agent: 'developer', source: 'hook' }, /reason/);
});

test('approval_requested accepts an optional task', () => {
  ok({ type: 'approval_requested', id: 'WO-7-admin', summary: 's', task: 'T-012' });
  bad({ type: 'approval_requested', id: 'WO-7-admin', summary: 's', task: ' ' }, /task/);
});
