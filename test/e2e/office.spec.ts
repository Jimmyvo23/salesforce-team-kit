import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { appendEvent } from '../../lib/events.mjs';
import { FIXTURE_NOW } from '../fixtures/projects/fixture-clock.mjs';
import { startOffice, type Office } from './helpers';

let office: Office;

test.beforeEach(async () => {
  office = await startOffice('sf-office');
});

test.afterEach(async () => {
  await office.close();
});

const details = (page: import('@playwright/test').Page) => page.getByRole('complementary', { name: 'Details' });
const office$ = (page: import('@playwright/test').Page) => page.getByRole('region', { name: 'Office' });

test('renders one desk per agent with the project in the heading', async ({ page }) => {
  await page.goto(office.url);
  await expect(page.getByRole('heading', { name: 'Nitro Cleanup team' })).toBeVisible();
  await expect(office$(page).locator('[data-agent]')).toHaveCount(7);
});

test('desk label uses the plain state wording', async ({ page }) => {
  await page.goto(office.url);
  await expect(page.getByRole('button', { name: 'Developer, stuck: 1 Apex test failing' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Admin, working: T-101' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'QA, on a break: nothing assigned' })).toBeVisible();
});

test('the approver desk waits for approval; desks show their state', async ({ page }) => {
  await page.goto(office.url);
  const jimmy = office$(page).locator('[data-agent="jimmy"]');
  await expect(jimmy).toHaveClass(/is-waiting/);
  await expect(jimmy).toHaveAccessibleName(/^Jimmy, waiting for approval: 1 decision waiting/);
  await expect(office$(page).locator('[data-agent="developer"]')).toHaveClass(/is-blocked/);
  await expect(office$(page).locator('[data-agent="admin"]')).toHaveClass(/is-working/);
  await expect(office$(page).locator('[data-agent="reviewer"]')).toHaveClass(/is-free/);
});

test('hovering a desk shows a preview card', async ({ page }) => {
  await page.goto(office.url);
  await page.getByRole('button', { name: /^Admin,/ }).hover();
  const card = page.getByRole('tooltip');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Admin');
  await expect(card).toContainText('Working');
  await expect(card).toContainText('T-101');
  await expect(card).toContainText('60%');
});

test('clicking a desk pins its clipboard', async ({ page }) => {
  await page.goto(office.url);
  await expect(details(page)).not.toContainText('Hand the flow to QA');
  await page.getByRole('button', { name: /^Admin,/ }).click();
  await expect(details(page)).toContainText('Admin');
  await expect(details(page)).toContainText('Flows, objects, permissions');
  await expect(details(page)).toContainText('Hand the flow to QA');
  await expect(details(page).getByRole('progressbar', { name: 'Progress' })).toHaveAttribute('aria-valuenow', '60');
  await expect(details(page)).toContainText('Updated 2 min ago');
  await expect(page.getByRole('button', { name: /^Admin,/ })).toHaveAttribute('aria-pressed', 'true');
});

test('clipboard shows the reason when an agent is stuck', async ({ page }) => {
  await page.goto(office.url);
  await page.getByRole('button', { name: /^Developer,/ }).click();
  await expect(details(page)).toContainText('Why it is stuck');
  await expect(details(page)).toContainText('1 Apex test failing');
  await expect(details(page).getByRole('listitem').filter({ hasText: 'Stuck: 1 Apex test failing' })).toHaveCount(1);
});

test('keyboard: Tab to a desk and press Enter pins it', async ({ page }) => {
  await page.goto(office.url);
  await expect(page.getByRole('button', { name: /^Architect,/ })).toBeVisible();
  // Start keyboard navigation from the heading; the toolbar comes before it.
  await page.getByRole('heading', { name: 'Nitro Cleanup team' }).click();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /^Architect,/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(details(page)).toContainText('Answer Jimmy on WO-9');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /^Analyst,/ })).toBeFocused();
  await page.keyboard.press(' ');
  await expect(details(page)).toContainText('Write the renewal UAT steps');
});

test('updates within one poll after a new event is appended', async ({ page }) => {
  await page.goto(office.url);
  await expect(page.getByRole('button', { name: /^QA, on a break/ })).toBeVisible();
  appendEvent(path.join(office.projectDir, '.team', 'events.jsonl'), {
    source: 'cli', type: 'status', agent: 'qa', status: 'working', task: 'T-103', progress: 5,
    nextStep: 'Run the renewal UAT', time: new Date(Date.parse(FIXTURE_NOW) + 1000).toISOString(),
  });
  await expect(page.getByRole('button', { name: 'QA, working: T-103' })).toBeVisible({ timeout: 4000 });
});

test('stale agent shows last update warning', async ({ page }) => {
  // Analyst last reported at 10:07, three minutes before fixture time: stale once the limit is 2.5 minutes (Admin, 2 minutes old, is not).
  const teamFile = path.join(office.projectDir, '.team', 'team.json');
  const team = JSON.parse(fs.readFileSync(teamFile, 'utf8'));
  fs.writeFileSync(teamFile, JSON.stringify({ ...team, staleAfterMinutes: 2.5 }));
  await page.goto(office.url);
  await page.getByRole('button', { name: /^Analyst,/ }).click();
  await expect(details(page)).toContainText('Last update 3 min ago');
  await page.getByRole('button', { name: /^Admin,/ }).click();
  await expect(details(page)).not.toContainText('Last update');
});

// Refreshes the pull request screenshot: UPDATE_SCREENSHOT=1 npx playwright test -g "screenshot"
test('screenshot of the Salesforce office', async ({ page }) => {
  test.skip(!process.env.UPDATE_SCREENSHOT, 'set UPDATE_SCREENSHOT=1 to refresh docs/screenshots/office-busy.png');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(office.url);
  await page.getByRole('button', { name: /^Admin,/ }).click();
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join('docs', 'screenshots', 'office-busy.png'), fullPage: true });
});
