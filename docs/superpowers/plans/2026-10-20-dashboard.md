# Dashboard (Isometric Cloud Office) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the upstream cutaway building with the isometric cloud office from spec section 8: SVG desks built from `team.json`, a day-cycle mood with a theme picker, sky cards and flights for deploys and releases, task progress everywhere, and full reduced-motion support.

**Architecture:** Front-end only. The engine (`lib/state.mjs`, `lib/progress.mjs`) already serves `deploys`, `releases`, `guardBlocks` and per-task `progress`/`stage` at `GET /api/team`. New pure modules (`iso.ts`, `mood.ts`, `fresh.ts`, `office-data.ts`) hold all maths and selection logic and are unit-tested with Vitest. React components render an SVG scene (`IsoOffice`, `Desk`, `SkyCards`, `Flights`) with HTML overlays for text-heavy cards. Playwright covers behaviour against a new Salesforce fixture.

**Tech Stack:** Vite 6 + React 19 + TypeScript 5 in `dashboard/src`, Vitest 3 (tests are `test/**/*.test.mjs` importing `.ts` directly), Playwright 1.50 (`test/e2e`, runs against `dashboard/dist` built in global setup).

**Spec:** `docs/superpowers/specs/2026-10-15-salesforce-team-kit-design.md` (section 8, plus 9 "Dashboard units" / "End to end") and the mockup `docs/superpowers/specs/2026-10-15-salesforce-team-kit-office-mockup.html` (palettes and scene geometry come from its `PAL`, `K` and `scene()`).

## Global Constraints

