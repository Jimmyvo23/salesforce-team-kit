import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { appendEvent } from '../../lib/events.mjs';
import { FIXTURE_NOW } from '../fixtures/projects/fixture-clock.mjs';
import { startOffice, type Office } from './helpers';

let office: Office | undefined;

test.afterEach(async () => {
  await office?.close();
  office = undefined;
});

async function open(page: Page, fixture: string) {
  office = await startOffice(fixture);
  await page.goto(office.url);
}

/** Append an event to the running office's log, a few seconds after fixture time. */
function append(event: Record<string, unknown>, offsetSeconds = 1) {
  appendEvent(path.join(office!.projectDir, '.team', 'events.jsonl'), {
    source: 'cli', time: new Date(Date.parse(FIXTURE_NOW) + offsetSeconds * 1000).toISOString(), ...event,
  });
}

const details = (page: Page) => page.getByRole('complementary', { name: 'Details' });
const sign = (page: Page) => page.getByRole('button', { name: /need(s)? you/ });

test.describe('needs-you sign', () => {
  test('says how many things need the approver, with the first item', async ({ page }) => {
    await open(page, 'busy');
    await expect(sign(page)).toBeVisible();
    await expect(sign(page)).toContainText('Jimmy, 2 things need you');
    await expect(sign(page)).toContainText('WO-3');
  });

  test('uses the singular for one item', async ({ page }) => {
    await open(page, 'busy');
    append({ type: 'status', agent: 'reviewer', status: 'working', task: 'T-003', progress: 50 });
    await expect(sign(page)).toContainText('Jimmy, 1 thing needs you', { timeout: 4000 });
  });

  test('is absent when nothing needs the approver', async ({ page }) => {
    await open(page, 'empty');
    await expect(page.getByRole('heading', { name: 'CookNeighbour team' })).toBeVisible();
    await expect(sign(page)).toHaveCount(0);
  });

  test('screen readers hear the needs-you title through a live region', async ({ page }) => {
    await open(page, 'busy');
    const live = page.locator('.visually-hidden[aria-live="polite"]');
    await expect(live).toHaveText('Jimmy, 2 things need you');
    append({ type: 'status', agent: 'reviewer', status: 'working', task: 'T-003', progress: 50 });
    await expect(live).toHaveText('Jimmy, 1 thing needs you', { timeout: 4000 });
  });

  test('clicking it pins the approver clipboard with every item', async ({ page }) => {
    await open(page, 'busy');
    await sign(page).click();
    await expect(details(page)).toContainText('Jimmy');
    await expect(details(page)).toContainText('WO-3');
    await expect(details(page)).toContainText('Work Order for T-007 to T-009: booking form and chat');
    await expect(details(page)).toContainText('Reviewer is stuck');
    await expect(details(page)).toContainText('Checks failing');
    await expect(page.locator('[data-agent="jimmy"]')).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('lobby task board', () => {
  test('has four columns with counts and caps each at 3 tickets', async ({ page }) => {
    await open(page, 'busy');
    const board = page.getByRole('region', { name: 'Task board' });
    await expect(board).toBeVisible();
    for (const name of ['To do, 1 task', 'In progress, 1 task', 'In review, 1 task', 'Done, 5 tasks']) {
      await expect(board.getByRole('heading', { name, exact: true })).toBeVisible();
    }
    const done = board.getByRole('list', { name: 'Done' });
    await expect(done.getByRole('listitem')).toHaveCount(3);
    const more = board.getByRole('button', { name: 'and 2 more' });
    await expect(more).toBeVisible();
    await more.click();
    await expect(done.getByRole('listitem')).toHaveCount(5);
  });

  test('the expand button keeps focus and flips aria-expanded', async ({ page }) => {
    await open(page, 'busy');
    const board = page.getByRole('region', { name: 'Task board' });
    const done = board.getByRole('list', { name: 'Done' });
    const toggle = board.getByRole('button', { name: 'and 2 more' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(done.getByRole('listitem')).toHaveCount(5);
    const focused = page.locator(':focus');
    await expect(focused).toHaveText('Show fewer');
    await expect(focused).toHaveAttribute('aria-expanded', 'true');
    await expect(focused).toHaveAttribute('aria-controls', 'lobby-done');
    await page.keyboard.press('Enter');
    await expect(done.getByRole('listitem')).toHaveCount(3);
    await expect(page.locator(':focus')).toHaveText('and 2 more');
    await expect(page.locator(':focus')).toHaveAttribute('aria-expanded', 'false');
  });

  test('a ticket shows id, title, owner and progress when in progress', async ({ page }) => {
    await open(page, 'busy');
    const inProgress = page.getByRole('region', { name: 'Task board' }).getByRole('list', { name: 'In progress' });
    const ticket = inProgress.getByRole('listitem').first();
    await expect(ticket).toContainText('T-004');
    await expect(ticket).toContainText('Backend');
    await expect(ticket).toContainText('40%');
  });
});

test('a new handoff shows New from <sender> on the receiver plaque', async ({ page }) => {
  await open(page, 'sf-office');
  const qa = page.locator('[data-agent="qa"]');
  await expect(qa).toBeVisible();
  await expect(qa).not.toContainText('New from');
  append({ type: 'handoff', from: 'admin', to: 'qa', task: 'T-101' });
  await expect(qa).toContainText('New from Admin', { timeout: 4000 });
  await expect(qa).not.toContainText('New from Admin', { timeout: 7000 });
});

test('a visitor hot desk appears only after an unknown agent is active', async ({ page }) => {
  await open(page, 'busy');
  const office$ = page.getByRole('region', { name: 'Office' });
  await expect(office$.getByRole('button', { name: /^Planner,/ })).toBeVisible();
  await expect(office$.getByText('Hot desk')).toHaveCount(0);
  append({ type: 'status', agent: 'security-bot', status: 'working', task: 'Audit' });
  await expect(office$.getByRole('button', { name: /^security-bot,/ })).toBeVisible({ timeout: 4000 });
  await expect(office$.getByText('Hot desk')).toBeVisible();
});

test('mood picker offers Auto plus four moods, Auto checked by default', async ({ page }) => {
  await open(page, 'busy');
  const picker = page.getByRole('radiogroup', { name: 'Mood' });
  await expect(picker.getByRole('radio')).toHaveCount(5);
  await expect(picker.getByRole('radio', { name: 'Auto' })).toBeChecked();
});

test('pinned mood survives a reload and sets dark panels for Night shift', async ({ page }) => {
  await open(page, 'busy');
  await page.getByRole('radio', { name: 'Night shift' }).check();
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Night shift' })).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-dark', 'true');
});

test('Auto follows the clock: 12:00 is Mint morning, 22:00 is dark', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 20, 12, 0));
  await open(page, 'busy');
  await expect(page.locator('html')).toHaveAttribute('data-dark', 'false');
  await page.clock.setFixedTime(new Date(2026, 9, 20, 22, 0));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-dark', 'true');
});

test('the office works when storage is blocked', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
  });
  await open(page, 'busy');
  await page.getByRole('radio', { name: 'Sunrise' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-mood', 'sunrise');
  await expect(page.getByRole('button', { name: /^Backend,/ })).toBeVisible();
});

test('reduced motion: nothing animates, including a handoff', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, 'sf-office');
  const qa = page.locator('[data-agent="qa"]');
  await expect(qa).toBeVisible();
  append({ type: 'handoff', from: 'admin', to: 'qa', task: 'T-101' });
  await expect(qa).toContainText('New from Admin', { timeout: 4000 });
  await expect(page.getByTestId('flight-handoff')).toHaveCount(0);
  expect(await page.evaluate(() =>
    [...document.querySelectorAll('.iso-scene *')].reduce((n, el) => n + el.getAnimations().length, 0))).toBe(0);
});

