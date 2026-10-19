import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScenarios } from '../scripts/lib/scenarios.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = path.join(root, 'skills');
const skills = fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir).filter((d) => fs.statSync(path.join(skillsDir, d)).isDirectory()) : [];
const MAX_BODY_LINES = 200;

function front(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error('missing frontmatter');
  /** @type {Record<string,string>} */ const f = {};
  for (const line of m[1].split('\n')) { const i = line.indexOf(':'); if (i > 0) f[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  return { f, body: m[2] };
}

describe.each(skills.map((s) => [s]))('skill %s', (name) => {
  const dir = path.join(skillsDir, name);
  const read = (p) => fs.readFileSync(path.join(dir, p), 'utf8');

  test('frontmatter: name matches the folder, description starts with "Use when"', () => {
    const { f } = front(read('SKILL.md'));
    expect(Object.keys(f).sort()).toEqual(['description', 'name']);
    expect(f.name).toBe(name);
    expect(f.description).toMatch(/^Use when /);
    expect(f.description.length).toBeLessThanOrEqual(1024);
  });

  test('body is short, reads the API version from sfdx-project.json, never suggests production deploys', () => {
    const { body } = front(read('SKILL.md'));
    expect(body.split('\n').length).toBeLessThanOrEqual(MAX_BODY_LINES);
    const all = [read('SKILL.md'), ...listRefs(dir).map((p) => fs.readFileSync(p, 'utf8'))].join('\n');
    expect(all).toContain('sourceApiVersion');
    expect(all).not.toMatch(/-o\s+prod\b/i);
  });

  test('lists dated documentation sources', () => {
    const s = read('references/sources.md');
    expect(s).toMatch(/https:\/\/(developer|help)\.salesforce\.com\//);
    expect(s).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  test('has 3 to 5 scenarios, and every with-skill result passes', () => {
    const scenarios = parseScenarios(read('tests/scenarios.md'));
    expect(scenarios.length).toBeGreaterThanOrEqual(3);
    expect(scenarios.length).toBeLessThanOrEqual(5);
    for (const s of scenarios) {
      const base = path.join(dir, 'tests', 'results', 'baseline', `${s.id}.json`);
      const withSkill = path.join(dir, 'tests', 'results', 'with-skill', `${s.id}.json`);
      expect(fs.existsSync(base), `${s.id} baseline recorded`).toBe(true);
      expect(JSON.parse(fs.readFileSync(withSkill, 'utf8')).pass, `${s.id} passes with the skill`).toBe(true);
    }
  });
});

/** @param {string} dir */
function listRefs(dir) {
  const refs = path.join(dir, 'references');
  return fs.existsSync(refs) ? fs.readdirSync(refs).filter((f) => f.endsWith('.md')).map((f) => path.join(refs, f)) : [];
}

test('all seven skills exist', () => {
  expect([...skills].sort()).toEqual(['sf-apex', 'sf-architecture', 'sf-deploy', 'sf-flow', 'sf-review', 'sf-security', 'sf-testing']);
});

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

test('pressure-run results hold no org secrets (Ruling T1-a patterns)', () => {
  const secret = /00D[A-Za-z0-9]{12,15}![A-Za-z0-9._]+|accessToken|refresh_token|sfdxAuthUrl|force:\/\//;
  for (const name of skills) {
    const results = path.join(skillsDir, name, 'tests', 'results');
    if (!fs.existsSync(results)) continue;
    for (const f of walk(results)) expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(secret);
  }
});

test('shipped skill files never suggest quick deploys or production targets', () => {
  const files = skills.flatMap((name) => walk(path.join(skillsDir, name)).filter((f) => !f.includes(`${path.sep}tests${path.sep}`) && f.endsWith('.md')));
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    // only the runnable command form (sf-deploy names these inside its refusal table, which is not at line start)
    expect(text, `${f} suggests deploy quick`).not.toMatch(/^\s*(\$ )?sf project deploy quick\b/m);
    expect(text, `${f} targets prod`).not.toMatch(/\bsf\s[^\n`]*(-o|--target-org)[ =]prod\b/i);
  }
});

test('sf-deploy checklist headings equal the change set template headings (Ruling T7-b)', () => {
  const heads = (/** @type {string} */ p) => fs.readFileSync(path.join(root, p), 'utf8').split('\n').filter((l) => /^## \d+\. /.test(l));
  const t = heads('templates/changeset-template.md');
  expect(t).toHaveLength(7);
  expect(heads('skills/sf-deploy/references/changeset-checklist.md')).toEqual(t);
});