- Node `>=20`; no new runtime or dev dependencies (Impeccable is a Claude Code plugin, Task 10, only with Jimmy's yes).
- One desk per member, three per row, in `team.json` order; the approver sits in a glass corner office.
- Approver name always comes from state (`agents.find(a => a.isApprover).name`), never the literal "Jimmy" in source (org-ready rule).
- Mood keyframes, local time: 0–5 Night shift, 7–9.5 Sunrise, 10.5–16.5 Mint morning, 17.5–19.5 Twilight, 21–24 Night shift. Blend colours in OKLCH. Re-render the palette once a minute.
- Theme picker: **Auto** (default) + Night shift, Sunrise, Mint morning, Twilight. Stored in `localStorage` key `salesforce-team-kit.mood`, every access in try/catch.
- `prefers-reduced-motion: reduce` → nothing scrolls, pulses, drifts, flies, bobs or twinkles. Every animation lives inside `@media (prefers-reduced-motion: no-preference)`. Never SMIL (`<animate>`, `<animateMotion>`): it ignores the media query.
- Desks are focusable buttons (`role="button"`, `tabIndex={0}`, Enter/Space/click toggles the Clipboard pin).
- Status is never colour alone: every chip, card and bubble carries text; List view carries the same information.
- Below 480px the page opens in List view (unchanged).
- State wording comes only from `STATE_LABELS` in `labels.ts`.
- Guard-blocked bubble shows for 60 s after the block (`GUARD_BUBBLE_MS = 60_000`), measured against the server clock `state.updatedAt`.
- Tasks cloud card lists at most 5 active tasks.
- Vault label: `Production · deployed by <approver name> via change set`.
- Every commit ends with the implementer's own harness `Co-Authored-By` trailer (Ruling T2-b of earlier plans).

## Execution notes (token budget — see Ruling T7-a)

- No Salesforce PDFs are needed for this plan. Do not open them.
- Task reviewers run on Sonnet; the final whole-branch review runs on the most capable model.
- Minor review findings are deferred to the final review unless they break a test or the spec.
- Run e2e only for the spec file a task touches (`npx playwright test test/e2e/<file>`), plus the full suite once in Task 9.
- Branch: `feature/dashboard` (already created from `main` at 8de2225).

## File map

| File | Status | Responsibility |
|---|---|---|
| `dashboard/src/types.ts` | modify | Add `Deploy`, `Release`, `GuardBlock`; `Task.progress/stage`; `TeamState.deploys/releases/guardBlocks` |
| `test/fixtures/projects/sf-office/.team/{team.json,events.jsonl}` | create | Salesforce fixture used by all new e2e specs |
| `dashboard/src/iso.ts` | create | Projection, layout for any member count, box faces, arc paths |
| `dashboard/src/mood.ts` | create | Palettes, OKLCH blend, `moodAt`, `moodTokens` |
| `dashboard/src/useMood.ts` | create | Stored choice + once-a-minute palette, applies tokens to `<html>` |
| `dashboard/src/components/MoodPicker.tsx` | create (replaces `ThemeToggle.tsx`) | Auto + 4 moods radio group |
| `dashboard/src/components/IsoOffice.tsx` | create (replaces `Building.tsx`) | The SVG scene and its HTML overlays |
| `dashboard/src/components/Desk.tsx` | create (replaces `Room.tsx`, `Figure.tsx`) | One desk, person, screen state, chip |
| `dashboard/src/office-data.ts` | create | Pure selectors: active tasks, latest deploy, ready releases, guard bubbles, desk label |
| `dashboard/src/fresh.ts` | create | Pure "new since last poll" diff + `useFresh` hook (replaces `useArrivals`) |
| `dashboard/src/components/SkyCards.tsx` | create | Tasks card, sandbox cloud, production vault, change-set parcel, guard bubbles |
| `dashboard/src/components/Flights.tsx` | create (replaces `MailTube.tsx`) | Handoff folder arcs, deploy parcel, released parcel |
| `dashboard/src/components/ProgressBar.tsx` | create | Shared task bar: %, stage, `role="progressbar"` |
| `dashboard/src/components/{Lobby,Clipboard,ListView,PreviewCard}.tsx` | modify | Task progress, last deploy, Releases section |
| `dashboard/src/App.tsx` | modify | Wire everything; drop Building/MailTube/ThemeToggle |
| `dashboard/src/theme.css`, `office.css` | modify | Mood-driven tokens; iso scene styles; motion guard |
| `dashboard/src/rooms.ts`, `components/{Building,Room,Figure,MailTube,ThemeToggle}.tsx` | delete | Replaced |
| `test/{iso,mood,office-data,fresh,sf-fixture}.test.mjs` | create | Unit tests |
| `test/office-logic.test.mjs` | modify | Drop `orderRooms` tests; add `deskLabel` tests |
| `test/e2e/office.spec.ts`, `office-extras.spec.ts`, `office-sf.spec.ts` | modify / create | e2e |

---

### Task 1: Types and the Salesforce fixture

**Files:**
- Modify: `dashboard/src/types.ts`
- Create: `test/fixtures/projects/sf-office/.team/team.json`, `test/fixtures/projects/sf-office/.team/events.jsonl`
- Test: `test/sf-fixture.test.mjs`

**Interfaces:**
- Produces: types `Deploy`, `Release`, `GuardBlock`; `Task` gains `progress: number; stage: string`; `Approval` gains `task: string | null`; `TeamState` gains `deploys: Deploy[]; releases: Release[]; guardBlocks: GuardBlock[]`. Fixture `sf-office` used by every later e2e spec.

- [ ] **Step 1: Write the failing test** — `test/sf-fixture.test.mjs`

```js
import path from 'node:path';
import { test, expect } from 'vitest';
import { readEvents, validateEvent } from '../lib/events.mjs';
import { loadTeam } from '../lib/team.mjs';
import { buildState } from '../lib/state.mjs';
import { FIXTURE_NOW } from './fixtures/projects/fixture-clock.mjs';

const dir = path.resolve('test/fixtures/projects/sf-office/.team');
const load = () => {
  const team = loadTeam(path.join(dir, 'team.json'));
  const events = readEvents(path.join(dir, 'events.jsonl'));
  return { team, events, state: buildState(events, team, new Date(FIXTURE_NOW)) };
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
```

Note: if `readEvents` returns `{ events, errors }` or similar rather than an array, adapt the two lines that read it (check `lib/events.mjs:141`); do not change the assertions.

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run test/sf-fixture.test.mjs`
Expected: FAIL (fixture files do not exist).

- [ ] **Step 3: Create the fixture**

`test/fixtures/projects/sf-office/.team/team.json` — same members and colours as `templates/team.json`, project `Nitro Cleanup`, no `orgSkill`:

```json
{
  "project": "Nitro Cleanup",
  "staleAfterMinutes": 5,
  "orgs": { "sandbox": ["sandbox", "cleanup-sandbox"] },
  "approver": { "id": "jimmy", "name": "Jimmy", "role": "Approves every Work Order and deploys to production", "color": "#ffb900" },
  "members": [
    { "id": "planner",   "name": "Architect", "role": "Designs the solution and runs the team", "color": "#6a5ae0" },
    { "id": "analyst",   "name": "Analyst",   "role": "Stories, acceptance criteria, UAT",      "color": "#f2a33a" },
    { "id": "admin",     "name": "Admin",     "role": "Flows, objects, permissions",            "color": "#12a37c" },
    { "id": "developer", "name": "Developer", "role": "Apex, LWC, integrations",                "color": "#2f86e8" },
    { "id": "qa",        "name": "QA",        "role": "Tests and verifies in the sandbox",      "color": "#e0559a" },
    { "id": "reviewer",  "name": "Reviewer",  "role": "Final check before release",             "color": "#6b7a90" }
  ]
}
```

If `loadTeam` rejects any key here (e.g. `orgs` shape), match `templates/team.json` exactly instead.

`test/fixtures/projects/sf-office/.team/events.jsonl` (one JSON object per line, times before `FIXTURE_NOW` = `2026-10-05T10:10:00.000Z`):

```
{"time":"2026-10-05T09:40:00.000Z","source":"cli","type":"task","id":"T-100","title":"Data residency picklist","owner":"admin","state":"done"}
{"time":"2026-10-05T09:41:00.000Z","source":"cli","type":"task","id":"T-101","title":"Renewal discount flow","owner":"admin","state":"in_progress"}
{"time":"2026-10-05T09:41:00.000Z","source":"cli","type":"task","id":"T-102","title":"Quote line trigger fix","owner":"developer","state":"in_progress"}
{"time":"2026-10-05T09:42:00.000Z","source":"cli","type":"task","id":"T-103","title":"UAT script for renewals","owner":"analyst","state":"todo"}
{"time":"2026-10-05T09:42:00.000Z","source":"cli","type":"task","id":"T-104","title":"Account classification formula","owner":"admin","state":"in_review"}
{"time":"2026-10-05T09:43:00.000Z","source":"cli","type":"task","id":"T-105","title":"Order sync Apex","owner":"developer","state":"todo"}
{"time":"2026-10-05T09:44:00.000Z","source":"cli","type":"approval_requested","agent":"planner","id":"WO-7","summary":"Work Order for T-101: renewal discount flow","agents":["admin"],"task":"T-101"}
{"time":"2026-10-05T09:45:00.000Z","source":"cli","type":"approval_decided","agent":"jimmy","id":"WO-7","state":"approved"}
{"time":"2026-10-05T09:46:00.000Z","source":"cli","type":"approval_requested","agent":"planner","id":"WO-8","summary":"Work Order for T-102: quote line trigger fix","agents":["developer"],"task":"T-102"}
{"time":"2026-10-05T09:47:00.000Z","source":"cli","type":"approval_decided","agent":"jimmy","id":"WO-8","state":"approved"}
{"time":"2026-10-05T09:50:00.000Z","source":"cli","type":"release","agent":"planner","task":"T-100","components":4}
{"time":"2026-10-05T09:52:00.000Z","source":"cli","type":"released","agent":"planner","task":"T-100","note":"Deployed by change set"}
{"time":"2026-10-05T09:55:00.000Z","source":"cli","type":"release","agent":"planner","task":"T-104","components":3}
{"time":"2026-10-05T10:00:00.000Z","source":"cli","type":"deploy","agent":"admin","org":"cleanup-sandbox","result":"passed","tests":"142/142","coverage":87,"task":"T-101"}
{"time":"2026-10-05T10:02:00.000Z","source":"cli","type":"deploy","agent":"developer","org":"sandbox","result":"failed","tests":"140/141","coverage":81,"task":"T-102"}
{"time":"2026-10-05T10:03:00.000Z","source":"cli","type":"handoff","from":"analyst","to":"qa","task":"T-103"}
{"time":"2026-10-05T10:04:00.000Z","source":"cli","type":"approval_requested","agent":"planner","id":"WO-9","summary":"Work Order for T-105: order sync Apex","agents":["developer"],"task":"T-105"}
{"time":"2026-10-05T10:06:00.000Z","source":"cli","type":"status","agent":"planner","status":"working","task":"T-105","progress":40,"nextStep":"Answer Jimmy on WO-9"}
{"time":"2026-10-05T10:07:00.000Z","source":"cli","type":"status","agent":"analyst","status":"working","task":"T-103","progress":50,"nextStep":"Write the renewal UAT steps"}
{"time":"2026-10-05T10:08:00.000Z","source":"cli","type":"status","agent":"admin","status":"working","task":"T-101","progress":60,"nextStep":"Hand the flow to QA"}
{"time":"2026-10-05T10:08:30.000Z","source":"cli","type":"status","agent":"developer","status":"blocked","task":"T-102","reason":"1 Apex test failing"}
{"time":"2026-10-05T10:09:40.000Z","source":"hook","type":"guard_blocked","agent":"developer","command":"sf project deploy start -o prod","reason":"prod is not a sandbox alias"}
```

T-102 is `30 Building`: WO-8 is approved and the blocked developer is still on T-102 at 0% (`lib/progress.mjs` counts any builder whose `currentTask` matches). The engine is frozen for this plan; if a number differs, recheck the fixture, not the engine.

- [ ] **Step 4: Extend `dashboard/src/types.ts`**

Add `task: string | null;` to `Approval`, `progress: number; stage: string;` to `Task`, and:

```ts
export interface Deploy {
  org: string;
  agent: string;
  result: 'passed' | 'failed';
  tests: string | null;
  coverage: number | null;
  task: string | null;
  time: string;
}

export interface Release {
  task: string;
  state: 'ready' | 'released';
  components: number;
  file: string | null;
  time: string;
}

export interface GuardBlock {
  agent: string;
  command: string;
  reason: string;
  time: string;
}
```

and in `TeamState`, after `tasks`:

```ts
  /** Latest deploy per org. */
  deploys: Deploy[];
  releases: Release[];
  /** Last 10 guard blocks, oldest first. */
  guardBlocks: GuardBlock[];
```

- [ ] **Step 5: Verify**

Run: `npx vitest run test/sf-fixture.test.mjs && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/types.ts test/fixtures/projects/sf-office test/sf-fixture.test.mjs
git commit -m "Dashboard: Salesforce office fixture and types for deploys, releases, guard blocks, task progress"
```

---

### Task 2: `iso.ts` — projection and layout

**Files:**
- Create: `dashboard/src/iso.ts`
- Test: `test/iso.test.mjs`

**Interfaces:**
- Produces:
  - `U = 22`, `FLOOR_W = 11`
  - `type Pt = [number, number]`
  - `interface IsoLayout { width: number; height: number; depth: number; rows: number; origin: { x: number; y: number }; desks: { id: string; x: number; y: number }[]; approver: { x0: number; y0: number; x1: number; y1: number; desk: { x: number; y: number } }; sandbox: Pt; vault: Pt }`
  - `layout(memberIds: string[]): IsoLayout`
  - `project(l: Pick<IsoLayout, 'origin'>, x: number, y: number, z?: number): Pt`
  - `pts(points: Pt[]): string`
  - `boxFaces(l, x, y, z, w, d, h): { top: string; left: string; right: string }` (polygon `points` strings)
  - `arcPath(from: Pt, to: Pt, lift?: number): string` (SVG path `M x y Q cx cy x y`)

- [ ] **Step 1: Write the failing test** — `test/iso.test.mjs`

```js
import { test, expect } from 'vitest';
import { layout, project, boxFaces, arcPath, pts, U, FLOOR_W } from '../dashboard/src/iso.ts';

const ids = (n) => Array.from({ length: n }, (_, i) => `m${i}`);

test('six members match the mockup: two rows, 400 x 330 scene', () => {
  const l = layout(ids(6));
  expect(l.rows).toBe(2);
  expect(l.depth).toBe(8);
  expect(l.origin.x).toBeCloseTo(182.4, 1);
  expect(l.origin.y).toBe(96);
  expect(l.width).toBe(400);
  expect(l.height).toBe(330);
  expect(l.desks.map((d) => [d.x, d.y])).toEqual([[1.6, 2], [3.8, 2], [6, 2], [1.6, 5], [3.8, 5], [6, 5]]);
  expect(l.approver).toMatchObject({ x0: 8.3, y0: 4.6, x1: 10.7, y1: 7.7, desk: { x: 9, y: 5.4 } });
});

test('three members: one row', () => {
  const l = layout(ids(3));
  expect(l.rows).toBe(1);
  expect(l.depth).toBe(5);
  expect(l.desks).toHaveLength(3);
  expect(l.approver.y0).toBeCloseTo(1.6);
});

test('nine members: three rows, desks keep team order three per row', () => {
  const l = layout(ids(9));
  expect(l.rows).toBe(3);
  expect(l.depth).toBe(11);
  expect(l.desks.map((d) => d.id)).toEqual(ids(9));
  expect(l.desks[3]).toMatchObject({ x: 1.6, y: 5 });
  expect(l.desks[8]).toMatchObject({ x: 6, y: 8 });
});

test('zero members still gives a room with the approver office', () => {
  const l = layout([]);
  expect(l.rows).toBe(1);
  expect(l.desks).toEqual([]);
});

test.each([1, 3, 4, 6, 7, 9, 12])('every corner of the floor is inside the viewBox for %i members', (n) => {
  const l = layout(ids(n));
  for (const [x, y] of [[0, 0], [FLOOR_W, 0], [0, l.depth], [FLOOR_W, l.depth]]) {
    const [sx, sy] = project(l, x, y);
    expect(sx).toBeGreaterThanOrEqual(0);
    expect(sx).toBeLessThanOrEqual(l.width);
    expect(sy).toBeGreaterThanOrEqual(0);
    expect(sy).toBeLessThanOrEqual(l.height);
  }
});

test('desks never overlap the approver office', () => {
  for (const n of [3, 6, 9]) {
    const l = layout(ids(n));
    for (const d of l.desks) expect(d.x + 1.5).toBeLessThan(l.approver.x0);
  }
});

test('project: x goes right-down, y goes left-down, z goes up', () => {
  const l = layout(ids(6));
  const [ox, oy] = project(l, 0, 0);
  expect([ox, oy]).toEqual([l.origin.x, l.origin.y]);
  const [x1, y1] = project(l, 1, 0);
  expect(x1 - ox).toBeCloseTo(U * 0.866);
  expect(y1 - oy).toBeCloseTo(U * 0.5);
  expect(project(l, 0, 0, 1)[1]).toBeCloseTo(oy - U);
});

test('boxFaces gives three 4-point polygons', () => {
  const f = boxFaces(layout(ids(6)), 1, 1, 0, 1, 1, 1);
  for (const face of [f.top, f.left, f.right]) expect(face.split(' ')).toHaveLength(4);
});

test('pts joins points for a polygon', () => {
  expect(pts([[1, 2], [3.5, 4]])).toBe('1,2 3.5,4');
});

test('arcPath lifts the control point above both ends', () => {
  expect(arcPath([0, 100], [100, 100], 60)).toBe('M0 100 Q50 40 100 100');
  expect(arcPath([0, 100], [100, 50])).toBe('M0 100 Q50 15 100 50');
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run test/iso.test.mjs` → FAIL (module missing).

- [ ] **Step 3: Implement** — `dashboard/src/iso.ts`

```ts
/** Isometric maths for the office scene. Pure: no DOM, no React. Units are floor tiles. */

export type Pt = [number, number];

/** Pixels per floor tile. */
export const U = 22;
/** Floor width in tiles (desks on the left, the approver office on the right). */
export const FLOOR_W = 11;

const COS = 0.866;
const PER_ROW = 3;
const ROW_DEPTH = 3;
const DESK_X = [1.6, 3.8, 6.0];
const TOP = 96;
const LEFT_PAD = 30;
const RIGHT_PAD = 8;
const BOTTOM_PAD = 25;

export interface IsoLayout {
  width: number;
  height: number;
  depth: number;
  rows: number;
  origin: { x: number; y: number };
  desks: { id: string; x: number; y: number }[];
  approver: { x0: number; y0: number; x1: number; y1: number; desk: { x: number; y: number } };
  /** Screen position of the sandbox cloud (top right). */
  sandbox: Pt;
  /** Screen position of the production vault cloud (bottom right). */
  vault: Pt;
}

/** Screen point of floor tile (x, y) at height z. */
export function project(l: Pick<IsoLayout, 'origin'>, x: number, y: number, z = 0): Pt {
  return [l.origin.x + (x - y) * U * COS, l.origin.y + (x + y) * U * 0.5 - z * U];
}

/** One desk per member, three per row, in the order given. */
export function layout(memberIds: string[]): IsoLayout {
  const rows = Math.max(1, Math.ceil(memberIds.length / PER_ROW));
  const depth = 2 + rows * ROW_DEPTH;
  const origin = { x: LEFT_PAD + depth * U * COS, y: TOP };
  const width = Math.round(origin.x + FLOOR_W * U * COS + RIGHT_PAD);
  const height = Math.round(project({ origin }, FLOOR_W, depth)[1] + BOTTOM_PAD);
  const desks = memberIds.map((id, i) => ({ id, x: DESK_X[i % PER_ROW], y: 2 + Math.floor(i / PER_ROW) * ROW_DEPTH }));
  const y0 = Math.round((depth - 3.4) * 10) / 10;
  return {
    width, height, depth, rows, origin, desks,
    approver: { x0: 8.3, y0, x1: 10.7, y1: depth - 0.3, desk: { x: 9, y: Math.round((y0 + 0.8) * 10) / 10 } },
    sandbox: [width - 48, 52],
    vault: [width - 44, height - 78],
  };
}

/** Polygon `points` attribute from screen points. */
export function pts(points: Pt[]): string {
  return points.map(([x, y]) => `${x},${y}`).join(' ');
}

/** The three visible faces of a box at (x, y, z) sized w × d × h. */
export function boxFaces(l: Pick<IsoLayout, 'origin'>, x: number, y: number, z: number, w: number, d: number, h: number) {
  const P = (a: number, b: number, c: number) => project(l, a, b, c);
  return {
    top: pts([P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)]),
    left: pts([P(x, y + d, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x, y + d, z + h)]),
    right: pts([P(x + w, y, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x + w, y, z + h)]),
  };
}

/** A quadratic arc from `from` to `to`, its control point `lift` px above the higher end. */
export function arcPath(from: Pt, to: Pt, lift = 35): string {
  const cx = (from[0] + to[0]) / 2;
  const cy = Math.min(from[1], to[1]) - lift;
  return `M${from[0]} ${from[1]} Q${cx} ${cy} ${to[0]} ${to[1]}`;
}
```

Check the 6-member numbers: `origin.x = 30 + 8·22·0.866 = 182.42`; `width = round(182.42 + 11·19.052 + 8) = 400`; `height = round(96 + 19·11 + 25) = 330`. If a viewBox-bounds case fails for large `n`, fix the constants, never the test.

- [ ] **Step 4: Verify** — `npx vitest run test/iso.test.mjs` → PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/iso.ts test/iso.test.mjs
git commit -m "Dashboard: iso.ts projection and desk layout for any team size"
```

---

### Task 3: `mood.ts` — palettes, OKLCH blending, `moodAt`

**Files:**
- Create: `dashboard/src/mood.ts`
- Test: `test/mood.test.mjs`

**Interfaces:**
- Produces:
  - `type MoodName = 'night' | 'sunrise' | 'mint' | 'twilight'`; `type MoodChoice = 'auto' | MoodName`
  - `MOODS: { value: MoodName; label: string }[]` in order Night shift, Sunrise, Mint morning, Twilight
  - `interface Mood` (fields below), `PALETTES: Record<MoodName, Mood>`
  - `moodAt(date: Date): Mood` (local time), `moodFor(choice: MoodChoice, date: Date): Mood`
  - `blendHex(a: string, b: string, t: number): string`, `oklch(hex): [L, C, H]`
  - `moodTokens(m: Mood): Record<string, string>` (CSS custom properties for page chrome)

- [ ] **Step 1: Write the failing test** — `test/mood.test.mjs`

```js
import { test, expect } from 'vitest';
import { moodAt, moodFor, blendHex, oklch, PALETTES, MOODS, moodTokens } from '../dashboard/src/mood.ts';

const at = (h, m = 0) => new Date(2026, 9, 20, h, m);

const rgbMix = (a, b, t) => '#' + [1, 3, 5].map((i) => {
  const x = parseInt(a.slice(i, i + 2), 16), y = parseInt(b.slice(i, i + 2), 16);
  return Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
}).join('');

test('MOODS lists the four pinnable moods in picker order', () => {
  expect(MOODS.map((m) => m.label)).toEqual(['Night shift', 'Sunrise', 'Mint morning', 'Twilight']);
});

test.each([
  [3, 'night'], [8, 'sunrise'], [12, 'mint'], [18, 'twilight'], [22, 'night'],
])('at %i:00 the mood is exactly the %s palette', (h, name) => {
  const m = moodAt(at(h));
  expect(m.sky).toEqual(PALETTES[name].sky);
  expect(m.floor).toBe(PALETTES[name].floor);
  expect(m.label).toBe(PALETTES[name].label);
});

test('midnight wraps: 23:59 and 00:00 are both night shift', () => {
  expect(moodAt(at(23, 59)).sky).toEqual(PALETTES.night.sky);
  expect(moodAt(at(0, 0)).sky).toEqual(PALETTES.night.sky);
});

test('10:00 is halfway from sunrise to mint, blended in OKLCH', () => {
  const m = moodAt(at(10));
  expect(m.sky[0]).toBe(blendHex(PALETTES.sunrise.sky[0], PALETTES.mint.sky[0], 0.5));
  expect(m.sky[0]).not.toBe(rgbMix(PALETTES.sunrise.sky[0], PALETTES.mint.sky[0], 0.5));
});

test('an OKLCH blend keeps chroma (no muddy olive), unlike an RGB mix', () => {
  const a = '#ff9e80', b = '#5cc9b5';
  const mid = oklch(blendHex(a, b, 0.5))[1];
  const avg = (oklch(a)[1] + oklch(b)[1]) / 2;
  expect(mid).toBeCloseTo(avg, 2);
  expect(oklch(rgbMix(a, b, 0.5))[1]).toBeLessThan(avg - 0.03);
});

test('blendHex ends: t=0 and t=1 return the inputs', () => {
  expect(blendHex('#ff9e80', '#5cc9b5', 0)).toBe('#ff9e80');
  expect(blendHex('#ff9e80', '#5cc9b5', 1)).toBe('#5cc9b5');
});

test('numbers fade linearly: stars half on at 06:00', () => {
  expect(moodAt(at(6)).starA).toBeCloseTo(0.5);
  expect(moodAt(at(12)).starA).toBe(0);
});

test('the label switches at the blend midpoint', () => {
  expect(moodAt(at(9, 55)).label).toBe('Sunrise');
  expect(moodAt(at(10, 5)).label).toBe('Mint morning');
});

test('moodFor pins a mood whatever the time; auto follows the clock', () => {
  expect(moodFor('night', at(12)).sky).toEqual(PALETTES.night.sky);
  expect(moodFor('auto', at(12)).sky).toEqual(PALETTES.mint.sky);
});

test('moodTokens: night gives dark panels with light text, mint gives light panels', () => {
  const night = moodTokens(PALETTES.night);
  const mint = moodTokens(PALETTES.mint);
  expect(oklch(night['--paper'])[0]).toBeLessThan(0.45);
  expect(oklch(night['--ink'])[0]).toBeGreaterThan(0.85);
  expect(oklch(mint['--paper'])[0]).toBeGreaterThan(0.9);
  expect(Object.keys(mint).sort()).toEqual(['--accent', '--ink', '--ink-soft', '--line', '--lobby', '--paper', '--sky', '--sky-2'].sort());
});
```

- [ ] **Step 2: Run to see it fail** — `npx vitest run test/mood.test.mjs` → FAIL.

- [ ] **Step 3: Implement** — `dashboard/src/mood.ts`

```ts
/** Day-cycle palettes for the office (spec 8.5). Pure: no DOM. Colours from the mockup's PAL. */

export type MoodName = 'night' | 'sunrise' | 'mint' | 'twilight';
export type MoodChoice = 'auto' | MoodName;

export interface Mood {
  label: string;
  sky: [string, string];
  win: [string, string];
  cloud: string; cloudFar: string; wallA: string; wallB: string; floor: string; grid: string; rug: string;
  deskT: string; deskL: string; deskR: string; mon: string; screen: string;
  ink: string; sub: string; accent: string; jim: string; vault: string; moon: string; plant: string;
  /** 0–1 fades and the sun/moon position. */
  starA: number; lampA: number; orbX: number; orbY: number; orbR: number; orbA: number;
  /** 1 = dark scene (light text on panels), 0 = light. */
  dark: number;
}

export const PALETTES: Record<MoodName, Mood> = {
  sunrise: { label: 'Sunrise', sky: ['#ff9e80', '#ffe2c2'], win: ['#ff9e80', '#ffe2c2'], cloud: '#fff8f1', cloudFar: '#ffffff', wallA: '#fff3e8', wallB: '#f7e2d1', floor: '#fffaf5', grid: '#f4e6d8', rug: '#ffe6d8',
    deskT: '#f6d2a9', deskL: '#e3b585', deskR: '#d2a275', mon: '#3a2b45', screen: '#ffb26b', ink: '#43263a', sub: '#8a6a72', accent: '#e0663d', jim: '#fff1c9', vault: '#ffe0cf', moon: '#fff3d6', plant: '#5aa86b',
    starA: 0, lampA: 0, orbX: 60, orbY: 150, orbR: 30, orbA: 0.95, dark: 0 },
  twilight: { label: 'Twilight', sky: ['#2a215f', '#9a6fd0'], win: ['#3a2f7a', '#d9a0d6'], cloud: '#efe8ff', cloudFar: '#d9ccff', wallA: '#f4f0ff', wallB: '#e1d8fb', floor: '#fbf9ff', grid: '#ece6fb', rug: '#ece4ff',
    deskT: '#ffffff', deskL: '#ddd3f8', deskR: '#cbbdf2', mon: '#2a2350', screen: '#b99cff', ink: '#2a2350', sub: '#6d6390', accent: '#7a56e6', jim: '#fff2c4', vault: '#d9ccff', moon: '#fff4d1', plant: '#58a77a',
    starA: 0.8, lampA: 0.3, orbX: 52, orbY: 44, orbR: 13, orbA: 0.9, dark: 0 },
  mint: { label: 'Mint morning', sky: ['#5cc9b5', '#e6faf4'], win: ['#5cc9b5', '#e6faf4'], cloud: '#ffffff', cloudFar: '#ffffff', wallA: '#f2fbf7', wallB: '#dcf1e8', floor: '#fbfffd', grid: '#e3f3ec', rug: '#dcf4ea',
    deskT: '#ffffff', deskL: '#d2eadf', deskR: '#bddcd0', mon: '#1f3d3a', screen: '#6fe3c8', ink: '#173b36', sub: '#5b7a74', accent: '#0f8a6c', jim: '#fff5cf', vault: '#d5efe6', moon: '#ffffff', plant: '#3f9d6a',
    starA: 0, lampA: 0, orbX: 300, orbY: 30, orbR: 16, orbA: 0, dark: 0 },
  night: { label: 'Night shift', sky: ['#0b1030', '#26326a'], win: ['#0b1030', '#3a4a90'], cloud: '#3b4680', cloudFar: '#2e3870', wallA: '#2b3460', wallB: '#232b52', floor: '#323c6b', grid: '#2b3460', rug: '#3b4880',
    deskT: '#c79a6c', deskL: '#a57a52', deskR: '#8f6844', mon: '#111531', screen: '#ffd56b', ink: '#1d2340', sub: '#5f6788', accent: '#ffd56b', jim: '#5b4a2a', vault: '#2e3870', moon: '#fff1c2', plant: '#4c9a6c',
    starA: 1, lampA: 1, orbX: 52, orbY: 44, orbR: 13, orbA: 0.95, dark: 1 },
};

export const MOODS: { value: MoodName; label: string }[] = [
  { value: 'night', label: 'Night shift' },
  { value: 'sunrise', label: 'Sunrise' },
  { value: 'mint', label: 'Mint morning' },
  { value: 'twilight', label: 'Twilight' },
];

/** [hour, mood] keyframes in local time; flat between a pair with the same mood. */
const KEYS: [number, MoodName][] = [
  [0, 'night'], [5, 'night'], [7, 'sunrise'], [9.5, 'sunrise'], [10.5, 'mint'], [16.5, 'mint'],
  [17.5, 'twilight'], [19.5, 'twilight'], [21, 'night'], [24, 'night'],
];

// --- OKLCH (Björn Ottosson's OKLab matrices) ---
type V3 = [number, number, number];
const toLin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const fromLin = (c: number) => {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
};
const hexRgb = (h: string): V3 => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as V3;
const rgbHex = (c: V3) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

function oklab(hex: string): V3 {
  const [r, g, b] = hexRgb(hex).map(toLin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function labHex([L, a, b]: V3): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return rgbHex([
    fromLin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLin(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]);
}

/** [lightness 0–1, chroma, hue degrees] of a #rrggbb colour. */
export function oklch(hex: string): V3 {
  const [L, a, b] = oklab(hex);
  return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360];
}

/** Blend two #rrggbb colours in OKLCH, hue the short way round. */
export function blendHex(a: string, b: string, t: number): string {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const [L1, C1, H1] = oklch(a);
  const [L2, C2, H2] = oklch(b);
  // A grey has no hue: borrow the other colour's so the blend does not swing through a random hue.
  const h1 = C1 < 0.02 ? H2 : H1;
  const h2 = C2 < 0.02 ? H1 : H2;
  const dh = ((h2 - h1 + 540) % 360) - 180;
  const L = L1 + (L2 - L1) * t, C = C1 + (C2 - C1) * t, H = ((h1 + dh * t) * Math.PI) / 180;
  return labHex([L, C * Math.cos(H), C * Math.sin(H)]);
}

function blend(A: Mood, B: Mood, t: number): Mood {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(A) as (keyof Mood)[]) {
    const x = A[k], y = B[k];
    if (typeof x === 'number') out[k] = x + ((y as number) - x) * t;
    else if (Array.isArray(x)) out[k] = x.map((v, i) => blendHex(v, (y as string[])[i], t));
    else if (k === 'label') out[k] = t < 0.5 ? x : y;
    else out[k] = blendHex(x as string, y as string, t);
  }
  return out as unknown as Mood;
}

/** The palette for a local time. */
export function moodAt(date: Date): Mood {
  const h = date.getHours() + date.getMinutes() / 60;
  for (let i = 0; i < KEYS.length - 1; i++) {
    const [a, A] = KEYS[i], [b, B] = KEYS[i + 1];
    if (h >= a && h <= b) return A === B ? PALETTES[A] : blend(PALETTES[A], PALETTES[B], (h - a) / (b - a));
  }
  return PALETTES.night;
}

export function moodFor(choice: MoodChoice, date: Date): Mood {
  return choice === 'auto' ? moodAt(date) : PALETTES[choice];
}

/** CSS custom properties for the page chrome (toolbar, clipboard, board, list view). */
export function moodTokens(m: Mood): Record<string, string> {
  const dark = m.dark >= 0.5;
  return {
    '--sky': m.sky[0],
    '--sky-2': m.sky[1],
    '--paper': dark ? m.wallB : '#ffffff',
    '--lobby': dark ? m.wallA : m.wallA,
    '--ink': dark ? '#eef1ff' : m.ink,
    '--ink-soft': dark ? '#c9cfee' : m.sub,
    '--line': m.grid,
    '--accent': m.accent,
  };
}
```

(`--lobby` deliberately uses `wallA` in both branches; simplify to `m.wallA` if lint flags it.)

- [ ] **Step 4: Verify** — `npx vitest run test/mood.test.mjs` → PASS. If the chroma test fails by a hair, check the matrices against the code above before touching the test.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/mood.ts test/mood.test.mjs
git commit -m "Dashboard: mood.ts day cycle with OKLCH blending and chrome tokens"
```

---

### Task 4: Mood picker and page tokens

**Files:**
- Create: `dashboard/src/useMood.ts`, `dashboard/src/components/MoodPicker.tsx`
- Delete: `dashboard/src/components/ThemeToggle.tsx`
- Modify: `dashboard/src/App.tsx` (toolbar), `dashboard/src/theme.css`, `dashboard/src/office.css` (`.theme-toggle` rules → `.mood-picker`)
- Test: `test/e2e/office-extras.spec.ts` (theme tests)

**Interfaces:**
- Consumes: `MoodChoice`, `MOODS`, `moodFor`, `moodTokens`, `Mood` (Task 3).
- Produces: `useMood(): { choice: MoodChoice; setChoice: (c: MoodChoice) => void; mood: Mood }`; `MOOD_KEY = 'salesforce-team-kit.mood'`; `<MoodPicker choice setChoice />`; `<html>` gets `data-mood="<choice>"` and `data-dark="true|false"` and the `moodTokens` as inline custom properties. `App` passes `mood` down to the office (Task 5).

- [ ] **Step 1: Update the e2e tests first** (in `test/e2e/office-extras.spec.ts`)

Replace the tests `theme choice survives a reload`, `the theme survives the switch from the problem page to the office with storage blocked` and `screenshots of the three themes` with:

```ts
test('mood picker offers Auto plus four moods, Auto checked by default', async ({ page }) => {
  await page.goto(office.url);
  const picker = page.getByRole('radiogroup', { name: 'Mood' });
  await expect(picker.getByRole('radio')).toHaveCount(5);
  await expect(picker.getByRole('radio', { name: 'Auto' })).toBeChecked();
});

test('pinned mood survives a reload and sets dark panels for Night shift', async ({ page }) => {
  await page.goto(office.url);
  await page.getByRole('radio', { name: 'Night shift' }).check();
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Night shift' })).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-dark', 'true');
});

test('Auto follows the clock: 12:00 is Mint morning, 22:00 is dark', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 20, 12, 0));
  await page.goto(office.url);
  await expect(page.locator('html')).toHaveAttribute('data-dark', 'false');
  await page.clock.setFixedTime(new Date(2026, 9, 20, 22, 0));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-dark', 'true');
});

