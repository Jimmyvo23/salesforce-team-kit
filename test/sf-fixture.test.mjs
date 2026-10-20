import path from 'node:path';
import { test, expect } from 'vitest';
import { readEvents, validateEvent } from '../lib/events.mjs';
import { loadTeam } from '../lib/team.mjs';
import { buildState } from '../lib/state.mjs';
import { FIXTURE_NOW } from './fixtures/projects/fixture-clock.mjs';

const dir = path.resolve('test/fixtures/projects/sf-office/.team');
const load = () => {
  const loaded = loadTeam(path.join(dir, 'team.json'));
  if (!loaded.ok) throw new Error(loaded.error);
  const { events } = readEvents(path.join(dir, 'events.jsonl'));
  return { team: loaded.team, events, state: buildState(events, loaded.team, new Date(FIXTURE_NOW)) };
};

test('every sf-office event is valid', () => {
  const { events } = load();
  expect(events.length).toBeGreaterThan(15);
  for (const e of events) expect(validateEvent(e)).toEqual({ ok: true });
});

test('sf-office covers every office event the dashboard draws', () => {
  const { state } = load();
  expect(state.agents.map((a) => a.id)).toEqual(['planner', 'analyst', 'admin', 'developer', 'qa', 'reviewer', 'jimmy']);
  expect(state.deploys.map((d) => `${d.org}:${d.result}`).sort()).toEqual(['cleanup-sandbox:passed', 'sandbox:failed']);
  expect(state.releases.map((r) => `${r.task}:${r.state}`).sort()).toEqual(['T-100:released', 'T-104:ready']);
  expect(state.guardBlocks).toHaveLength(1);
  expect(state.handoffs).toHaveLength(1);
  const stage = Object.fromEntries(state.tasks.map((t) => [t.id, `${t.progress} ${t.stage}`]));
  expect(stage).toEqual({
    'T-100': '100 Released', 'T-101': '65 In sandbox', 'T-102': '30 Building', 'T-103': '5 To do',
    'T-104': '95 Change set ready', 'T-105': '20 Waiting for approval',
  });
  expect(state.needsYou.map((n) => n.kind).sort()).toEqual(['approval', 'blocked']);
});
