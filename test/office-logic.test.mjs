import { test, expect } from 'vitest';
import { deskLabel, needsYouLine, needsYouTitle } from '../dashboard/src/labels.ts';
import { deskState } from '../dashboard/src/office-data.ts';

const agent = (id, extra = {}) => ({ id, name: id[0].toUpperCase() + id.slice(1), isApprover: false, ...extra });
const team = ['planner', 'backend', 'frontend', 'tester', 'reviewer'].map((id) => agent(id));
const jimmy = agent('jimmy', { isApprover: true });

test('needsYouTitle: plural, singular and zero', () => {
  expect(needsYouTitle('Jimmy', 2)).toBe('Jimmy, 2 things need you');
  expect(needsYouTitle('Jimmy', 1)).toBe('Jimmy, 1 thing needs you');
  expect(needsYouTitle('Jimmy', 0)).toBe('Jimmy, 0 things need you');
});

test('needsYouLine for each kind', () => {
  const agents = [...team, jimmy];
  expect(needsYouLine({ kind: 'approval', id: 'WO-3', summary: 'Booking form' }, agents))
    .toEqual({ title: 'WO-3 needs your decision', detail: 'Booking form' });
  expect(needsYouLine({ kind: 'blocked', id: 'reviewer', summary: 'Checks failing' }, agents))
    .toEqual({ title: 'Reviewer is stuck', detail: 'Checks failing' });
  expect(needsYouLine({ kind: 'escalation', id: 'T-009', summary: 'Two failed rounds' }, agents))
    .toEqual({ title: 'T-009 was escalated', detail: 'Two failed rounds' });
});

test('needsYouLine falls back to the id for an unknown agent', () => {
  expect(needsYouLine({ kind: 'blocked', id: 'ghost', summary: 'x' }, team).title).toBe('ghost is stuck');
});

const a = (extra) => ({ id: 'developer', name: 'Developer', status: 'idle', currentTask: null, reason: null, ...extra });

test('deskLabel: stuck desks say why', () => {
  expect(deskLabel(a({ status: 'blocked', currentTask: 'T-102', reason: '1 Apex test failing' }))).toBe('Developer, stuck: 1 Apex test failing');
});
test('deskLabel: working desks name the task; free desks say nothing assigned', () => {
  expect(deskLabel(a({ status: 'working', currentTask: 'T-102' }))).toBe('Developer, working: T-102');
  expect(deskLabel(a({}))).toBe('Developer, on a break: nothing assigned');
});
test('deskState maps every agent status', () => {
  expect(['working', 'blocked', 'awaiting_approval', 'done', 'idle'].map(deskState)).toEqual(['working', 'blocked', 'waiting', 'done', 'free']);
});