test('the mood survives the switch from the problem page to the office with storage blocked', async ({ page }) => {
  // Keep the body of the old "theme survives ... storage blocked" test, replacing
  // getByRole('radio', { name: 'Night shift' }) checks for the new picker and
  // `data-theme` assertions with `data-mood="night"`.
});
```

Fill the last test by porting the old one line by line (read it at `test/e2e/office-extras.spec.ts:208`); keep `'the office works when storage is blocked'` unchanged. Leave the screenshot test for Task 9.

- [ ] **Step 2: Run them to see them fail**

Run: `npx playwright test test/e2e/office-extras.spec.ts -g "mood|Mood|Auto"` → FAIL (no radiogroup "Mood").

- [ ] **Step 3: Implement `dashboard/src/useMood.ts`**

```ts
import { useEffect, useLayoutEffect, useState } from 'react';
import { moodFor, moodTokens, MOODS, type Mood, type MoodChoice } from './mood';

export const MOOD_KEY = 'salesforce-team-kit.mood';
const MINUTE = 60_000;

/** Stored choice, or Auto. Storage can be missing or throw (private windows, blocked site data). */
function readChoice(): MoodChoice {
  try {
    const v = window.localStorage.getItem(MOOD_KEY);
    return v === 'auto' || MOODS.some((m) => m.value === v) ? (v as MoodChoice) : 'auto';
  } catch {
    return 'auto';
  }
}