test('with motion allowed the office does animate (control for the test above)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await open(page, 'sf-office');
  await expect(page.locator('[data-agent="admin"]')).toBeVisible();
  expect(await page.evaluate(() =>
    [...document.querySelectorAll('.iso-scene *')].reduce((n, el) => n + el.getAnimations().length, 0))).toBeGreaterThan(0);
});

test.describe('list view', () => {
  test('is the default on a 360 px screen', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await open(page, 'busy');
    const list = page.getByRole('region', { name: 'List view' });
    await expect(list).toBeVisible();
    await expect(list).toContainText('Backend');
    await expect(list).toContainText('Working, T-004');
    await expect(list).toContainText('T-004');
    await expect(list).toContainText('WO-3');
    await expect(page.getByRole('region', { name: 'Office' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Office view' }).click();
    await expect(page.getByRole('region', { name: 'Office' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'List view' })).toBeVisible();
  });

  test('desktop opens in the office and can switch to the list', async ({ page }) => {
    await open(page, 'busy');
    await expect(page.getByRole('region', { name: 'Office' })).toBeVisible();
    await page.getByRole('button', { name: 'List view' }).click();
    await expect(page.getByRole('region', { name: 'List view' })).toContainText('Reviewer');
    await expect(page.getByRole('region', { name: 'Office' })).toHaveCount(0);
  });
});

test('a broken team file explains the problem', async ({ page }) => {
  await open(page, 'bad-team');
  const alert = page.getByRole('alert');
  await expect(alert.getByRole('heading', { name: 'The team file has a problem' })).toBeVisible();
  await expect(alert).toContainText('JSON');
  await expect(alert).toContainText('Fix .team/team.json and this page will reload.');
});

test('the mood survives the switch from the problem page to the office with storage blocked', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
  });
  await open(page, 'bad-team');
  await expect(page.getByRole('heading', { name: 'The team file has a problem' })).toBeVisible();
  await page.getByRole('radio', { name: 'Night shift' }).check();
  fs.copyFileSync(path.join('test', 'fixtures', 'projects', 'busy', '.team', 'team.json'),
    path.join(office!.projectDir, '.team', 'team.json'));
  await expect(page.getByRole('heading', { name: 'CookNeighbour team' })).toBeVisible({ timeout: 4000 });
  await expect(page.getByRole('radio', { name: 'Night shift' })).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-mood', 'night');
});

