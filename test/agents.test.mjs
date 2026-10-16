import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const MAX_AGENT_FILE_LINES = 80;
const AGENTS = ['analyst', 'admin', 'developer', 'qa', 'reviewer'];
const APPROVED_FIRST = ['admin', 'developer', 'qa', 'reviewer'];

function parse(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error('missing frontmatter');
  const front = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) front[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { front, body: m[2] };
}
const agent = (id) => parse(read(`agents/${id}.md`));

describe('agent files', () => {
  test('the web agents are gone', () => {
    for (const id of ['backend', 'frontend', 'tester']) expect(fs.existsSync(path.join(root, `agents/${id}.md`))).toBe(false);
  });

  test('every team.json member except planner has an agent file whose name matches', () => {
    const ids = JSON.parse(read('templates/team.json')).members.map((m) => m.id).filter((id) => id !== 'planner');
    expect(ids.sort()).toEqual([...AGENTS].sort());
    for (const id of ids) {
      expect(agent(id).front.name).toBe(id);
      expect(agent(id).front.description.length).toBeGreaterThan(40);
    }
  });

  test('tools: reviewer is read-only, everyone else can edit', () => {
    expect(agent('reviewer').front.tools).not.toMatch(/\b(Edit|Write)\b/);
    expect(agent('reviewer').front.tools).toMatch(/\bBash\b/);
    for (const id of ['analyst', 'admin', 'developer', 'qa']) {
      for (const t of ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob']) expect(agent(id).front.tools).toMatch(new RegExp(`\\b${t}\\b`));
    }
  });

  test('models: developer and reviewer opus, the rest sonnet', () => {
    expect(agent('developer').front.model).toBe('opus');
    expect(agent('reviewer').front.model).toBe('opus');
    for (const id of ['analyst', 'admin', 'qa']) expect(agent(id).front.model).toBe('sonnet');
  });

  test('every agent body has the five sections in order and stays short', () => {
    for (const id of AGENTS) {
      const { body } = agent(id);
      const heads = [...body.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
      expect(heads).toEqual(['Role', 'Boundaries', 'Skills to use', 'Reporting', 'Handoff']);
      expect(body.split('\n').length + 5).toBeLessThan(MAX_AGENT_FILE_LINES);
    }
  });

  test('every agent reports with team-status and its own id', () => {
    for (const id of AGENTS) {
      const { body } = agent(id);
      expect(body).toContain('node .team/bin/team-status.mjs');
      expect(body).toContain(`--agent ${id}`);
      expect(body).toContain('--reason');
    }
  });

  test('every agent states the git, sandbox and data rules', () => {
    for (const id of AGENTS) {
      const { body } = agent(id);
      expect(body).toMatch(/never push to `?main`?/i);
      expect(body).toMatch(/never force-push/i);
      expect(body).toMatch(/never commit secrets/i);
      expect(body).toMatch(/feature branch/i);
      expect(body).toContain('orgs.sandbox');
      expect(body).toMatch(/never touch production/i);
      expect(body).toMatch(/real customer data/i);
      expect(body).toContain('orgSkill');
    }
  });

  test('approval and handoff wording', () => {
    for (const id of APPROVED_FIRST) {
      expect(agent(id).body).toMatch(/Do not start before the Architect confirms Jimmy approved/);
      expect(agent(id).body).toContain('handoff-template.md');
    }
    for (const id of ['admin', 'developer', 'qa']) {
      expect(agent(id).body).toContain(`.team/handoffs/<task-id>-${id}.md`);
      expect(agent(id).body).toContain('Org knowledge to add');
    }
    expect(agent('analyst').body).toContain('docs/stories/<task-id>.md');
    expect(agent('analyst').body).toContain('--from analyst --to planner');
  });

  test('builders deploy only to the sandbox and record it', () => {
    for (const id of ['admin', 'developer']) {
      const { body } = agent(id);
      expect(body).toContain('sf project retrieve start -o <alias>');
      expect(body).toContain('--dry-run');
      expect(body).toContain(`team-status.mjs deploy --agent ${id}`);
      expect(body).toContain(`--from ${id} --to qa`);
    }
  });

  test('role boundaries', () => {
    expect(agent('admin').body).toMatch(/Do not write Apex or LWC/);
    expect(agent('developer').body).toMatch(/Do not build flows/);
    expect(agent('analyst').body).toMatch(/Never edit `force-app\/`/);
    expect(agent('qa').body).toMatch(/only create or edit test files/i);
    expect(agent('reviewer').body).toMatch(/read-only/i);
  });

  test('QA and Reviewer route their verdicts', () => {
    expect(agent('qa').body).toContain('--from qa --to reviewer');
    expect(agent('qa').body).toContain('--to <builder id>');
    const r = agent('reviewer').body;
    expect(r).toContain('.team/handoffs/<task-id>-<builder id>.md');
    expect(r).toContain('.team/handoffs/<task-id>-qa.md');
    expect(r).toContain('--from reviewer --to planner');
    expect(r).toContain('sf code-analyzer run');
    expect(r).toMatch(/gh pr review --comment/);
    expect(r).toMatch(/Never use `--approve`/);
  });

  test('skills use exact names', () => {
    const want = {
      analyst: ['sf-architecture'],
      admin: ['sf-flow', 'sf-security', 'sf-deploy', 'superpowers:verification-before-completion', 'superpowers:receiving-code-review'],
      developer: ['sf-apex', 'sf-security', 'sf-deploy', 'superpowers:test-driven-development', 'superpowers:systematic-debugging',
        'superpowers:verification-before-completion', 'superpowers:receiving-code-review'],
      qa: ['sf-testing', 'superpowers:verification-before-completion', 'superpowers:systematic-debugging'],
      reviewer: ['sf-review', 'sf-security', 'superpowers:requesting-code-review', 'superpowers:verification-before-completion'],
    };
    for (const [id, skills] of Object.entries(want)) for (const s of skills) expect(agent(id).body).toContain(`\`${s}\``);
  });
});
