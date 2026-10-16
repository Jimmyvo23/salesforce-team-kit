import { test, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTeam } from '../lib/team.mjs';

const template = fileURLToPath(new URL('../templates/team.json', import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atk-team-'));
let n = 0;
const write = (content) => {
  const p = path.join(dir, `t${n++}.json`);
  fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
  return p;
};
const m = (id, extra = {}) => ({ id, name: id, role: 'r', color: '#aabbcc', ...extra });
const team = (over = {}) => ({ project: 'P', approver: m('jimmy'), members: [m('backend')], ...over });

test('loads the template', () => {
  const r = loadTeam(template);
  expect(r.ok && r.team.members.map((x) => x.id)).toEqual(['planner', 'analyst', 'admin', 'developer', 'qa', 'reviewer']);
  expect(r.ok && r.team.approver.id).toBe('jimmy');
});
test('missing file', () => expect(loadTeam('/nope.json')).toEqual({ ok: false, error: expect.stringContaining('not found') }));
test('invalid JSON names the problem', () => expect(loadTeam(write('{oops')).error).toMatch(/not valid JSON/));
test('duplicate ids rejected', () => expect(loadTeam(write(team({ members: [m('backend'), m('backend')] }))).error).toMatch(/duplicate id "backend"/));
test('duplicate after normalization, and with approver', () => {
  expect(loadTeam(write(team({ members: [m('backend'), m(' Backend ')] }))).error).toMatch(/duplicate id "backend"/);
  expect(loadTeam(write(team({ members: [m('Jimmy')] }))).error).toMatch(/duplicate id "jimmy"/);
});
test('bad color rejected', () => expect(loadTeam(write(team({ members: [m('backend', { color: 'red' })] }))).error).toMatch(/color/));
test('ids normalized', () => {
  const r = loadTeam(write(team({ approver: m(' JIMMY '), members: [m(' Backend ')] })));
  expect(r.team.members[0].id).toBe('backend');
  expect(r.team.approver.id).toBe('jimmy');
});
test('staleAfterMinutes defaults to 5', () => expect(loadTeam(write(team())).team.staleAfterMinutes).toBe(5));
test('staleAfterMinutes honoured and validated', () => {
  expect(loadTeam(write(team({ staleAfterMinutes: 10 }))).team.staleAfterMinutes).toBe(10);
  for (const bad of [0, -1, '5', null]) expect(loadTeam(write(team({ staleAfterMinutes: bad }))).error).toMatch(/staleAfterMinutes/);
});
test('structural errors name the field', () => {
  expect(loadTeam(write('[]')).error).toMatch(/object/);
  expect(loadTeam(write(team({ project: '' }))).error).toMatch(/project/);
  expect(loadTeam(write({ project: 'P', members: [m('a')] })).error).toMatch(/approver/);
  expect(loadTeam(write({ project: 'P', approver: m('j') })).error).toMatch(/members/);
  expect(loadTeam(write(team({ members: [] }))).error).toMatch(/members/);
  expect(loadTeam(write(team({ members: [m('a', { name: '' })] }))).error).toMatch(/members\[0\].*name/);
  expect(loadTeam(write(team({ members: [m('a', { role: 5 })] }))).error).toMatch(/role/);
  expect(loadTeam(write(team({ approver: m('j', { id: '' }) }))).error).toMatch(/approver.*id/);
});