test('stopping the server shows the reconnecting overlay over the last state', async ({ page }) => {
  await open(page, 'busy');
  await expect(page.getByRole('button', { name: /^Backend,/ })).toBeVisible();
  await office!.close();
  office = undefined;
  await expect(page.getByText('Paused. Reconnecting…')).toBeVisible({ timeout: 7000 });
  await expect(page.getByRole('heading', { name: 'CookNeighbour team' })).toBeAttached();
  // The toolbar stays usable above the overlay.
  await page.getByRole('radio', { name: 'Night shift' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-mood', 'night');
  await page.getByRole('button', { name: 'List view' }).click();
  await expect(page.getByRole('button', { name: 'Office view' })).toBeVisible();
});

test('re-activating a pinned desk unpins it', async ({ page }) => {
  await open(page, 'busy');
  const backend = page.getByRole('button', { name: /^Backend,/ });
  await backend.click();
  await expect(backend).toHaveAttribute('aria-pressed', 'true');
  await backend.click();
  await expect(backend).toHaveAttribute('aria-pressed', 'false');
  await expect(details(page)).toContainText('Pick a room');
});

test('focus order follows the team: members in order, the approver last', async ({ page }) => {
  await open(page, 'sf-office');
  const names = await page.getByRole('region', { name: 'Office' }).locator('[data-agent]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-agent')));
  expect(names).toEqual(['planner', 'analyst', 'admin', 'developer', 'qa', 'reviewer', 'jimmy']);
});
