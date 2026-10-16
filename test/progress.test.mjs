import { test, expect } from 'vitest';
import { taskProgress, isBuilder, emptyTrack, ROLES } from '../lib/progress.mjs';

const task = { id: 'T-012', state: 'in_progress' };
const acc = (o = {}) => ({ approvals: [], releases: [], taskTrack: {}, ...o });
const approved = [{ task: 'T-012', state: 'approved' }, { task: 'T-012', state: 'approved' }];
const p = (a, agents = [], t = task) => taskProgress(t, a, agents, 'jimmy');

test('roles and builders', () => {
  expect(ROLES).toEqual({ architect: 'planner', analyst: 'analyst', qa: 'qa', reviewer: 'reviewer' });
  for (const id of ['admin', 'developer']) expect(isBuilder(id, 'jimmy')).toBe(true);
  for (const id of ['planner', 'analyst', 'qa', 'reviewer', 'jimmy', 'team', '']) expect(isBuilder(id, 'jimmy')).toBe(false);
  expect(emptyTrack()).toEqual({ deployed: false, qaPassed: false, reviewed: false, back: false });
});

test('a new task is 5% To do', () => {
  expect(p(acc())).toEqual({ progress: 5, stage: 'To do' });
});

test('a pending approval for the task is 20%', () => {
  expect(p(acc({ approvals: [{ task: 'T-012', state: 'pending' }, { task: 'T-012', state: 'approved' }] })))
    .toEqual({ progress: 20, stage: 'Waiting for approval' });
});

test('approvals for other tasks do not count', () => {
  expect(p(acc({ approvals: [{ task: 'T-099', state: 'pending' }, { task: null, state: 'approved' }] })))
    .toEqual({ progress: 5, stage: 'To do' });
});

test('all approved: 30% plus 30% of the builders\' average progress', () => {
  expect(p(acc({ approvals: approved }))).toEqual({ progress: 30, stage: 'Approved' });
  const agents = [
    { id: 'admin', currentTask: 'T-012', progress: 60 },
    { id: 'developer', currentTask: 'T-012', progress: 40 },
    { id: 'qa', currentTask: 'T-012', progress: 100 },
    { id: 'admin2', currentTask: 'T-099', progress: 100 },
  ];
  expect(p(acc({ approvals: approved }), agents)).toEqual({ progress: 45, stage: 'Building' });
});

test('sent back with no builders yet shows Back to build at 30%', () => {
  const a = acc({ approvals: approved, taskTrack: { 'T-012': { ...emptyTrack(), back: true } } });
  expect(p(a, [])).toEqual({ progress: 30, stage: 'Back to build' });
});

test('milestones in order', () => {
  const t = (o) => ({ 'T-012': { ...emptyTrack(), ...o } });
  expect(p(acc({ approvals: approved, taskTrack: t({ deployed: true }) }))).toEqual({ progress: 65, stage: 'In sandbox' });
  expect(p(acc({ taskTrack: t({ deployed: true, qaPassed: true }) }))).toEqual({ progress: 80, stage: 'QA passed' });
  expect(p(acc({ taskTrack: t({ qaPassed: true, reviewed: true }) }))).toEqual({ progress: 90, stage: 'Review passed' });
  expect(p(acc({ releases: [{ task: 'T-012', state: 'ready' }] }))).toEqual({ progress: 95, stage: 'Change set ready' });
  expect(p(acc({ releases: [{ task: 'T-012', state: 'released' }] }))).toEqual({ progress: 100, stage: 'Released' });
});

test('sent back to the builder shows Back to build', () => {
  const a = acc({ approvals: approved, taskTrack: { 'T-012': { ...emptyTrack(), back: true } } });
  expect(p(a, [{ id: 'developer', currentTask: 'T-012', progress: 80 }])).toEqual({ progress: 54, stage: 'Back to build' });
});

test('a done task without a release is 100% Done', () => {
  expect(p(acc(), [], { id: 'T-012', state: 'done' })).toEqual({ progress: 100, stage: 'Done' });
});
