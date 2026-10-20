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
