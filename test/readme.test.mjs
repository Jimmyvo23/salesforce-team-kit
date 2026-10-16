import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('package is renamed', () => {
  expect(pkg.name).toBe('salesforce-team-kit');
  expect(pkg.description).toMatch(/Salesforce/);
});

test('README covers install, roles, guard limits and the release hand-off', () => {
  expect(readme).toMatch(/^# salesforce-team-kit/m);
  for (const s of ['Architect', 'Analyst', 'Admin', 'Developer', 'QA', 'Reviewer']) expect(readme).toContain(s);
  expect(readme).toContain('.team/handoffs/<task-id>-<agent id>.md');
  expect(readme).toMatch(/escalation clears .*next `task` event for that task id/i);
  expect(readme).toMatch(/git pull[\s\S]*npm ci[\s\S]*install\.mjs/);
  expect(readme).toContain('orgs.sandbox');
  expect(readme).toMatch(/seatbelt, not a sandbox/);
  expect(readme).toContain('docs/release/<task-id>-changeset.md');
  for (const c of ['deploy', 'release', 'released']) expect(readme).toContain(`| \`${c}\` |`);
  expect(readme).toMatch(/Do not authorise production/i);
});
