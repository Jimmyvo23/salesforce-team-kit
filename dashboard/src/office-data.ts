import type { AgentStatus, Deploy, GuardBlock, Release, Task } from './types';
import { TASK_COLUMNS } from './labels';

export type DeskState = 'working' | 'blocked' | 'waiting' | 'done' | 'free';

const DESK: Record<AgentStatus, DeskState> = {
  working: 'working', blocked: 'blocked', awaiting_approval: 'waiting', done: 'done', idle: 'free',
};

/** How a desk looks for an agent status (spec 8.2). */
export const deskState = (s: AgentStatus): DeskState => DESK[s];

export const TASKS_CARD_MAX = 5;
export const GUARD_BUBBLE_MS = 60_000;

const ORDER = new Map(TASK_COLUMNS.map((c, i) => [c.state, i]));
const newest = <T extends { time: string }>(list: T[]): T | null =>
  list.reduce<T | null>((best, x) => (best === null || Date.parse(x.time) > Date.parse(best.time) ? x : best), null);

/** Tasks still moving, in board order (in progress, in review, to do), at most `max`. */
export function activeTasks(tasks: Task[], max = TASKS_CARD_MAX): Task[] {
  const live = tasks.filter((t) => t.state !== 'done' && t.progress < 100);
  const rank = (t: Task) => (t.state === 'todo' ? 9 : ORDER.get(t.state) ?? 9);
  return [...live].sort((a, b) => rank(a) - rank(b)).slice(0, max);
}

export const latestDeploy = (deploys: Deploy[]): Deploy | null => newest(deploys);
export const lastDeployBy = (agentId: string, deploys: Deploy[]): Deploy | null => newest(deploys.filter((d) => d.agent === agentId));

/** "✓ passed · 142/142 tests · 87%" — the word is there so colour and mark are never the only signal. */
export function deployLine(d: Deploy): string {
  const parts = [d.result === 'passed' ? '✓ passed' : '✗ failed'];
  if (d.tests) parts.push(`${d.tests} tests`);
  if (d.coverage !== null) parts.push(`${d.coverage}%`);
  return parts.join(' · ');
}

export const readyReleases = (releases: Release[]): Release[] =>
  releases.filter((r) => r.state === 'ready').sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
export const lastReleased = (releases: Release[]): Release | null => newest(releases.filter((r) => r.state === 'released'));

/** Newest guard block per agent within `ms` of the server clock `now`. */
export function guardBubbles(blocks: GuardBlock[], now: string, ms = GUARD_BUBBLE_MS): Record<string, GuardBlock> {
  const out: Record<string, GuardBlock> = {};
  const t = Date.parse(now);
  for (const b of blocks) {
    if (t - Date.parse(b.time) > ms) continue;
    if (!out[b.agent] || Date.parse(b.time) > Date.parse(out[b.agent].time)) out[b.agent] = b;
  }
  return out;
}