function saveChoice(c: MoodChoice): void {
  try {
    window.localStorage.setItem(MOOD_KEY, c);
  } catch {
    // Not remembered in this browser; the page still works.
  }
}

/** The chosen mood and the palette for right now, refreshed once a minute. Applies chrome tokens to <html>. */
export function useMood(): { choice: MoodChoice; setChoice: (c: MoodChoice) => void; mood: Mood } {
  const [choice, setChoiceState] = useState<MoodChoice>(readChoice);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), MINUTE);
    return () => clearInterval(id);
  }, []);

  const mood = moodFor(choice, now);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.mood = choice;
    root.dataset.dark = String(mood.dark >= 0.5);
    for (const [k, v] of Object.entries(moodTokens(mood))) root.style.setProperty(k, v);
  }, [choice, mood]);

  const setChoice = (c: MoodChoice) => { setChoiceState(c); saveChoice(c); };
  return { choice, setChoice, mood };
}
```

- [ ] **Step 4: Implement `dashboard/src/components/MoodPicker.tsx`**

```tsx
import { MOODS, type MoodChoice } from '../mood';

const OPTIONS: { value: MoodChoice; label: string }[] = [{ value: 'auto', label: 'Auto' }, ...MOODS];

/** Mood radio group: Auto follows the day; the others pin a mood. */
export function MoodPicker({ choice, setChoice }: { choice: MoodChoice; setChoice: (c: MoodChoice) => void }) {
  return (
    <div className="mood-picker" role="radiogroup" aria-label="Mood">
      {OPTIONS.map((o) => (
        <label key={o.value} className={choice === o.value ? 'is-on' : undefined}>
          <input type="radio" name="mood" value={o.value} checked={choice === o.value} onChange={() => setChoice(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Wire it and retire the old themes**

- `App.tsx`: `const { choice, setChoice, mood } = useMood();` at the top of `App`; toolbar renders `<MoodPicker choice={choice} setChoice={setChoice} />` instead of `<ThemeToggle />`. Keep `mood` in a variable; Task 5 passes it to the office.
- Delete `components/ThemeToggle.tsx`.
- `theme.css`: delete the `:root[data-theme='pastel']` block; change the selector `:root[data-theme='night']` to `:root[data-dark='true']` and delete from it every token that `moodTokens` now sets (`--sky`, `--sky-2`, `--paper`, `--lobby`, `--ink`). Add `--ink-soft`, `--line`, `--accent` defaults to `:root` (Mint morning values: `#5b7a74`, `#e3f3ec`, `#0f8a6c`). Update the header comment: tokens for the chrome come from `useMood`; `data-dark` switches pill and glow tokens.
- `office.css`: rename `.theme-toggle` selectors to `.mood-picker` (same rules).

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm run lint && npx playwright test test/e2e/office-extras.spec.ts`
Expected: the new mood tests pass; tests about rooms still pass (Building is still there).

- [ ] **Step 7: Commit**

```bash
git add -A dashboard/src test/e2e/office-extras.spec.ts
git commit -m "Dashboard: Auto + four-mood picker driving page tokens; drop Cozy day/Pastel themes"
```

---

### Task 5: The isometric office and desks

**Files:**
- Create: `dashboard/src/components/IsoOffice.tsx`, `dashboard/src/components/Desk.tsx`, `dashboard/src/office-data.ts` (first function only)
- Delete: `dashboard/src/components/{Building,Room,Figure}.tsx`, `dashboard/src/rooms.ts`
- Modify: `dashboard/src/App.tsx`, `dashboard/src/labels.ts` (`roomLabel` → `deskLabel`), `dashboard/src/components/PreviewCard.tsx` (no change in logic; only its import site moves), `dashboard/src/office.css`
- Test: `test/office-logic.test.mjs`, `test/e2e/office.spec.ts`

**Interfaces:**
- Consumes: `layout`, `project`, `boxFaces`, `pts`, `IsoLayout` (Task 2); `Mood` (Task 3); `mood` from `useMood` (Task 4).
- Produces:
  - `deskLabel(agent: AgentState): string` in `labels.ts` → `"<name>, <state label lower case>: <detail>"`, detail = `reason` when blocked and set, else `currentTask`, else `nothing assigned`.
  - `deskState(status: AgentStatus): 'working' | 'blocked' | 'waiting' | 'done' | 'free'` in `office-data.ts`.
  - `<IsoOffice state mood selectedId onSelect sign overlays? scene? />` where `overlays?: ReactNode` (HTML over the scene, Tasks 6–7) and `scene?: (l: IsoLayout) => ReactNode` (extra SVG drawn after the desks, Tasks 6–7). Each desk `<g>` carries `data-agent={id}` and class `desk is-<deskState>`.

- [ ] **Step 1: Unit tests** — in `test/office-logic.test.mjs` delete the `orderRooms` tests and import, then add:

```js
import { deskLabel } from '../dashboard/src/labels.ts';
import { deskState } from '../dashboard/src/office-data.ts';

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
```

Remove `roomLabel` from `labels.ts` and replace it with `deskLabel` (update any import of `roomLabel`).

- [ ] **Step 2: e2e first** — rewrite `test/e2e/office.spec.ts` against `sf-office`:

- `beforeEach`: `startOffice('sf-office')`.
- Replace `renders one room per agent with the project on the roof` with: heading `Nitro Cleanup team` visible; `office$(page).locator('[data-agent]')` has count 7.
- Replace `room label uses the plain state wording` with: buttons named `Developer, stuck: 1 Apex test failing`, `Admin, working: T-101`, `QA, on a break: nothing assigned` are visible.
- Replace `approver gets the top-right room with one sheet per pending approval` with: `[data-agent="jimmy"]` has class `is-waiting` (WO-9 pending) and its accessible name starts with `Jimmy, waiting for approval: 1 decision waiting`.
- Add: `[data-agent="developer"]` has class `is-blocked`; `[data-agent="admin"]` has class `is-working`; `[data-agent="reviewer"]` has class `is-free`.
- Keep `hovering ... shows a preview card`, `clicking ... pins its clipboard`, `clipboard shows the reason when an agent is stuck`, `keyboard: Tab to a room and press Enter pins it`, `updates within one poll`, `stale agent shows last update warning`: change role names to the new desk labels and agent ids to `sf-office` ones (stuck agent = Developer; for "updates within one poll" append a `status` event for `qa`; for stale use `analyst`, last updated 10:07 — pick a page clock or appended event so it is over 5 minutes old, as the old test did).
- Change the `screenshot of the busy office` test to `screenshot of the Salesforce office` with `startOffice('sf-office')` already in place.
- In `office-extras.spec.ts`, replace `focus order follows the layout: the approver comes right after the top row` with: Tab order through desks is `planner, analyst, admin, developer, qa, reviewer, jimmy` (team order, approver last). Replace `re-activating a pinned room unpins it` names with desk names. Leave other extras tests on `busy` until Tasks 6–8 move them.

Run: `npx playwright test test/e2e/office.spec.ts` → FAIL.

- [ ] **Step 3: `office-data.ts` (first piece)**

```ts
import type { AgentStatus } from './types';

export type DeskState = 'working' | 'blocked' | 'waiting' | 'done' | 'free';

const DESK: Record<AgentStatus, DeskState> = {
  working: 'working', blocked: 'blocked', awaiting_approval: 'waiting', done: 'done', idle: 'free',
};

/** How a desk looks for an agent status (spec 8.2). */
export const deskState = (s: AgentStatus): DeskState => DESK[s];
```

`labels.ts`:

```ts
/** Accessible name of a desk: "<name>, <state>: <why or task>". */
export function deskLabel(agent: Pick<AgentState, 'name' | 'status' | 'currentTask' | 'reason'>): string {
  const detail = (agent.status === 'blocked' && agent.reason) || agent.currentTask || NOTHING_ASSIGNED.toLowerCase();
  return `${agent.name}, ${STATE_LABELS[agent.status].toLowerCase()}: ${detail}`;
}
```

- [ ] **Step 4: `Desk.tsx`**

```tsx
import type { CSSProperties, KeyboardEvent } from 'react';
import type { AgentState } from '../types';
import type { IsoLayout } from '../iso';
import { boxFaces, project } from '../iso';
import type { Mood } from '../mood';
import { deskLabel, NOTHING_ASSIGNED, STATE_LABELS } from '../labels';
import { deskState } from '../office-data';

export interface DeskProps {
  l: IsoLayout;
  agent: AgentState;
  x: number;
  y: number;
  mood: Mood;
  selected: boolean;
  /** "New from <sender>" for a few seconds after a handoff (Task 7). */
  plaque?: string;
  describedBy?: string;
  onSelect: (id: string) => void;
}

const SHORT = 26;
const short = (s: string) => (s.length > SHORT ? `${s.slice(0, SHORT - 1)}…` : s);

/** One desk: floor glow, person, desk box, monitor showing the state, and the name chip. */
export function Desk({ l, agent: a, x, y, mood, selected, plaque, describedBy, onSelect }: DeskProps) {
  const ds = deskState(a.status);
  const desk = boxFaces(l, x, y, 0, 1.5, 0.85, 0.62);
  const mon = boxFaces(l, x + 0.45, y + 0.1, 0.62, 0.6, 0.08, 0.42);
  const [gx, gy] = project(l, x + 0.75, y + 0.4);
  const [px, py] = project(l, x + 0.7, y - 0.55, 0.45);
  const [sx, sy] = project(l, x + 0.75, y + 0.1, 0.83);
  const line = plaque ?? `${STATE_LABELS[a.status]} · ${short(a.currentTask ?? NOTHING_ASSIGNED)}`;
  const w = Math.max(a.name.length * 4, line.length * 3.3) + 18;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(a.id); }
  };
  return (
    <g
      className={`desk is-${ds}${selected ? ' is-selected' : ''}`}
      data-agent={a.id}
      role="button"
      tabIndex={0}
      aria-label={deskLabel(a)}
      aria-pressed={selected}
      aria-describedby={describedBy}
      onClick={() => onSelect(a.id)}
      onKeyDown={onKey}
      style={{ '--owner': a.color } as CSSProperties}
    >
      <ellipse className="desk-glow" cx={gx} cy={gy} rx={34} ry={20} />
      <g className="person">
        <rect x={px - 7} y={py - 18} width={14} height={17} rx={6} fill={a.color} />
        <circle cx={px} cy={py - 24} r={6} fill="#f3c9a8" />
      </g>
      <polygon points={desk.top} fill={mood.deskT} />
      <polygon points={desk.left} fill={mood.deskL} />
      <polygon points={desk.right} fill={mood.deskR} />
      <polygon points={mon.top} fill={mood.mon} />
      <polygon points={mon.left} fill={mood.mon} />
      <polygon className="desk-screen" points={mon.right} />
      <g className="desk-screen-mark" transform={`translate(${sx},${sy})`}>
        {ds === 'blocked' && <text className="mark-alert" textAnchor="middle" y={2}>!</text>}
        {ds === 'done' && <text className="mark-done" textAnchor="middle" y={2}>✓</text>}
        {ds === 'waiting' && <text className="mark-wait" textAnchor="middle" y={1}>···</text>}
        {ds === 'working' && <g className="mark-code"><rect x={-3} y={-2} width={6} height={0.8} /><rect x={-3} y={0} width={4} height={0.8} /></g>}
        {ds === 'free' && <circle className="mark-saver" r={0.9} />}
      </g>
      <g className="chip" transform={`translate(${px - w / 2},${py - 52})`}>
        <rect width={w} height={17} rx={8.5} />
        <circle className={`chip-dot dot-${ds}`} cx={7.5} cy={6.5} r={2.4} />
        <text className="chip-name" x={12} y={8.5}>{a.name}</text>
        <text className="chip-task" x={7.5} y={14.2}>{line}</text>
      </g>
    </g>
  );
}
```

- [ ] **Step 5: `IsoOffice.tsx`** — sky, clouds, walls, floor, desks, approver office; HTML overlays (sign, preview card, later the Tasks card) sit in a positioned wrapper.

```tsx
import { useState, type ReactNode } from 'react';
import type { AgentState, TeamState } from '../types';
import { boxFaces, layout, project, pts, type IsoLayout, FLOOR_W } from '../iso';
import type { Mood } from '../mood';
import { Desk } from './Desk';
import { PreviewCard } from './PreviewCard';

export interface IsoOfficeProps {
  state: TeamState;
  mood: Mood;
  selectedId: string | null;
  onSelect: (id: string) => void;
  plaques?: Record<string, string>;
  /** HTML laid over the scene (needs-you sign, Tasks card). Positioned by the caller via `pct`. */
  overlays?: (l: IsoLayout) => ReactNode;
  /** Extra SVG drawn above the desks (sky cards, flights). */
  scene?: (l: IsoLayout) => ReactNode;
}

/** Percent position of a screen point inside the scene, for HTML overlays. */
export const pct = (l: IsoLayout, [x, y]: [number, number]) => ({ left: `${(x / l.width) * 100}%`, top: `${(y / l.height) * 100}%` });

function Puff({ x, y, s, fill, op = 1 }: { x: number; y: number; s: number; fill: string; op?: number }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`} opacity={op}>
      <circle cx={-14} cy={2} r={10} fill={fill} /><circle cx={0} cy={-5} r={14} fill={fill} />
      <circle cx={15} cy={0} r={11} fill={fill} /><rect x={-24} y={0} width={50} height={12} rx={6} fill={fill} />
    </g>
  );
}
export { Puff };

/** The isometric cloud office (spec 8.2): one desk per member, three per row; approver in the glass office. */
export function IsoOffice({ state, mood: m, selectedId, onSelect, plaques, overlays, scene }: IsoOfficeProps) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const members = state.agents.filter((a) => !a.isApprover);
  const approver = state.agents.find((a) => a.isApprover) ?? null;
  const l = layout(members.map((a) => a.id));
  const P = (x: number, y: number, z = 0) => project(l, x, y, z);
  const { x0, y0, x1, y1, desk } = l.approver;
  const byId = new Map(state.agents.map((a) => [a.id, a]));
  const preview = previewId ? byId.get(previewId) ?? null : null;
  const spots: { agent: AgentState; x: number; y: number }[] = [
    ...l.desks.map((d) => ({ agent: byId.get(d.id)!, x: d.x, y: d.y })),
    ...(approver ? [{ agent: approver, x: desk.x, y: desk.y }] : []),
  ];

  return (
    <section className="iso-office" aria-label="Office">
      <h1 className="iso-title">{`${state.project} team`}</h1>
      <div className="iso-wrap" onKeyDown={(e) => { if (e.key === 'Escape') setPreviewId(null); }}>
        <svg viewBox={`0 0 ${l.width} ${l.height}`} className="iso-scene" role="group" aria-label="Desks">
          <defs>
            <linearGradient id="iso-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={m.sky[0]} /><stop offset="1" stopColor={m.sky[1]} /></linearGradient>
            <linearGradient id="iso-win" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={m.win[0]} /><stop offset="1" stopColor={m.win[1]} /></linearGradient>
          </defs>
          <rect width={l.width} height={l.height} fill="url(#iso-sky)" />
          {m.starA > 0.02 && (
            <g opacity={m.starA} aria-hidden="true">
              {Array.from({ length: 34 }, (_, i) => (
                <circle key={i} cx={(i * 97) % l.width} cy={(i * 53) % 150} r={i % 5 ? 0.7 : 1.2} fill="#fff" className={i % 3 ? undefined : 'twinkle'} />
              ))}
            </g>
          )}
          <circle cx={m.orbX} cy={m.orbY} r={m.orbR} fill={m.moon} opacity={m.orbA} aria-hidden="true" />
          <g className="drift" aria-hidden="true"><Puff x={40} y={40} s={1} fill={m.cloudFar} op={0.7} /></g>
          <g className="drift drift-2" aria-hidden="true"><Puff x={40} y={90} s={0.7} fill={m.cloudFar} op={0.55} /></g>
          {/* The cloud the office floats on. */}
          <g aria-hidden="true">
            {[[0, l.depth], [3, l.depth + 0.6], [6, l.depth + 0.8], [9, l.depth + 0.4], [FLOOR_W + 0.4, l.depth - 2], [FLOOR_W + 0.6, l.depth / 2], [FLOOR_W + 0.2, 0.5]].map(([x, y], i) => {
              const [cx, cy] = P(x, y);
              return <ellipse key={i} cx={cx} cy={cy + 12} rx={34 + (i % 2) * 8} ry={18} fill={m.cloud} />;
            })}
            <polygon points={pts([P(0, 0), P(FLOOR_W, 0), P(FLOOR_W, 0, 3.2), P(0, 0, 3.2)])} fill={m.wallA} />
            <polygon points={pts([P(0, 0), P(0, l.depth), P(0, l.depth, 3.2), P(0, 0, 3.2)])} fill={m.wallB} />
            {[0, 1, 2].map((i) => <polygon key={i} points={pts([P(1.2 + i * 2.6, 0, 1.1), P(2.8 + i * 2.6, 0, 1.1), P(2.8 + i * 2.6, 0, 2.7), P(1.2 + i * 2.6, 0, 2.7)])} fill="url(#iso-win)" />)}
            <polygon points={pts([P(0, 0), P(FLOOR_W, 0), P(FLOOR_W, l.depth), P(0, l.depth)])} fill={m.floor} />
            {Array.from({ length: FLOOR_W - 1 }, (_, i) => {
              const [ax, ay] = P(i + 1, 0), [bx, by] = P(i + 1, l.depth);
              return <line key={i} x1={ax} y1={ay} x2={bx} y2={by} stroke={m.grid} strokeWidth={0.8} />;
            })}
            <polygon points={pts([P(1, 1.1), P(7.4, 1.1), P(7.4, l.depth - 1), P(1, l.depth - 1)])} fill={m.rug} />
            <polygon className="glass-floor" points={pts([P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)])} fill={m.jim} />
            <polygon className="glass-wall" points={pts([P(x0, y0), P(x0, y1), P(x0, y1, 2.2), P(x0, y0, 2.2)])} />
            {(() => { const pot = boxFaces(l, 10.2, 0.4, 0, 0.6, 0.6, 0.5); const [tx, ty] = P(10.5, 0.7, 1.1); return (<>
              <polygon points={pot.top} fill="#c7714c" /><polygon points={pot.left} fill="#a85c3c" /><polygon points={pot.right} fill="#954f33" />
              <circle cx={tx} cy={ty} r={11} fill={m.plant} /></>); })()}
          </g>
          {spots.map(({ agent, x, y }) => (
            <g key={agent.id}
              onMouseEnter={() => setPreviewId(agent.id)}
              onMouseLeave={() => setPreviewId((id) => (id === agent.id ? null : id))}
              onFocus={() => setPreviewId(agent.id)}
              onBlur={() => setPreviewId((id) => (id === agent.id ? null : id))}
            >
              <Desk l={l} agent={agent} x={x} y={y} mood={m} selected={agent.id === selectedId}
                plaque={plaques?.[agent.id]} describedBy={previewId === agent.id ? `preview-${agent.id}` : undefined}
                onSelect={onSelect} />
            </g>
          ))}
          {scene?.(l)}
        </svg>
        {preview && (() => {
          const spot = spots.find((s) => s.agent.id === preview.id)!;
          return <div className="iso-preview" style={pct(l, project(l, spot.x + 0.75, spot.y, 2.6))}><PreviewCard agent={preview} id={`preview-${preview.id}`} /></div>;
        })()}
        {overlays?.(l)}
      </div>
    </section>
  );
}
```

Note: the `Puff` export is reused by `SkyCards` in Task 6; keep a single `export function Puff` (drop the separate `export { Puff }` line if lint complains).

- [ ] **Step 6: `App.tsx`** — `Office` renders `IsoOffice` instead of `Building`:

```tsx
<div className="office">
  <div className="office-main">
    <IsoOffice
      state={state}
      mood={mood}
      selectedId={selected?.id ?? null}
      onSelect={(id) => setSelectedId((cur) => (cur === id ? null : id))}
      plaques={plaques}
      overlays={(l) => approver && (
        <div className="iso-sign" style={pct(l, project(l, 9.6, l.approver.y0 + 0.4, 2.6))}>
          <NeedsYouSign approver={approver} items={state.needsYou} agents={state.agents} onOpen={() => setSelectedId(approver.id)} />
        </div>
      )}
    />
    <Lobby tasks={state.tasks} agents={state.agents} />
  </div>
  <Clipboard ... unchanged props ... />
</div>
```

Pass `mood` from `App` into `Office` (add it to `OfficeProps`). Keep `useArrivals` and `plaques` for now (Task 7 replaces it); remove the `MailTube` `ceiling` prop and its import, but keep `MailTube.tsx` itself until Task 7 deletes it. Delete `Building.tsx`, `Room.tsx`, `Figure.tsx`, `rooms.ts`.

- [ ] **Step 7: `office.css`** — delete every rule for `.building`, `.roof`, `.house`, `.room*`, `.figure*`, `.tray*`, `.plaque*` (keep `.needs-sign`, `.preview`, `.lobby*`, `.clipboard*`, `.list-view`, `.toolbar`, `.mood-picker`, `.meter`, `.state-pill`, `.scene*`, `.status-overlay*`). Add:

```css
/* Isometric office (spec 8.2). Scene colours come from the mood (inline fills); state colours from tokens. */
.iso-office { flex: 1 1 640px; min-width: 0; }
.iso-title { margin: 0 0 8px; font-size: 1.25rem; color: var(--ink); }
.iso-wrap { position: relative; }
.iso-scene { display: block; width: 100%; height: auto; border-radius: 18px; }
.iso-preview, .iso-sign { position: absolute; transform: translate(-50%, -100%); z-index: 2; }
.office-main { display: flex; flex-direction: column; gap: 16px; flex: 1 1 640px; min-width: 0; }

.desk { cursor: pointer; outline: none; }
.desk:focus-visible .chip rect, .desk.is-selected .chip rect { stroke: var(--ink); stroke-width: 1.4; stroke-opacity: 1; }
.desk-glow { fill: var(--owner); opacity: 0; }
.desk.is-working .desk-glow { opacity: 0.22; }
.desk.is-blocked .desk-glow { fill: var(--alert); opacity: 0.3; }
.desk.is-waiting .desk-glow { fill: var(--approval); opacity: 0.3; }
.desk-screen { fill: var(--screen-free, #3a4060); }
.desk.is-working .desk-screen { fill: var(--owner); }
.desk.is-blocked .desk-screen { fill: var(--alert); }
.desk.is-waiting .desk-screen { fill: var(--approval); }
.desk.is-done .desk-screen { fill: var(--done); }
.desk-screen-mark text { font-size: 5px; font-weight: 700; fill: #fff; }
.mark-code rect, .mark-saver { fill: #fff; opacity: 0.85; }
.chip rect { fill: #fff; stroke: #1d2340; stroke-opacity: 0.15; stroke-width: 0.7; }
.chip-name { font-size: 6px; font-weight: 700; fill: #1d2340; }
.chip-task { font-size: 5px; fill: #4a5070; }
.chip-dot.dot-working { fill: #2e9d57; }
.chip-dot.dot-blocked { fill: var(--alert); }
.chip-dot.dot-waiting { fill: var(--approval); }
.chip-dot.dot-done { fill: var(--done); }
.chip-dot.dot-free { fill: #a0a8b5; }
.glass-wall { fill: #ffe58a44; stroke: #e5b800; stroke-width: 1; }

@media (prefers-reduced-motion: no-preference) {
  .desk.is-working .desk-glow { animation: glow 2.4s ease-in-out infinite; }
  .desk.is-blocked .desk-glow { animation: glow 0.7s ease-in-out infinite; }
  .desk.is-waiting .desk-glow { animation: glow 3.2s ease-in-out infinite; }
  .desk.is-blocked .mark-alert, .desk.is-waiting .mark-wait, .chip-dot.dot-blocked { animation: blink 1s steps(2) infinite; }
  .desk.is-working .mark-code { animation: scroll 1.2s linear infinite; }
  .desk.is-working .person { animation: typing 0.5s ease-in-out infinite alternate; transform-box: fill-box; }
  .mark-saver { animation: saver 6s ease-in-out infinite alternate; }
  .twinkle { animation: blink 2.2s ease-in-out infinite; }
  .drift { animation: drift 40s linear infinite; }
  .drift-2 { animation-delay: -14s; }
}
@keyframes glow { 50% { opacity: 0.08; } }
@keyframes blink { 50% { opacity: 0.25; } }
@keyframes scroll { to { transform: translateY(-2px); } }
@keyframes typing { to { transform: translateY(-0.6px); } }
@keyframes saver { to { transform: translate(2px, 1px); } }
@keyframes drift { from { transform: translateX(-60px); } to { transform: translateX(420px); } }
```

Make sure no older `animation:` rule outside the motion query targets the new classes (grep `animation` in `office.css`).

- [ ] **Step 8: Verify**

Run: `npx vitest run && npm run typecheck && npm run lint && npx playwright test test/e2e/office.spec.ts test/e2e/office-extras.spec.ts`
Expected: all pass. If an `office-extras` test still on `busy` breaks only because rooms became desks (role names), update its names to `deskLabel` wording; do not move it to `sf-office` yet.

- [ ] **Step 9: Commit**

```bash
git add -A dashboard/src test/office-logic.test.mjs test/e2e
git commit -m "Dashboard: isometric cloud office with state-driven desks replaces the building"
```

---

### Task 6: Sky cards — Tasks card, sandbox cloud, production vault, change-set parcel, guard bubbles

**Files:**
- Modify: `dashboard/src/office-data.ts`
- Create: `dashboard/src/components/SkyCards.tsx`, `dashboard/src/components/ProgressBar.tsx`
- Modify: `dashboard/src/App.tsx`, `dashboard/src/office.css`
- Test: `test/office-data.test.mjs`, `test/e2e/office-sf.spec.ts` (new)

**Interfaces:**
- Consumes: `IsoOffice` `scene`/`overlays` props, `pct`, `Puff` (Task 5); `project`, `IsoLayout` (Task 2); types from Task 1.
- Produces (in `office-data.ts`):
  - `TASKS_CARD_MAX = 5`, `GUARD_BUBBLE_MS = 60_000`
  - `activeTasks(tasks: Task[], max?: number): Task[]` — tasks with `progress < 100` and `state !== 'done'`, in state order (board order), at most `max`
  - `latestDeploy(deploys: Deploy[]): Deploy | null` — newest `time`
  - `lastDeployBy(agentId: string, deploys: Deploy[]): Deploy | null`
  - `readyReleases(releases: Release[]): Release[]` — `state === 'ready'`, newest first
  - `lastReleased(releases: Release[]): Release | null`
  - `guardBubbles(blocks: GuardBlock[], now: string, ms?: number): Record<string, GuardBlock>` — newest block per agent within `ms` of `now`
  - `deployLine(d: Deploy): string` — `"✓ 142/142 tests · 87%"` / `"✗ failed · 140/141 tests · 81%"`, omitting missing parts
  - `<ProgressBar progress stage label? color? small? />`

- [ ] **Step 1: Unit tests** — `test/office-data.test.mjs`

```js
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
```

Run `npx vitest run test/office-data.test.mjs` → FAIL.

- [ ] **Step 2: Implement the selectors** (append to `office-data.ts`)

```ts
import type { Deploy, GuardBlock, Release, Task } from './types';
import { TASK_COLUMNS } from './labels';

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
```

(The `activeTasks` expectation `['C','E','B','F','G']` = in_progress first, then in_review, then todo in input order; `Array.prototype.sort` is stable.) Run the unit tests → PASS.

- [ ] **Step 3: e2e first** — create `test/e2e/office-sf.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { startOffice, type Office } from './helpers';

let office: Office;
test.beforeEach(async () => { office = await startOffice('sf-office'); });
test.afterEach(async () => { await office.close(); });

test('Tasks card lists active tasks with progress and stage', async ({ page }) => {
  await page.goto(office.url);
  const card = page.getByRole('region', { name: 'Tasks' });
  await expect(card.getByRole('listitem')).toHaveCount(5);
  await expect(card.getByRole('progressbar', { name: /T-101/ })).toHaveAttribute('aria-valuetext', '65%, In sandbox');
  await expect(card.getByText('T-100')).toHaveCount(0);
});

test('sandbox cloud shows the latest deploy in words', async ({ page }) => {
  await page.goto(office.url);
  await expect(page.getByTestId('sandbox-cloud')).toContainText('sandbox');
  await expect(page.getByTestId('sandbox-cloud')).toContainText('✗ failed · 140/141 tests · 81%');
});

test('production vault names the approver and the last release', async ({ page }) => {
  await page.goto(office.url);
  const vault = page.getByTestId('vault-cloud');
  await expect(vault).toContainText('Production · deployed by Jimmy via change set');
  await expect(vault).toContainText('T-100 released');
});

test('a change set ready waits on the approver desk', async ({ page }) => {
  await page.goto(office.url);
  await expect(page.getByTestId('changeset-parcel')).toContainText('Change set ready · 3 components');
});

test('guard block bubble shows at the agent desk', async ({ page }) => {
  await page.goto(office.url);
  await expect(page.getByTestId('guard-bubble-developer')).toContainText('Guard blocked');
});
```

Run `npx playwright test test/e2e/office-sf.spec.ts` → FAIL.

- [ ] **Step 4: `ProgressBar.tsx`**

```tsx
/** Task progress: a bar, the percentage and the stage (spec 8.4a). */
export function ProgressBar({ label, progress, stage, color, small }: { label: string; progress: number; stage: string; color?: string; small?: boolean }) {
  return (
    <div className={`task-bar${small ? ' task-bar-small' : ''}`}>
      <div className="meter" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={progress} aria-valuetext={`${progress}%, ${stage}`}>
        <div style={{ width: `${progress}%`, background: color ?? 'var(--accent)' }} />
      </div>
      <span className="task-bar-text">{progress}% · {stage}</span>
    </div>
  );
}
```

- [ ] **Step 5: `SkyCards.tsx`**

```tsx
import type { TeamState } from '../types';
import { project, type IsoLayout } from '../iso';
import type { Mood } from '../mood';
import { Puff, pct } from './IsoOffice';
import { ProgressBar } from './ProgressBar';
import { activeTasks, deployLine, guardBubbles, lastReleased, latestDeploy, readyReleases } from '../office-data';
import { agentName } from '../labels';

/** SVG: sandbox cloud (top right), production vault (bottom right), change-set parcel on the approver desk. */
export function SkyScene({ l, state, mood: m }: { l: IsoLayout; state: TeamState; mood: Mood }) {
  const dep = latestDeploy(state.deploys);
  const approver = state.agents.find((a) => a.isApprover);
  const released = lastReleased(state.releases);
  const ready = readyReleases(state.releases);
  const [sx, sy] = l.sandbox, [vx, vy] = l.vault;
  const text = m.dark >= 0.5 ? '#ffffff' : m.ink;
  const sub = m.dark >= 0.5 ? '#c9cfee' : m.sub;
  const [px, py] = project(l, l.approver.desk.x + 0.6, l.approver.desk.y, 0.9);
  return (
    <>
      <g className="float" data-testid="sandbox-cloud">
        <Puff x={sx} y={sy} s={1.7} fill={m.cloud} />
        <text x={sx} y={sy - 2} textAnchor="middle" className="sky-title" fill={text}>{dep ? dep.org : 'Sandbox'}</text>
        <text x={sx} y={sy + 7} textAnchor="middle" className="sky-sub" fill={dep?.result === 'failed' ? 'var(--alert)' : sub}>
          {dep ? deployLine(dep) : 'No deploys yet'}
        </text>
      </g>
      <g data-testid="vault-cloud">
        <Puff x={vx} y={vy} s={1.9} fill={m.vault} />
        <text x={vx} y={vy - 3} textAnchor="middle" className="sky-title" fill={text}>🔒 Production</text>
        <text x={vx} y={vy + 5} textAnchor="middle" className="sky-sub" fill={sub}>{`deployed by ${approver?.name ?? 'the approver'} via change set`}</text>
        {released && <text x={vx} y={vy + 12} textAnchor="middle" className="sky-sub" fill={sub}>{`${released.task} released`}</text>}
        <title>{`Production · deployed by ${approver?.name ?? 'the approver'} via change set`}</title>
      </g>
      {ready.length > 0 && (
        <g data-testid="changeset-parcel" transform={`translate(${px},${py})`}>
          <rect x={-5} y={-5} width={10} height={9} rx={1.5} className="parcel" />
          <line x1={-5} y1={-1} x2={5} y2={-1} className="parcel-tape" />
          <text x={8} y={2} className="sky-sub parcel-text" fill={text}>
            {`Change set ready · ${ready[0].components} component${ready[0].components === 1 ? '' : 's'}${ready.length > 1 ? ` (+${ready.length - 1} more)` : ''}`}
          </text>
        </g>
      )}
    </>
  );
}

/** HTML: the Tasks cloud card (top left) and guard-blocked bubbles at desks. */
export function SkyOverlays({ l, state }: { l: IsoLayout; state: TeamState }) {
  const tasks = activeTasks(state.tasks);
  const bubbles = guardBubbles(state.guardBlocks, state.updatedAt);
  return (
    <>
      <section className="tasks-card" aria-label="Tasks">
        <h2>Tasks</h2>
        {tasks.length === 0 ? <p>No active tasks.</p> : (
          <ul>
            {tasks.map((t) => (
              <li key={t.id}>
                <span className="tasks-card-name"><b>{t.id}</b> {t.title}</span>
                <ProgressBar small label={`${t.id} ${t.title}`} progress={t.progress} stage={t.stage}
                  color={state.agents.find((a) => a.id === t.owner)?.color} />
              </li>
            ))}
          </ul>
        )}
      </section>
      {Object.values(bubbles).map((b) => {
        const d = l.desks.find((x) => x.id === b.agent);
        if (!d) return null;
        return (
          <div key={b.agent} className="guard-bubble" data-testid={`guard-bubble-${b.agent}`} role="status"
            style={pct(l, project(l, d.x + 0.3, d.y, 3.2))}>
            🛡 Guard blocked <span className="guard-bubble-why">{agentName(state.agents, b.agent)}: {b.reason}</span>
          </div>
        );
      })}
    </>
  );
}
```

Wire in `App.tsx`: `scene={(l) => <SkyScene l={l} state={state} mood={mood} />}` and add `<SkyOverlays l={l} state={state} />` inside the existing `overlays` render (wrap both overlays in a fragment).

- [ ] **Step 6: CSS** (append to `office.css`)

```css
.sky-title { font-size: 6.5px; font-weight: 700; }
.sky-sub { font-size: 5.5px; }
.parcel { fill: var(--approval); stroke: #2a2f45; stroke-width: 0.7; }
.parcel-tape { stroke: #2a2f45; stroke-width: 0.6; }
.tasks-card { position: absolute; top: 2%; left: 2%; width: min(34%, 240px); padding: 8px 10px; border-radius: 16px;
  background: var(--paper); color: var(--ink); box-shadow: 0 4px 14px rgb(0 0 0 / 0.12); font-size: 0.75rem; z-index: 1; }
.tasks-card h2 { margin: 0 0 4px; font-size: 0.8rem; }
.tasks-card ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.tasks-card-name { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.task-bar { display: flex; align-items: center; gap: 6px; }
.task-bar .meter { flex: 1; }
.task-bar-text { white-space: nowrap; color: var(--ink-soft); font-size: 0.7rem; }
.guard-bubble { position: absolute; transform: translate(-50%, -100%); padding: 3px 8px; border-radius: 10px;
  background: var(--alert); color: #fff; font-size: 0.7rem; font-weight: 700; white-space: nowrap; z-index: 2; }
.guard-bubble-why { position: absolute; left: -9999px; }
@media (prefers-reduced-motion: no-preference) {
  .float { animation: float 6s ease-in-out infinite alternate; }
}
@keyframes float { to { transform: translateY(-3px); } }
```

(`.guard-bubble-why` is visually hidden text for screen readers; if the codebase already has `.visually-hidden`, use that class instead.)

- [ ] **Step 7: Verify** — `npx vitest run && npm run typecheck && npm run lint && npx playwright test test/e2e/office-sf.spec.ts test/e2e/office.spec.ts` → PASS.

Note: the guard bubble test relies on the fixture clock (block at 10:09:40, now 10:10:00 + seconds). If the e2e run is slow enough that 40 s pass before the assertion, move the fixture block to `10:09:55`.

- [ ] **Step 8: Commit**

```bash
git add -A dashboard/src test/office-data.test.mjs test/e2e/office-sf.spec.ts
git commit -m "Dashboard: Tasks card, sandbox and production clouds, change-set parcel, guard bubbles"
```

---

### Task 7: Flights — handoff folder, deploy parcel, released parcel

**Files:**
- Create: `dashboard/src/fresh.ts`, `dashboard/src/components/Flights.tsx`
- Delete: `dashboard/src/components/MailTube.tsx`
- Modify: `dashboard/src/App.tsx` (replace `useArrivals`), `dashboard/src/office.css`
- Test: `test/fresh.test.mjs`, `test/e2e/office-sf.spec.ts`, `test/e2e/office-extras.spec.ts`

**Interfaces:**
- Consumes: `arcPath`, `project`, `IsoLayout` (Task 2); `IsoOffice` `scene` prop (Task 5); `SkyScene` placement of `l.sandbox`, `l.vault`, `l.approver.desk` (Task 6).
- Produces:
  - `freshSince<T>(seen: Set<string> | null, items: T[], key: (t: T) => string): { seen: Set<string>; fresh: T[] }` — first call (seen null) marks everything seen and returns no fresh items.
  - `useFresh<T>(items: T[] | undefined, key, ttlMs: number): T[]` — items that appeared after the first poll, each kept for `ttlMs`.
  - `FLIGHT_MS = 4000` (same as old `NEWS_MS`; `App` keeps exporting `NEWS_MS = FLIGHT_MS` for the plaque).
  - `<Flights l state handoffs deploys released />` SVG.

- [ ] **Step 1: Unit test** — `test/fresh.test.mjs`

```js
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
```

Run → FAIL; implement:

```ts
import { useEffect, useRef, useState } from 'react';

/** Items whose key was not seen before. The first call only records what is already there. */
export function freshSince<T>(seen: Set<string> | null, items: T[], key: (t: T) => string): { seen: Set<string>; fresh: T[] } {
  if (seen === null) return { seen: new Set(items.map(key)), fresh: [] };
  const fresh = items.filter((t) => !seen.has(key(t)));
  for (const t of fresh) seen.add(key(t));
  return { seen, fresh };
}

/** Items that arrived after the first poll, each kept for `ttlMs` (one flight, one plaque). */
export function useFresh<T>(items: T[] | undefined, key: (t: T) => string, ttlMs: number): T[] {
  const seen = useRef<Set<string> | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const [live, setLive] = useState<T[]>([]);

  useEffect(() => {
    if (!items) return;
    const r = freshSince(seen.current, items, key);
    seen.current = r.seen;
    if (r.fresh.length === 0) return;
    for (const t of r.fresh) {
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        setLive((list) => list.filter((x) => key(x) !== key(t)));
      }, ttlMs);
      timers.current.add(timer);
    }
    setLive((list) => [...list, ...r.fresh]);
    // `key` is a module-level function at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, ttlMs]);

  useEffect(() => {
    const pending = timers.current;
    return () => { pending.forEach(clearTimeout); pending.clear(); };
  }, []);
  return live;
}
```

(Drop the eslint-disable comment if the repo's ESLint config has no `react-hooks` plugin — check `eslint.config.mjs`.)

- [ ] **Step 2: e2e first** — add to `test/e2e/office-sf.spec.ts` (import `appendEvent` from `../../lib/events.mjs`, `path` from `node:path`, and `FIXTURE_NOW`; copy how `office.spec.ts` appends events and computes the log path):

```ts
test('a new deploy flies a parcel to the sandbox cloud and updates it', async ({ page }) => {
  await page.goto(office.url);
  await expect(page.getByTestId('sandbox-cloud')).toContainText('✗ failed');
  appendEvent(logPath(office), { source: 'cli', type: 'deploy', agent: 'developer', org: 'sandbox', result: 'passed', tests: '141/141', coverage: 84, task: 'T-102' });
  await expect(page.getByTestId('flight-deploy')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('sandbox-cloud')).toContainText('✓ passed · 141/141 tests · 84%');
});

test('released moves the parcel into the vault', async ({ page }) => {
  await page.goto(office.url);
  appendEvent(logPath(office), { source: 'cli', type: 'released', agent: 'planner', task: 'T-104' });
  await expect(page.getByTestId('flight-released')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('changeset-parcel')).toHaveCount(0);
  await expect(page.getByTestId('vault-cloud')).toContainText('T-104 released');
});

test('a handoff flies a folder and labels the receiver', async ({ page }) => {
  await page.goto(office.url);
  appendEvent(logPath(office), { source: 'cli', type: 'handoff', from: 'admin', to: 'qa', task: 'T-101' });
  await expect(page.getByTestId('flight-handoff')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('[data-agent="qa"] .chip-task')).toHaveText('New from Admin');
});
```

Where `const logPath = (o: Office) => path.join(o.projectDir, '.team', 'events.jsonl');` (confirm the file name against `office.spec.ts`).

In `office-extras.spec.ts`, move `a new handoff shows New from <sender> on the receiver plaque` and both reduced-motion tests to `sf-office` and the new markup: the reduced-motion test asserts that after appending a handoff, no element in `.iso-scene` has a running animation (`getAnimations().length === 0` over `document.querySelectorAll('.iso-scene *')`), and that `[data-testid="flight-handoff"]` is not rendered; the control test asserts the opposite for a working desk glow. Read the existing tests first and keep their structure.

Run → FAIL.

- [ ] **Step 3: `Flights.tsx`** — CSS `offset-path` motion (respects the media query; SMIL would not):

```tsx
import type { CSSProperties } from 'react';
import type { AgentState, Deploy, Handoff, Release } from '../types';
import { arcPath, project, type IsoLayout, type Pt } from '../iso';

export interface FlightsProps {
  l: IsoLayout;
  agents: AgentState[];
  handoffs: Handoff[];
  deploys: Deploy[];
  released: Release[];
}

/** Screen point just above an agent's desk (the approver's desk for the approver). */
function deskPoint(l: IsoLayout, agents: AgentState[], id: string): Pt | null {
  const a = agents.find((x) => x.id === id);
  if (a?.isApprover) return project(l, l.approver.desk.x + 0.6, l.approver.desk.y, 1);
  const d = l.desks.find((x) => x.id === id);
  return d ? project(l, d.x + 0.75, d.y, 1) : null;
}

function Flight({ path, kind, color }: { path: string; kind: string; color: string }) {
  return (
    <g className={`flight flight-${kind}`} data-testid={`flight-${kind}`} style={{ offsetPath: `path('${path}')`, '--fly': color } as CSSProperties}>
      {kind === 'handoff'
        ? <path d="M-6,-4 h4 l1.5,1.5 h6.5 v7 h-12 z" fill={color} stroke="#2a2f45" strokeWidth={0.6} />
        : <><rect x={-5} y={-5} width={10} height={9} rx={1.5} className="parcel" /><line x1={-5} y1={-1} x2={5} y2={-1} className="parcel-tape" /></>}
    </g>
  );
}

/** Things in the air: folders between desks, parcels to the sandbox and into the vault (spec 8.3). */
export function Flights({ l, agents, handoffs, deploys, released }: FlightsProps) {
  const color = (id: string) => agents.find((a) => a.id === id)?.color ?? '#ffb900';
  const approverId = agents.find((a) => a.isApprover)?.id ?? '';
  return (
    <g className="flights" aria-hidden="true">
      {handoffs.map((h) => {
        const a = deskPoint(l, agents, h.from), b = deskPoint(l, agents, h.to);
        return a && b && <Flight key={`h-${h.from}-${h.to}-${h.time}`} kind="handoff" color={color(h.from)} path={arcPath(a, b)} />;
      })}
      {deploys.map((d) => {
        const a = deskPoint(l, agents, d.agent);
        return a && <Flight key={`d-${d.org}-${d.time}`} kind="deploy" color={color(d.agent)} path={arcPath(a, l.sandbox, 60)} />;
      })}
      {released.map((r) => {
        const a = deskPoint(l, agents, approverId);
        return a && <Flight key={`r-${r.task}-${r.time}`} kind="released" color="#ffb900" path={arcPath(a, l.vault, 20)} />;
      })}
    </g>
  );
}
```

- [ ] **Step 4: Wire in `App.tsx`**

Replace `useArrivals` with `useFresh`:

```ts
const hKey = (h: Handoff) => `${h.from}|${h.to}|${h.task}|${h.time}`;
const dKey = (d: Deploy) => `${d.org}|${d.time}`;
const rKey = (r: Release) => `${r.task}|${r.state}`;

// in App:
const handoffs = useFresh(state?.handoffs, hKey, FLIGHT_MS);
const deploys = useFresh(state?.deploys, dKey, FLIGHT_MS);
const released = useFresh(state?.releases, rKey, FLIGHT_MS).filter((r) => r.state === 'released');
```

Plaques: `for (const h of handoffs) plaques[h.to] = \`New from ${agentName(state.agents, h.from)}\`;`. In `scene`, render `<SkyScene …/>` then `<Flights l={l} agents={state.agents} handoffs={handoffs} deploys={deploys} released={released} />`. Export `FLIGHT_MS = 4000` from `fresh.ts` and keep `export const NEWS_MS = FLIGHT_MS;` in `App.tsx` if any test imports it (grep). Delete `MailTube.tsx` and the `Flight` type import. Under reduced motion the flights must not render at all: wrap with `const still = useReducedMotion()` (a 10-line hook using `matchMedia('(prefers-reduced-motion: reduce)')` with a change listener, in `fresh.ts`) and pass empty arrays to `Flights` when `still` — plaques still show.

- [ ] **Step 5: CSS**

```css
.flight { offset-rotate: 0deg; offset-distance: 100%; opacity: 0; }
@media (prefers-reduced-motion: no-preference) {
  .flight { animation: fly 1.6s ease-in-out forwards; }
  .flight-handoff { filter: drop-shadow(0 0 2px var(--fly)); }
}
@keyframes fly {
  0% { offset-distance: 0%; opacity: 0; }
  10% { opacity: 1; }
  85% { opacity: 1; }
  100% { offset-distance: 100%; opacity: 0; }
}
```

The e2e `toBeVisible` checks for flights run while the element is mounted (4 s) — Playwright treats `opacity: 0` as visible, so the assertion holds through the whole flight.

- [ ] **Step 6: Verify** — `npx vitest run && npm run typecheck && npm run lint && npx playwright test test/e2e/office-sf.spec.ts test/e2e/office-extras.spec.ts` → PASS.

- [ ] **Step 7: Commit**

```bash
git add -A dashboard/src test/fresh.test.mjs test/e2e
git commit -m "Dashboard: handoff folders, deploy and release parcels fly with CSS motion paths"
```

---

### Task 8: Progress and releases in the board, Clipboard, preview and List view

**Files:**
- Modify: `dashboard/src/components/{Lobby,Clipboard,ListView}.tsx`, `dashboard/src/App.tsx` (Clipboard props), `dashboard/src/office.css` (only if needed)
- Test: `test/e2e/office-extras.spec.ts` (board + list view tests move to `sf-office`)

**Interfaces:**
- Consumes: `ProgressBar` (Task 6); `lastDeployBy`, `deployLine`, `readyReleases` (Task 6); `Task.progress/stage`, `Release`, `Deploy`, `GuardBlock` (Task 1).
- Produces: `ClipboardProps` gains `tasks: Task[]; deploys: Deploy[]`. `ListView` gains sections `Releases`, `Sandbox deploys`, `Guard blocks`.

- [ ] **Step 1: e2e first** — in `office-extras.spec.ts` switch the `lobby task board` describe and the `list view` describe to `sf-office` (each `describe` gets its own `beforeEach`), and replace `a ticket shows id, title, owner and progress when in progress` with:

```ts
test('a ticket shows its task progress bar and stage', async ({ page }) => {
  await page.goto(office.url);
  const board = page.getByRole('region', { name: 'Task board' });
  const bar = board.getByRole('progressbar', { name: /T-101/ });
  await expect(bar).toHaveAttribute('aria-valuetext', '65%, In sandbox');
  await expect(board.getByText('65% · In sandbox')).toBeVisible();
});
```

Update the column-count expectations to the `sf-office` tasks: To do 2 (T-103, T-105), In progress 2 (T-101, T-102), In review 1 (T-104), Done 1 (T-100). The "caps each at 3 tickets" and "expand button" tests need a column with more than 3 tasks: keep those two on `busy` in their own describe.

Add to `office-sf.spec.ts`:

```ts
test('clipboard shows the agent task bar and last deploy', async ({ page }) => {
  await page.goto(office.url);
  await page.getByRole('button', { name: /^Admin, working/ }).click();
  const details = page.getByRole('complementary', { name: 'Details' });
  await expect(details.getByRole('progressbar', { name: /T-101/ })).toHaveAttribute('aria-valuetext', '65%, In sandbox');
  await expect(details).toContainText('Last deploy');
  await expect(details).toContainText('cleanup-sandbox · ✓ passed · 142/142 tests · 87%');
});

test('list view: task rows carry % and stage; releases, deploys and guard blocks are listed', async ({ page }) => {
  await page.goto(office.url);
  await page.getByRole('button', { name: 'List view' }).click();
  const list = page.getByRole('region', { name: 'List view' });
  await expect(list).toContainText('T-101 Renewal discount flow, Admin · 65% · In sandbox');
  await expect(list.getByRole('heading', { name: 'Releases' })).toBeVisible();
  await expect(list).toContainText('T-104 Change set ready · 3 components');
  await expect(list).toContainText('T-100 Released');
  await expect(list.getByRole('heading', { name: 'Sandbox deploys' })).toBeVisible();
  await expect(list).toContainText('sandbox by Developer · ✗ failed · 140/141 tests · 81%');
  await expect(list.getByRole('heading', { name: 'Guard blocks' })).toBeVisible();
  await expect(list).toContainText('Developer: prod is not a sandbox alias');
});
```

Run → FAIL.

- [ ] **Step 2: Lobby** — delete `ticketProgress`; each ticket's owner line becomes `agentName(...)` only, and below it:

```tsx
<ProgressBar small label={`${t.id} ${t.title}`} progress={t.progress} stage={t.stage} color={owner?.color} />
```

- [ ] **Step 3: Clipboard** — new props `tasks`, `deploys` (pass `state.tasks`, `state.deploys` from `App`). In `AgentDetails`, for non-approvers, after the existing `Progress` block add:

```tsx
{task && (
  <>
    <dt>Task</dt>
    <dd><ProgressBar label={`${task.id} ${task.title}`} progress={task.progress} stage={task.stage} color={a.color} /></dd>
  </>
)}
{deploy && (
  <>
    <dt>Last deploy</dt>
    <dd>{`${deploy.org} · ${deployLine(deploy)}`} <span className="clipboard-note">{ago(deploy.time, now)}</span></dd>
  </>
)}
```

with `const task = tasks.find((t) => t.id === a.currentTask) ?? null;` and `const deploy = lastDeployBy(a.id, deploys);`.

- [ ] **Step 4: ListView** — task rows:

```tsx
<li key={t.id}><strong>{t.id}</strong> {t.title}, {agentName(agents, t.owner)} · {t.progress}% · {t.stage}</li>
```

After `Approvals`, add (destructure `releases, deploys, guardBlocks` from `state`):

```tsx
<h2>Releases</h2>
{releases.length === 0 ? <p>No change sets yet.</p> : (
  <ul>
    {releases.map((r) => (
      <li key={r.task}><strong>{r.task}</strong> {r.state === 'ready'
        ? `Change set ready · ${r.components} component${r.components === 1 ? '' : 's'}${r.file ? ` (${r.file})` : ''}`
        : 'Released'}</li>
    ))}
  </ul>
)}
<h2>Sandbox deploys</h2>
{deploys.length === 0 ? <p>No deploys yet.</p> : (
  <ul>{deploys.map((d) => <li key={d.org}><strong>{d.org}</strong> by {agentName(agents, d.agent)} · {deployLine(d)}</li>)}</ul>
)}
<h2>Guard blocks</h2>
{guardBlocks.length === 0 ? <p>None.</p> : (
  <ul>{[...guardBlocks].reverse().map((b, i) => <li key={`${b.time}-${i}`}>{agentName(agents, b.agent)}: {b.reason}</li>)}</ul>
)}
```

Text nodes must render exactly as the e2e strings above (e.g. `T-101 Renewal discount flow, Admin · 65% · In sandbox` once `<strong>` text is joined); adjust spacing in JSX, not the test.

- [ ] **Step 5: Verify** — `npx vitest run && npm run typecheck && npm run lint && npx playwright test test/e2e/office-sf.spec.ts test/e2e/office-extras.spec.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add -A dashboard/src test/e2e
git commit -m "Dashboard: task progress on the board and clipboard; releases, deploys and guard blocks in list view"
```

---

### Task 9: Mood screenshots, reduced-motion sweep, docs, full suite

**Files:**
- Modify: `test/e2e/office-extras.spec.ts` (screenshot test), `README.md` (dashboard section), `dashboard/src/office.css` (only fixes)
- Test: full suite

- [ ] **Step 1: Screenshot test** — replace the old three-theme screenshot test with:

```ts
test('screenshots of the four moods at fixed times', async ({ page }) => {
  const office = await startOffice('sf-office');
  try {
    for (const [name, hour] of [['night', 2], ['sunrise', 8], ['mint', 12], ['twilight', 18]] as const) {
      await page.clock.setFixedTime(new Date(2026, 9, 20, hour, 0));
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(office.url);
      await expect(page.getByRole('region', { name: 'Office' })).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`mood-${name}.png`), fullPage: true });
    }
  } finally {
    await office.close();
  }
});
```

(Adapt to how the file opens offices — if it uses a shared `beforeEach`, put this test in a describe on `sf-office`.)

- [ ] **Step 2: Reduced-motion sweep test** — add to `office-sf.spec.ts`:

```ts
test('reduced motion: no animation runs anywhere in the scene, desks keep state colours', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(office.url);
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
  expect(running).toBe(0);
  await expect(page.locator('[data-agent="developer"]')).toHaveClass(/is-blocked/);
});

test('phone width opens the list view', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(office.url);
  await expect(page.getByRole('region', { name: 'List view' })).toBeVisible();
});
```

- [ ] **Step 3: Look at the screenshots** — open each `mood-*.png` from `test-results` with the Read tool. Check: chips readable, Tasks card does not cover desks, sandbox/vault text inside their clouds, Night shift panels dark with light text, nothing clipped at 1280×800. Fix CSS/constants only for real defects (memory rule: screenshot-check before showing Jimmy). Attach the four paths in the task report.

- [ ] **Step 4: Docs** — `grep -n -i "cozy day\|pastel\|mail tube\|building\|theme" README.md`; update the dashboard section to describe the isometric office, Auto + four moods, the sky clouds and parcels, and reduced motion. Keep it short; no new sections.

- [ ] **Step 5: Full suite**

Run: `npm run lint && npm run typecheck && npx vitest run && npx playwright test`
Expected: all green. Record the test counts in the commit body.

- [ ] **Step 6: Commit**

```bash
git add -A test/e2e README.md dashboard/src
git commit -m "Dashboard: mood screenshots, reduced-motion sweep, README for the cloud office"
```

---

### Task 10: Impeccable polish (only with Jimmy's yes)

- [ ] **Step 1:** Ask Jimmy (question prompt) whether to install the Impeccable plugin now. If no: mark the task skipped in the ledger and go to Task 11.
- [ ] **Step 2:** If yes: install the plugin, run `/impeccable init` with the spec section 8 and the mockup as context, then `critique`, `audit`, `polish` on the office scene, Clipboard, board and List view.
- [ ] **Step 3:** Apply only changes that keep every test green and keep the Global Constraints (no SMIL, motion guard, text with every status). Re-run Task 9 Step 3 screenshots and the full suite.
- [ ] **Step 4:** Commit: `Dashboard: Impeccable polish (type, spacing, detail)`.

---

### Task 11: Final review and PR (needs Jimmy's yes)

- [ ] **Step 1:** Final whole-branch review on the most capable model (spec section 8 + this plan + `git diff main...feature/dashboard`), including the deferred minors.
- [ ] **Step 2:** Ask Jimmy before pushing. Then `git push -u origin feature/dashboard` and open the PR with `~/.local/bin/gh pr create` (fall back to `gh api repos/Jimmyvo23/salesforce-team-kit/pulls` if GraphQL fails). PR body ends with the Claude Code attribution line.
