import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

describe('Architect rules', () => {
  const p = read('planner/planner.md');

  test('keeps the kit gate: 100 words, per agent approval, 25%, 2 failed rounds', () => {
    expect(p).toMatch(/100 words or fewer/);
    expect(p).toMatch(/per agent/i);
    expect(p).toMatch(/25%/);
    expect(p).toMatch(/2 failed rounds/);
    expect(p).toContain('team-status.mjs escalate');
    expect(p).toMatch(/escalation clears .*next `task` event for that task id/i);
    expect(p.split('\n').length).toBeLessThan(150);
  });

  test('one approval id per agent, linked to the task', () => {
    expect(p).toMatch(/approval --id WO-3-admin .*--agents admin .*--task T-012/);
    expect(p).toMatch(/approval --id WO-3-developer .*--agents developer .*--task T-012/);
    expect(p).toMatch(/decide --id WO-3-admin/);
    expect(p).toContain('--agent planner');
  });

  test('dispatches by team id and names every handoff file', () => {
    expect(p).toMatch(/subagent_type/);
    for (const id of ['analyst', 'admin', 'developer', 'qa', 'reviewer']) expect(p).toContain(`\`${id}\``);
    expect(p).toMatch(/never `general-purpose`/);
    expect(p).toContain('docs/stories/<task-id>.md');
    expect(p).toContain('docs/design/<task-id>.md');
    expect(p).toContain('.team/handoffs/<task-id>-<builder id>.md');
    expect(p).toContain('.team/handoffs/<task-id>-qa.md');
    expect(p).toContain('.team/handoffs/<task-id>-reviewer.md');
  });

  test('Salesforce rules: sandboxes, production, inventory, release', () => {
    expect(p).toContain('orgs.sandbox');
    expect(p).toMatch(/Production is Jimmy's/);
    expect(p).toMatch(/automation inventory/i);
    expect(p).toMatch(/declarative or code/i);
    expect(p).toContain('.team/changeset-template.md');
    expect(p).toContain('docs/release/<task-id>-changeset.md');
    expect(p).toContain('team-status.mjs release --task T-012 --components 9');
    expect(p).toContain('team-status.mjs released --task T-012');
    expect(p).toMatch(/Org knowledge to add/);
  });

  test('names its skills', () => {
    for (const s of ['superpowers:brainstorming', 'superpowers:writing-plans', 'superpowers:subagent-driven-development', 'sf-architecture', 'sf-deploy']) {
      expect(p).toContain(s);
    }
    expect(p).toContain('orgSkill');
  });
});

describe('templates', () => {
  test('work order has the design decision, inventory and table', () => {
    const wo = read('planner/work-order-template.md');
    expect(wo).toContain('## Design decision');
    expect(wo).toContain('## Automation inventory');
    expect(wo).toMatch(/\| Agent \| Task \| Plan[^|]*\| Effort[^|]*\| Risk \|/);
    expect(wo).toContain('## Recommendation');
    expect(wo).toContain('## Left out');
    expect(wo).toContain('--task');
  });

  test('handoff has the four kit sections plus org knowledge', () => {
    const h = read('templates/handoff-template.md');
    for (const s of ['What changed', 'How to verify', 'Known gaps or risks', 'What the next agent needs', 'Org knowledge to add']) {
      expect(h).toContain(`## ${s}`);
    }
    expect(h).toMatch(/Sandbox deploy/);
  });

  test('change set checklist has the seven sections and the commonly missed list', () => {
    const c = read('templates/changeset-template.md');
    for (const s of ['1. Summary', '2. Components to add', '3. Before deploying', '4. Deployment settings', '5. After deploying', '6. Rollback', '7. Check in production']) {
      expect(c).toContain(`## ${s}`);
    }
    for (const s of ['Field-level security', 'Record types', 'Custom metadata records', 'flow version', 'Lightning page activations', 'Custom labels']) {
      expect(c).toContain(s);
    }
  });

  test('CLAUDE.md section is short and Salesforce-specific', () => {
    const t = read('templates/claude-team-section.md');
    expect(t.trimEnd().split('\n').length).toBeLessThanOrEqual(25);
    expect(t).toContain('.team/planner.md');
    expect(t).not.toMatch(/<!--/);
    expect(t).toMatch(/subagent_type/);
    expect(t).toContain('.team/handoffs/<task-id>-<agent id>.md');
    expect(t).toContain('orgs.sandbox');
    expect(t).toMatch(/Never touch production/);
    expect(t).toMatch(/change sets/);
  });
});
