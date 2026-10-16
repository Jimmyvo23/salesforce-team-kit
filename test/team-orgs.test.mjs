import { test, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTeam } from '../lib/team.mjs';

const TEMPLATE = fileURLToPath(new URL('../templates/team.json', import.meta.url));
const base = {
  project: 'P',
  approver: { id: 'jimmy', name: 'Jimmy', role: 'Approver', color: '#ffb900' },
  members: [{ id: 'planner', name: 'Architect', role: 'Lead', color: '#6a5ae0' }],
};
let dir;
const load = (extra) => {
  const f = path.join(dir, 'team.json');
  fs.writeFileSync(f, JSON.stringify({ ...base, ...extra }));
  return loadTeam(f);
};
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sftk-team-')); });

test('orgs and orgSkill have empty defaults when absent', () => {
  const r = load({});
  expect(r.ok).toBe(true);
  expect(r.team.orgs).toEqual({ sandbox: [] });
  expect(r.team.orgSkill).toBeNull();
});

test('reads orgs.sandbox and orgSkill, trimming values', () => {
  const r = load({ orgs: { sandbox: [' uat ', 'dev'] }, orgSkill: ' nitro-salesforce ' });
  expect(r.team.orgs).toEqual({ sandbox: ['uat', 'dev'] });
  expect(r.team.orgSkill).toBe('nitro-salesforce');
});

test('an empty orgSkill means none', () => {
  expect(load({ orgSkill: '  ' }).team.orgSkill).toBeNull();
});

test('rejects bad orgs values', () => {
  expect(load({ orgs: [] })).toEqual({ ok: false, error: 'orgs must be an object' });
  expect(load({ orgs: { sandbox: 'uat' } })).toEqual({ ok: false, error: 'orgs.sandbox must be an array of non-empty strings' });
  expect(load({ orgs: { sandbox: ['uat', ''] } })).toEqual({ ok: false, error: 'orgs.sandbox must be an array of non-empty strings' });
});

test('rejects orgs.production: agents never work in production', () => {
  const r = load({ orgs: { sandbox: ['uat'], production: ['prod'] } });
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/production/);
});

test('rejects a non-string orgSkill', () => {
  expect(load({ orgSkill: 3 })).toEqual({ ok: false, error: 'orgSkill must be a string' });
});

test('the shipped template loads with the six roles and the approver', () => {
  const r = loadTeam(TEMPLATE);
  expect(r.ok).toBe(true);
  expect(r.team.members.map((m) => m.id)).toEqual(['planner', 'analyst', 'admin', 'developer', 'qa', 'reviewer']);
  expect(r.team.members[0].name).toBe('Architect');
  expect(r.team.approver.id).toBe('jimmy');
  expect(r.team.orgs.sandbox.length).toBeGreaterThan(0);
  expect(r.team.orgSkill).toBe('my-org-knowledge');
});
