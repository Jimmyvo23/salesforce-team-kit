import path from 'node:path';
import { test, expect } from '@playwright/test';
import { appendEvent } from '../../lib/events.mjs';
import { FIXTURE_NOW } from '../fixtures/projects/fixture-clock.mjs';
import { startOffice, type Office } from './helpers';

let office: Office;
test.beforeEach(async () => { office = await startOffice('sf-office'); });
test.afterEach(async () => { await office.close(); });

/** Append an event to the running office's log, a second after fixture time. */
function append(event: Record<string, unknown>) {
  appendEvent(path.join(office.projectDir, '.team', 'events.jsonl'), {
    source: 'cli', time: new Date(Date.parse(FIXTURE_NOW) + 1000).toISOString(), ...event,
  });
}

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

test('a new deploy flies a parcel to the sandbox cloud and updates it', async ({ page }) => {
  await page.goto(office.url);
  await expect(page.getByTestId('sandbox-cloud')).toContainText('✗ failed');
  append({ type: 'deploy', agent: 'developer', org: 'sandbox', result: 'passed', tests: '141/141', coverage: 84, task: 'T-102' });
  await expect(page.getByTestId('flight-deploy')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('sandbox-cloud')).toContainText('✓ passed · 141/141 tests · 84%');
});

test('released moves the parcel into the vault', async ({ page }) => {
  await page.goto(office.url);
  await expect(page.getByTestId('vault-cloud')).toBeVisible(); // first poll done: later events are news
  append({ type: 'released', agent: 'planner', task: 'T-104' });
  await expect(page.getByTestId('flight-released')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('changeset-parcel')).toHaveCount(0);
  await expect(page.getByTestId('vault-cloud')).toContainText('T-104 released');
});

test('a handoff flies a folder and labels the receiver', async ({ page }) => {
  await page.goto(office.url);
  await expect(page.getByTestId('vault-cloud')).toBeVisible(); // first poll done: later events are news
  append({ type: 'handoff', from: 'admin', to: 'qa', task: 'T-101' });
  await expect(page.getByTestId('flight-handoff')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('[data-agent="qa"] .chip-task')).toHaveText('New from Admin');
});

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
