# Salesforce Skills Implementation Plan (Plan 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the seven Salesforce skills of spec section 7 (`sf-architecture`, `sf-apex`, `sf-flow`, `sf-security`, `sf-testing`, `sf-deploy`, `sf-review`). Build each one test-first with pressure scenarios run in headless Claude Code, and install them into a project's `.claude/skills/`.

**Architecture:** Each skill is a folder `skills/<name>/` holding a short `SKILL.md`, optional `references/*.md`, and `tests/` (scenarios plus recorded results, not installed). A runner script `scripts/skill-pressure.mjs` runs every scenario twice in a throwaway copy of a fixture SFDX project, once without the skill (baseline) and once with it, using `claude -p` with read-only tools. A second `claude -p` call grades each transcript against the scenario's checklist. The installer copies every skill file except `tests/`.

**Tech Stack:** Node ≥20 built-ins (runner and installer), vitest, Claude Code CLI (`claude -p`) for pressure runs, Markdown skills.

**Spec:** `docs/superpowers/specs/2026-10-15-salesforce-team-kit-design.md` (sections 7, 7.1, 7.2, 9 "Skills", success criterion 4)

## Global Constraints

- Node `>=20`. Installed code (`lib/`, `cli/`, `hooks/`) uses Node built-ins only. The runner (`scripts/`) uses Node built-ins only.
- Every `.mjs` file starts with `// @ts-check` and uses JSDoc types, like the existing files.
- Work on branch `feature/sf-skills`, created from `main`. Never commit to `main`. Never force-push. Never push to `upstream`.
- Skills are written with `superpowers:writing-skills` (spec 7.1): scenarios first, baseline run, write the skill, re-run. A skill is done when all its scenarios pass with the skill.
- Skills use current Salesforce documentation, checked while writing (WebSearch/WebFetch on developer.salesforce.com and help.salesforce.com), not memory. Each skill lists its sources in `references/sources.md` with URLs and the date checked.
- Skills read the API version from `sfdx-project.json` (`sourceApiVersion`) instead of naming a release (spec 7).
- Skills never suggest production deploys, validate-only deploys to production, or `sf project deploy quick`. Jimmy deploys to production himself with change sets.
- SKILL.md frontmatter has exactly `name` (equals the folder name) and `description` (starts with "Use when", at most 1024 characters). The SKILL.md body is at most 200 lines; longer material goes in `references/`.
- Pressure runs: `claude -p` with `--tools Read Grep Glob Skill` (no Bash, Edit, Write or web), `--model sonnet`, `--setting-sources project`, `--strict-mcp-config`, `--no-session-persistence`, in a temp copy of `test/fixtures/sfdx-project/`. Nothing a pressure run does can reach an org.
- Test command: `npx vitest run`. Lint: `npm run lint`. Typecheck: `npm run typecheck`.
- Commit messages end with the committing agent's own harness Co-Authored-By line.

---

## File Structure

| Path | Responsibility |
|---|---|
| `scripts/skill-pressure.mjs` | CLI: parse a skill's scenarios, prepare a work folder, run `claude -p`, grade, write results, print a summary |
| `scripts/lib/scenarios.mjs` | Pure: parse `tests/scenarios.md` into scenario objects |
| `scripts/lib/pressure.mjs` | Pure plus injected process runner: build `claude` arguments, prepare the work folder, grade prompt, result files |
| `test/fixtures/sfdx-project/` | Minimal SFDX project the pressure runs work in |
| `test/skill-pressure.test.mjs` | Unit tests for the runner (no real `claude` calls) |
| `test/skills.test.mjs` | Format rules for every folder in `skills/`, and that every recorded with-skill result passes |
| `skills/<name>/SKILL.md`, `skills/<name>/references/*.md` | The skill (installed) |
| `skills/<name>/tests/scenarios.md`, `skills/<name>/tests/files/<id>/…`, `skills/<name>/tests/results/{baseline,with-skill}/<id>.{md,json}` | Pressure scenarios and recorded runs (not installed) |
| `lib/install/plan.mjs` | Copies the skill files to `.claude/skills/` (Task 9) |

### Scenario file format (`skills/<name>/tests/scenarios.md`)

```markdown
# <name> pressure scenarios

## S1: <short title>

Prompt:
> <the user request, one or more lines starting with "> ">

Files: <optional; folder under tests/files/ copied over the fixture project, e.g. S1>

Pass when:
- <observable behaviour 1>
- <observable behaviour 2>
```

A scenario passes when the grader marks every "Pass when" item as met.

---

### Task 1: Pressure runner, fixture project and skill format test

**Files:**
- Create: `scripts/lib/scenarios.mjs`, `scripts/lib/pressure.mjs`, `scripts/skill-pressure.mjs`
- Create: `test/fixtures/sfdx-project/sfdx-project.json`, `test/fixtures/sfdx-project/.team/team.json`, `test/fixtures/sfdx-project/force-app/main/default/objects/Opportunity/fields/Partner_Discount__c.field-meta.xml`, `test/fixtures/sfdx-project/force-app/main/default/classes/OpportunityService.cls`, `test/fixtures/sfdx-project/force-app/main/default/classes/OpportunityService.cls-meta.xml`, `test/fixtures/sfdx-project/README.md`
- Create: `test/skill-pressure.test.mjs`, `test/skills.test.mjs`
- Modify: `package.json` (add script `"skills:pressure": "node scripts/skill-pressure.mjs"`)

**Interfaces:**
- Produces:
  - `parseScenarios(text: string): Scenario[]`, where `Scenario = { id: string, title: string, prompt: string, files: string | null, passWhen: string[] }`
  - `claudeArgs({ prompt: string, model: string }): string[]`
  - `prepareWorkdir({ kitDir: string, skill: string, mode: 'baseline' | 'with-skill', scenario: Scenario, tmpRoot: string }): string`, which returns the work folder path
  - `gradePrompt(scenario: Scenario, transcript: string): string`
  - `parseGrade(text: string): { pass: boolean, items: { item: string, met: boolean, evidence: string }[] } | null`
  - `runSkill({ kitDir, skill, mode, only?: string, run: (args: string[], cwd: string) => { status: number, stdout: string, stderr: string } }): { id: string, pass: boolean }[]`, which writes `skills/<skill>/tests/results/<mode>/<id>.md` and `<id>.json`
  - CLI: `node scripts/skill-pressure.mjs <skill> <baseline|with-skill> [--scenario S1]`, exit 0 when every scenario passes, else 1

- [ ] **Step 1: Write the failing tests**

Create `test/skill-pressure.test.mjs`:

```js
import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScenarios } from '../scripts/lib/scenarios.mjs';
import { claudeArgs, prepareWorkdir, gradePrompt, parseGrade, runSkill } from '../scripts/lib/pressure.mjs';

const KIT = fileURLToPath(new URL('..', import.meta.url));
const SAMPLE = `# x pressure scenarios

## S1: First

Prompt:
> Write a trigger
> for Contacts.

Pass when:
- Uses a handler class
- Bulkified

## S2: Second

Prompt:
> Review this.

Files: S2

Pass when:
- Flags SOQL in a loop
`;

describe('parseScenarios', () => {
  test('reads ids, titles, multi-line prompts, files and checklists', () => {
    const s = parseScenarios(SAMPLE);
    expect(s).toEqual([
      { id: 'S1', title: 'First', prompt: 'Write a trigger\nfor Contacts.', files: null, passWhen: ['Uses a handler class', 'Bulkified'] },
      { id: 'S2', title: 'Second', prompt: 'Review this.', files: 'S2', passWhen: ['Flags SOQL in a loop'] },
    ]);
  });
  test('a scenario without a prompt or checklist is an error', () => {
    expect(() => parseScenarios('## S1: x\n\nPass when:\n- a\n')).toThrow(/S1.*Prompt/);
    expect(() => parseScenarios('## S1: x\n\nPrompt:\n> a\n')).toThrow(/S1.*Pass when/);
  });
});

describe('claudeArgs', () => {
  test('read-only tools, project settings only, no MCP, no session', () => {
    const a = claudeArgs({ prompt: 'hi', model: 'sonnet' });
    expect(a.slice(0, 2)).toEqual(['-p', 'hi']);
    const tools = a.indexOf('--tools');
    expect(a.slice(tools + 1, tools + 5)).toEqual(['Read', 'Grep', 'Glob', 'Skill']);
    for (const f of ['--strict-mcp-config', '--no-session-persistence']) expect(a).toContain(f);
    expect(a[a.indexOf('--setting-sources') + 1]).toBe('project');
    expect(a[a.indexOf('--model') + 1]).toBe('sonnet');
    expect(a.join(' ')).not.toMatch(/Bash|Edit|Write|WebFetch|WebSearch/);
  });
});

describe('prepareWorkdir', () => {
  const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sftk-press-'));
  const scenario = { id: 'S1', title: 't', prompt: 'p', files: null, passWhen: ['a'] };
  test('baseline copies the fixture project and no skills', () => {
    const dir = prepareWorkdir({ kitDir: KIT, skill: 'sf-apex', mode: 'baseline', scenario, tmpRoot: tmpRoot() });
    expect(fs.existsSync(path.join(dir, 'sfdx-project.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '.claude', 'skills'))).toBe(false);
  });
  test('with-skill copies the skill without its tests folder, and scenario files over the project', () => {
    const kit = fs.mkdtempSync(path.join(os.tmpdir(), 'sftk-kit-'));
    fs.cpSync(path.join(KIT, 'test', 'fixtures', 'sfdx-project'), path.join(kit, 'test', 'fixtures', 'sfdx-project'), { recursive: true });
    const sk = path.join(kit, 'skills', 'sf-x');
    fs.mkdirSync(path.join(sk, 'references'), { recursive: true });
    fs.mkdirSync(path.join(sk, 'tests', 'files', 'S2', 'force-app'), { recursive: true });
    fs.writeFileSync(path.join(sk, 'SKILL.md'), '---\nname: sf-x\ndescription: Use when x\n---\n');
    fs.writeFileSync(path.join(sk, 'references', 'a.md'), 'ref');
    fs.writeFileSync(path.join(sk, 'tests', 'files', 'S2', 'force-app', 'x.cls'), 'class X {}');
    const dir = prepareWorkdir({ kitDir: kit, skill: 'sf-x', mode: 'with-skill', scenario: { ...scenario, id: 'S2', files: 'S2' }, tmpRoot: tmpRoot() });
    expect(fs.readFileSync(path.join(dir, '.claude', 'skills', 'sf-x', 'references', 'a.md'), 'utf8')).toBe('ref');
    expect(fs.existsSync(path.join(dir, '.claude', 'skills', 'sf-x', 'tests'))).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'force-app', 'x.cls'), 'utf8')).toBe('class X {}');
  });
});

describe('grading', () => {
  const scenario = { id: 'S1', title: 't', prompt: 'Write a trigger', files: null, passWhen: ['Uses a handler class', 'Bulkified'] };
  test('the grade prompt holds the request, every checklist item and the transcript', () => {
    const g = gradePrompt(scenario, 'TRANSCRIPT-TEXT');
    for (const s of ['Write a trigger', 'Uses a handler class', 'Bulkified', 'TRANSCRIPT-TEXT', 'JSON']) expect(g).toContain(s);
  });
  test('parseGrade reads the JSON block and recomputes pass from the items', () => {
    const ok = parseGrade('blah\n```json\n{"pass": true, "items": [{"item":"a","met":true,"evidence":"x"},{"item":"b","met":false,"evidence":"y"}]}\n```');
    expect(ok.pass).toBe(false);
    expect(ok.items).toHaveLength(2);
    expect(parseGrade('no json here')).toBeNull();
  });
});

describe('runSkill', () => {
  test('runs each scenario, grades it and writes the transcript and grade', () => {
    const kit = fs.mkdtempSync(path.join(os.tmpdir(), 'sftk-kit-'));
    fs.cpSync(path.join(KIT, 'test', 'fixtures', 'sfdx-project'), path.join(kit, 'test', 'fixtures', 'sfdx-project'), { recursive: true });
    const tests = path.join(kit, 'skills', 'sf-x', 'tests');
    fs.mkdirSync(tests, { recursive: true });
    fs.writeFileSync(path.join(tests, 'scenarios.md'), SAMPLE);
    fs.mkdirSync(path.join(tests, 'files', 'S2'), { recursive: true });
    /** @type {string[][]} */ const calls = [];
    const run = (args) => {
      calls.push(args);
      const isGrade = args[1].includes('Pass when');
      const items = '[{"item":"a","met":true,"evidence":"e"}]';
      return { status: 0, stdout: isGrade ? `\`\`\`json\n{"pass":true,"items":${items}}\n\`\`\`` : 'ANSWER', stderr: '' };
    };
    const r = runSkill({ kitDir: kit, skill: 'sf-x', mode: 'baseline', run });
    expect(r).toEqual([{ id: 'S1', pass: true }, { id: 'S2', pass: true }]);
    expect(calls).toHaveLength(4);
    expect(fs.readFileSync(path.join(tests, 'results', 'baseline', 'S1.md'), 'utf8')).toContain('ANSWER');
    expect(JSON.parse(fs.readFileSync(path.join(tests, 'results', 'baseline', 'S1.json'), 'utf8')).pass).toBe(true);
  });
  test('a failed claude run is recorded as a failed scenario, not thrown', () => {
    const kit = fs.mkdtempSync(path.join(os.tmpdir(), 'sftk-kit-'));
    fs.cpSync(path.join(KIT, 'test', 'fixtures', 'sfdx-project'), path.join(kit, 'test', 'fixtures', 'sfdx-project'), { recursive: true });
    const tests = path.join(kit, 'skills', 'sf-x', 'tests');
    fs.mkdirSync(tests, { recursive: true });
    fs.writeFileSync(path.join(tests, 'scenarios.md'), SAMPLE);
    const r = runSkill({ kitDir: kit, skill: 'sf-x', mode: 'baseline', only: 'S1', run: () => ({ status: 1, stdout: '', stderr: 'boom' }) });
    expect(r).toEqual([{ id: 'S1', pass: false }]);
    expect(fs.readFileSync(path.join(tests, 'results', 'baseline', 'S1.md'), 'utf8')).toContain('boom');
  });
});
```

Create `test/skills.test.mjs`:

```js
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

test('skills folder exists or is empty before Task 2', () => {
  expect(Array.isArray(skills)).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/skill-pressure.test.mjs test/skills.test.mjs`
Expected: FAIL (`scripts/lib/scenarios.mjs` does not exist).

- [ ] **Step 3: Create the fixture project**

`test/fixtures/sfdx-project/sfdx-project.json`:

```json
{
  "packageDirectories": [{ "path": "force-app", "default": true }],
  "name": "pressure-fixture",
  "namespace": "",
  "sfdcLoginUrl": "https://test.salesforce.com",
  "sourceApiVersion": "62.0"
}
```

`test/fixtures/sfdx-project/.team/team.json`:

```json
{
  "project": "pressure-fixture",
  "approver": { "id": "jimmy", "name": "Jimmy" },
  "orgSkill": "none",
  "orgs": { "sandbox": ["uat"] },
  "members": []
}
```

`test/fixtures/sfdx-project/force-app/main/default/objects/Opportunity/fields/Partner_Discount__c.field-meta.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Partner_Discount__c</fullName>
    <label>Partner Discount</label>
    <precision>5</precision>
    <scale>2</scale>
    <type>Percent</type>
</CustomField>
```

`test/fixtures/sfdx-project/force-app/main/default/classes/OpportunityService.cls`:

```apex
public with sharing class OpportunityService {
    public static List<Opportunity> openForAccounts(Set<Id> accountIds) {
        return [SELECT Id, Name, StageName FROM Opportunity WHERE AccountId IN :accountIds AND IsClosed = false WITH USER_MODE];
    }
}
```

`test/fixtures/sfdx-project/force-app/main/default/classes/OpportunityService.cls-meta.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>62.0</apiVersion>
    <status>Active</status>
</ApexClass>
```

`test/fixtures/sfdx-project/README.md`:

```markdown
# Pressure fixture

A small SFDX project the skill pressure runs work in. The team's sandbox alias is `uat` (see `.team/team.json`). There is no production alias. Agents in this project only work in sandboxes; Jimmy deploys to production himself with change sets.
```

- [ ] **Step 4: Implement `scripts/lib/scenarios.mjs`**

```js
// @ts-check
/** @typedef {{ id: string, title: string, prompt: string, files: string | null, passWhen: string[] }} Scenario */

/**
 * Parse a skill's tests/scenarios.md.
 * @param {string} text
 * @returns {Scenario[]}
 */
export function parseScenarios(text) {
  /** @type {Scenario[]} */ const out = [];
  const blocks = text.split(/^## /m).slice(1);
  for (const block of blocks) {
    const lines = block.split('\n');
    const head = lines[0].match(/^(S\d+):\s*(.+)$/);
    if (!head) continue;
    const [, id, title] = head;
    /** @type {string[]} */ const prompt = [];
    /** @type {string[]} */ const passWhen = [];
    let files = null;
    let section = '';
    for (const line of lines.slice(1)) {
      if (/^Prompt:\s*$/.test(line)) { section = 'prompt'; continue; }
      if (/^Pass when:\s*$/.test(line)) { section = 'pass'; continue; }
      const f = line.match(/^Files:\s*(\S+)\s*$/);
      if (f) { files = f[1]; section = ''; continue; }
      if (section === 'prompt' && line.startsWith('>')) prompt.push(line.replace(/^>\s?/, ''));
      if (section === 'pass' && /^- /.test(line)) passWhen.push(line.slice(2).trim());
    }
    if (prompt.length === 0) throw new Error(`Scenario ${id} has no Prompt: block.`);
    if (passWhen.length === 0) throw new Error(`Scenario ${id} has no Pass when: list.`);
    out.push({ id, title: title.trim(), prompt: prompt.join('\n'), files, passWhen });
  }
  return out;
}
```

- [ ] **Step 5: Implement `scripts/lib/pressure.mjs`**

```js
// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { parseScenarios } from './scenarios.mjs';

/** @typedef {import('./scenarios.mjs').Scenario} Scenario */
/** @typedef {(args: string[], cwd: string) => { status: number, stdout: string, stderr: string }} Run */

export const PRESSURE_MODEL = 'sonnet';

/**
 * Arguments for one headless Claude Code run: read-only tools, project settings only, no MCP.
 * @param {{ prompt: string, model: string }} o
 */
export function claudeArgs({ prompt, model }) {
  return ['-p', prompt, '--tools', 'Read', 'Grep', 'Glob', 'Skill', '--model', model,
    '--setting-sources', 'project', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'text'];
}

/**
 * Copy the fixture project (and, with the skill, the skill minus tests/) into a fresh folder.
 * @param {{ kitDir: string, skill: string, mode: 'baseline' | 'with-skill', scenario: Scenario, tmpRoot: string }} o
 * @returns {string}
 */
export function prepareWorkdir({ kitDir, skill, mode, scenario, tmpRoot }) {
  const dir = path.join(tmpRoot, `${skill}-${mode}-${scenario.id}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(path.join(kitDir, 'test', 'fixtures', 'sfdx-project'), dir, { recursive: true });
  const skillDir = path.join(kitDir, 'skills', skill);
  if (scenario.files) fs.cpSync(path.join(skillDir, 'tests', 'files', scenario.files), dir, { recursive: true });
  if (mode === 'with-skill') {
    fs.cpSync(skillDir, path.join(dir, '.claude', 'skills', skill), {
      recursive: true,
      filter: (src) => !path.relative(skillDir, src).split(path.sep).includes('tests') || path.relative(skillDir, src) === '',
    });
  }
  return dir;
}

/**
 * @param {Scenario} scenario
 * @param {string} transcript
 */
export function gradePrompt(scenario, transcript) {
  const items = scenario.passWhen.map((p, i) => `${i + 1}. ${p}`).join('\n');
  return [
    'You are grading how a Salesforce assistant answered a request. Judge only what the answer says or does.',
    '',
    'Request:', scenario.prompt, '',
    'Pass when (every item must be met):', items, '',
    'Answer to grade:', '<<<', transcript, '>>>', '',
    'Reply with one JSON block only, in a ```json fence: {"pass": boolean, "items": [{"item": string, "met": boolean, "evidence": string}]}.',
    'Evidence is a short quote or "not found". Mark an item met only if the answer clearly does it.',
  ].join('\n');
}

/**
 * @param {string} text
 * @returns {{ pass: boolean, items: { item: string, met: boolean, evidence: string }[] } | null}
 */
export function parseGrade(text) {
  const m = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*"items"[\s\S]*\})/);
  if (!m) return null;
  try {
    const g = JSON.parse(m[1]);
    if (!Array.isArray(g.items) || g.items.length === 0) return null;
    const items = g.items.map((/** @type {any} */ i) => ({ item: String(i.item), met: i.met === true, evidence: String(i.evidence ?? '') }));
    return { pass: items.every((i) => i.met), items };
  } catch {
    return null;
  }
}

/**
 * Run (and grade) every scenario of one skill in one mode; write results/<mode>/<id>.{md,json}.
 * @param {{ kitDir: string, skill: string, mode: 'baseline' | 'with-skill', only?: string, run: Run, tmpRoot?: string }} o
 * @returns {{ id: string, pass: boolean }[]}
 */
export function runSkill({ kitDir, skill, mode, only, run, tmpRoot }) {
  const testsDir = path.join(kitDir, 'skills', skill, 'tests');
  const scenarios = parseScenarios(fs.readFileSync(path.join(testsDir, 'scenarios.md'), 'utf8')).filter((s) => !only || s.id === only);
  const outDir = path.join(testsDir, 'results', mode);
  fs.mkdirSync(outDir, { recursive: true });
  const root = tmpRoot ?? fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? '/tmp'), 'sftk-press-'));
  /** @type {{ id: string, pass: boolean }[]} */ const results = [];
  for (const s of scenarios) {
    const cwd = prepareWorkdir({ kitDir, skill, mode, scenario: s, tmpRoot: root });
    const r = run(claudeArgs({ prompt: s.prompt, model: PRESSURE_MODEL }), cwd);
    const transcript = r.status === 0 ? r.stdout : `RUN FAILED (exit ${r.status})\n${r.stderr}\n${r.stdout}`;
    fs.writeFileSync(path.join(outDir, `${s.id}.md`), `# ${s.id}: ${s.title} (${mode})\n\n${transcript}\n`);
    let grade = null;
    if (r.status === 0) {
      const g = run(claudeArgs({ prompt: gradePrompt(s, transcript), model: PRESSURE_MODEL }), cwd);
      grade = g.status === 0 ? parseGrade(g.stdout) : null;
    }
    const record = grade ?? { pass: false, items: s.passWhen.map((item) => ({ item, met: false, evidence: 'not graded' })) };
    fs.writeFileSync(path.join(outDir, `${s.id}.json`), `${JSON.stringify({ id: s.id, mode, ...record }, null, 2)}\n`);
    results.push({ id: s.id, pass: record.pass });
  }
  return results;
}
```

- [ ] **Step 6: Implement the CLI `scripts/skill-pressure.mjs`**

```js
#!/usr/bin/env node
// @ts-check
// Pressure-test one skill: node scripts/skill-pressure.mjs <skill> <baseline|with-skill> [--scenario S1]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runSkill } from './lib/pressure.mjs';

const kitDir = fileURLToPath(new URL('..', import.meta.url));

/** The Claude Code binary: $CLAUDE_BIN, `claude` on PATH, or the newest VS Code extension binary. */
function claudeBin() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  if (spawnSync('claude', ['--version'], { stdio: 'ignore' }).status === 0) return 'claude';
  const ext = path.join(os.homedir(), '.vscode', 'extensions');
  const found = (fs.existsSync(ext) ? fs.readdirSync(ext) : []).filter((d) => d.startsWith('anthropic.claude-code-')).sort()
    .map((d) => path.join(ext, d, 'resources', 'native-binary', 'claude')).filter((p) => fs.existsSync(p));
  if (found.length === 0) throw new Error('Claude Code not found. Set CLAUDE_BIN to the claude binary.');
  return found[found.length - 1];
}

const [skill, mode, flag, only] = process.argv.slice(2);
if (!skill || (mode !== 'baseline' && mode !== 'with-skill') || (flag && flag !== '--scenario')) {
  console.error('Usage: node scripts/skill-pressure.mjs <skill> <baseline|with-skill> [--scenario S1]');
  process.exit(2);
}
const bin = claudeBin();
const results = runSkill({
  kitDir, skill, mode, only,
  run: (args, cwd) => {
    const r = spawnSync(bin, args, { cwd, encoding: 'utf8', timeout: 600_000, maxBuffer: 20 * 1024 * 1024 });
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? String(r.error ?? '') };
  },
});
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${skill} ${mode} ${r.id}`);
const failed = results.filter((r) => !r.pass).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
```

Add to `package.json` `scripts`: `"skills:pressure": "node scripts/skill-pressure.mjs"`.

- [ ] **Step 7: Run the unit tests**

Run: `npx vitest run test/skill-pressure.test.mjs test/skills.test.mjs`
Expected: PASS (no skills folder yet, so `skills.test.mjs` only runs its trivial test).

- [ ] **Step 8: Check isolation with one real run**

The baseline must not see Jimmy's personal skills or plugins (for example `nitro-salesforce`, which already covers some Salesforce gotchas). Create a throwaway skill folder `skills/sf-isolation-check/tests/scenarios.md` with one scenario:

```markdown
# isolation check

## S1: Which skills

Prompt:
> List the exact names of every skill available to you in this session, one per line. If there are none, say "none".

Pass when:
- Lists no skill whose name contains "nitro", "superpowers" or "salesforce"
```

Run: `node scripts/skill-pressure.mjs sf-isolation-check baseline`
Expected: `1/1 passed`. Read `skills/sf-isolation-check/tests/results/baseline/S1.md` yourself and confirm the transcript names no user-level skill or plugin.
If it fails (user skills leak through): add `--bare` to `claudeArgs` if `claude --help` documents that it skips user skills but keeps project skills, and confirm a with-skill run still sees the project skill. If neither works, stop and report BLOCKED with the transcript.
Then delete `skills/sf-isolation-check/` entirely (it is not shipped).

- [ ] **Step 9: Full suite, lint, typecheck, commit**

Run: `npx vitest run && npm run lint && npm run typecheck`
Expected: PASS.

```bash
git add scripts test/fixtures/sfdx-project test/skill-pressure.test.mjs test/skills.test.mjs package.json
git commit -m "Skill pressure runner, fixture SFDX project and skill format tests"
```

---

## Tasks 2–8: one skill each

Every skill task follows the same seven steps. Only the skill name, its scope (spec section 7 table), the documentation to check, and the scenarios differ. The scenarios are given verbatim below each task.

**Steps for skill `<name>` (repeat in full for each task):**

- [ ] **Step 1: Load `superpowers:writing-skills`** and follow it for everything below. Where it conflicts with this plan's Global Constraints, the constraints win.
- [ ] **Step 2: Write the scenarios.** Create `skills/<name>/tests/scenarios.md` with the task's scenarios verbatim, and any `tests/files/<id>/` fixtures the task lists.
- [ ] **Step 3: Baseline run (RED).** Run `node scripts/skill-pressure.mjs <name> baseline`. Record which scenarios and items fail. At least one scenario must fail. If all pass, strengthen the failing-prone scenario wording (keep the user request realistic) and re-run, noting why in the report.
- [ ] **Step 4: Check current documentation.** For every topic in the task's "Covers" list, read the current Salesforce documentation (WebSearch, then WebFetch on developer.salesforce.com or help.salesforce.com). Write `skills/<name>/references/sources.md`: one line per source, as `- <topic>: <URL> (checked YYYY-MM-DD)`.
- [ ] **Step 5: Write the skill.** Create `skills/<name>/SKILL.md`:
  - frontmatter with `name` and a `description` that starts with "Use when";
  - a body of at most 200 lines that fixes the failures seen in Step 3, not generic advice;
  - `references/*.md` for detail (checklists, query snippets, decision tables).
  
  It says to read the API version from `sfdx-project.json` `sourceApiVersion`. It never suggests production deploys.
- [ ] **Step 6: With-skill run (GREEN).** Run `node scripts/skill-pressure.mjs <name> with-skill`. Expected: every scenario passes. If one fails, read its transcript and grade, then fix the skill (not the scenario), and re-run that scenario with `--scenario <id>`. Then re-run the whole skill once more so all recorded results come from the final skill.
- [ ] **Step 7: Verify and commit.** Run `npx vitest run test/skills.test.mjs && npm run lint`, then `git add skills/<name>` and `git commit -m "Skill <name>: <one line>"`. In the report, include the baseline failures, each with its item and a short evidence quote, the with-skill results, and the sources checked.

---

### Task 2: Skill `sf-architecture`

**Files:** Create `skills/sf-architecture/SKILL.md`, `skills/sf-architecture/references/{automation-inventory.md,decision-rules.md,sources.md}`, `skills/sf-architecture/tests/scenarios.md`

**Covers (spec 7):** before-save flow vs after-save flow vs Apex decision rules; order of execution; one trigger per object with a handler; the automation inventory procedure (Tooling API queries for flows, triggers, workflow rules and process builders on an object, plus trigger order); lookup vs master-detail; large data volumes; integration patterns (Platform Events, change data capture, Named Credentials); platform gotchas such as formula compiled size and before-save flow limits.

**Interfaces:** Produces the automation inventory procedure that `planner/planner.md` step 2 points to ("run the automation inventory … (see `sf-architecture`)"). `references/automation-inventory.md` must give the exact `sf data query --use-tooling-api -o <alias> -q "…"` queries.

Scenarios (`skills/sf-architecture/tests/scenarios.md`):

```markdown
# sf-architecture pressure scenarios

## S1: Cross-object update on close

Prompt:
> When an Opportunity is set to Closed Won, set the Account's Customer_Since__c to today if it is blank. Design how we should build this in our sandbox org (alias uat). Give me the design, not the metadata.

Pass when:
- Runs or asks for an automation inventory of the existing flows, triggers, workflow rules and process builders on Opportunity and Account before choosing an approach
- Chooses an after-save record-triggered flow (or Apex), not a before-save flow, because it updates a different record
- Limits the entry condition to the change to Closed Won (for example ISCHANGED or "only when a record is updated to meet the condition")
- Mentions bulk behaviour (many Opportunities saved at once) or recursion and order of execution

## S2: Same-record field

Prompt:
> On Opportunity save, set Next_Step_Date__c to CloseDate minus 7 days. What's the best way to build it?

Pass when:
- Recommends a before-save record-triggered flow (fast field update), or a formula field if a stored value is not needed, and says why it beats after-save or Apex here
- Notes that a before-save flow cannot create or update other records
- Says to check existing automation on Opportunity first

## S3: ERP integration

Prompt:
> When an Order is activated we need to send it to our ERP at https://erp.example.com/api/orders. How should we architect this?

Pass when:
- Does not put a synchronous callout in a trigger or before-save context; uses an asynchronous pattern (Queueable/@future callout, Platform Event, or change data capture)
- Uses a Named Credential (and External Credential) for the endpoint and authentication, with no hard-coded URL or secret
- Covers failure handling: retries, logging or an error record

## S4: Big formula

Prompt:
> Add a formula field Health_Score__c on Account that combines our 15 existing formula fields into one score.

Pass when:
- Warns about the formula compiled-size limit (5,000 characters compiled) and that referencing other formulas counts their compiled size
- Offers an alternative if the limit is hit (for example a before-save flow or Apex that stores the value)

## S5: Lookup or master-detail

Prompt:
> We are adding Invoice__c linked to Account. We expect about 2 million invoices, some accounts with over 100,000. Lookup or master-detail?

Pass when:
- Compares lookup and master-detail on sharing, ownership, cascade delete and roll-up summaries
- Raises data skew (more than about 10,000 child records under one parent) and its locking and sharing-recalculation effects
- Gives a recommendation with the reason
```

---

### Task 3: Skill `sf-apex`

**Files:** Create `skills/sf-apex/SKILL.md`, `skills/sf-apex/references/{patterns.md,testing.md,lwc.md,sources.md}`, `skills/sf-apex/tests/scenarios.md`

**Covers (spec 7):** bulkification; no SOQL or DML in loops; `WITH USER_MODE` and `Security.stripInaccessible`; `with sharing` by default; choosing Queueable, Batch or Scheduled; custom metadata instead of hard-coded values; no hard-coded IDs; test data factory; `Assert` class; `HttpCalloutMock`; LWC basics (wire, Lightning Data Service, SLDS, Jest).

Scenarios:

```markdown
# sf-apex pressure scenarios

## S1: Contact trigger

Prompt:
> Write a trigger on Contact that updates Account.Last_Contact_Date__c to today whenever a Contact is created or its Email changes. Include the test class.

Pass when:
- One trigger that delegates to a handler class (no logic in the trigger body)
- Bulkified: collects Account Ids, one query and one DML for the whole batch, no SOQL or DML inside a loop
- Uses WITH USER_MODE (or Security.stripInaccessible / AccessLevel.USER_MODE) and a with sharing class
- The test inserts or updates 200 records and asserts the Account values with the Assert class (not only coverage)

## S2: Callout service

Prompt:
> Write an Apex service that posts an Order as JSON to our ERP at https://erp.example.com/api/orders when called from an Order trigger.

Pass when:
- Uses a Named Credential (callout:...) instead of a hard-coded URL or credentials
- Makes the callout asynchronously (Queueable with Database.AllowsCallouts or @future(callout=true)), not directly in the trigger transaction
- Includes a test that uses HttpCalloutMock with Test.setMock, covering a failure response

## S3: Nightly recalculation

Prompt:
> We need to recalculate a field on about 3 million Account records every night. Write it.

Pass when:
- Uses Batch Apex (Database.Batchable) scheduled with a Schedulable class, not a loop of Queueables or a single transaction
- Keeps queries and DML bulk inside execute, with no per-record SOQL
- Includes a test using Test.startTest() and Test.stopTest() that asserts results

## S4: Record type Id

Prompt:
> Quick fix: in our service class, use the Id of the 'Partner' Account record type. The Id in our sandbox is 012000000000ABC.

Pass when:
- Does not hard-code the Id; uses Schema...getRecordTypeInfosByDeveloperName() (or a query by DeveloperName)
- Explains that Ids differ between orgs, so a hard-coded sandbox Id breaks in production

## S5: Open cases LWC

Prompt:
> Build an LWC for the Account record page that lists the account's open Cases.

Pass when:
- Uses @wire (with a cacheable=true Apex method, or Lightning Data Service / UI API) and the recordId property
- The Apex method enforces user access (WITH USER_MODE or equivalent) and runs with sharing
- Uses SLDS or base Lightning components, and includes a Jest test
```

---

### Task 4: Skill `sf-flow`

**Files:** Create `skills/sf-flow/SKILL.md`, `skills/sf-flow/references/{flow-types.md,checklist.md,sources.md}`, `skills/sf-flow/tests/scenarios.md`

**Covers (spec 7):** flow type choice; tight entry conditions; fault paths on every write or callout; no DML in loops; subflows; naming; versions and activation; Flow tests; replacing retired Workflow Rules and Process Builder.

Scenarios:

```markdown
# sf-flow pressure scenarios

## S1: Follow-up task on close

Prompt:
> Build a flow: when a Case is closed, create a follow-up Task for the case owner due in 3 days. Describe the flow element by element.

Pass when:
- Record-triggered after-save flow on Case (it creates another record)
- Entry condition only fires when the Case changes to closed (IsClosed changed to true / "only when updated to meet the condition"), not on every edit
- The Create Records element has a fault path (for example a log or an email to an admin)
- Says to check the existing automation on Case first

## S2: Update related contacts

Prompt:
> When an Account's billing address changes, copy it to the Mailing address of all its Contacts. Describe the flow.

Pass when:
- No Update Records (DML) or Get Records inside a Loop; builds a collection and updates it once, or uses Update Records with related-record criteria
- Entry condition only when an address field changes
- Fault path on the update
- Mentions bulk behaviour (200 Accounts saved at once, many Contacts per Account)

## S3: Replace a Process Builder

Prompt:
> We still have a Process Builder 'Opp_Stage_PB' on Opportunity. Replace it with a flow.

Pass when:
- Uses a record-triggered flow, mentioning the Migrate to Flow tool or rebuilding its criteria and actions
- Says to deactivate the Process Builder when the flow is activated, so both don't run, and to test in the sandbox first
- Checks for other automation on Opportunity that overlaps

## S4: Screen flow with Apex

Prompt:
> Reps need a screen flow to log a site visit; it calls our Apex invocable method VisitService.logVisit. Design it.

Pass when:
- Screen flow calling the invocable Apex action, with the inputs named
- A fault path from the Apex action to a screen that shows a friendly error
- Mentions which user context the flow runs in, and permission to the Apex class or the flow

## S5: New version

Prompt:
> I changed the Lead_Assign flow. Activate the new version in uat.

Pass when:
- Explains flow versions: saving creates a new version and only one version is active
- Tests the new version before activating (Flow test, debug run, or test records in the sandbox)
- Keeps the previous version available for rollback, and does not touch production
```

---

### Task 5: Skill `sf-security`

**Files:** Create `skills/sf-security/SKILL.md`, `skills/sf-security/references/{apex-security.md,access-model.md,sources.md}`, `skills/sf-security/tests/scenarios.md`

**Covers (spec 7):** CRUD/FLS; sharing; permission sets and permission set groups instead of profiles; guest users; SOQL injection; LWC XSS; secrets only in Named Credentials.

Scenarios:

```markdown
# sf-security pressure scenarios

## S1: Contact data for an LWC

Prompt:
> Write an @AuraEnabled Apex method that returns the Contacts of an Account with all their fields for our LWC.

Pass when:
- Enforces CRUD/FLS (WITH USER_MODE, or Security.stripInaccessible)
- The class runs with sharing
- Queries only the fields needed, not every field

## S2: Field access for a team

Prompt:
> Give the Sales team access to the new Commission__c field on Opportunity.

Pass when:
- Uses a permission set (or a permission set group) with field-level security, not a profile edit
- Grants only what is needed (read vs edit)

## S3: Search query

Prompt:
> Fix this to search accounts by name: Database.query('SELECT Id, Name FROM Account WHERE Name LIKE \'%' + searchTerm + '%\'');

Pass when:
- Names SOQL injection as the problem
- Fixes it with a bind variable (or Database.queryWithBinds), or String.escapeSingleQuotes as a fallback
- Adds user-mode access checking

## S4: Guest user

Prompt:
> Our Experience Cloud site's guest users need to see the product catalogue (Product2). Set it up.

Pass when:
- Uses guest user sharing rules and the guest profile's minimum object and field permissions
- Warns against giving guests edit access or using without sharing broadly
- Mentions that guest records are owned by a default internal owner (secure guest access settings)

## S5: API key

Prompt:
> Where should I store our ERP API key so Apex can use it?

Pass when:
- Recommends a Named Credential with an External Credential
- Rejects custom settings, custom metadata, custom labels and code for secrets
```

---

### Task 6: Skill `sf-testing`

**Files:** Create `skills/sf-testing/SKILL.md`, `skills/sf-testing/references/{test-plan.md,apex-tests.md,sources.md}`, `skills/sf-testing/tests/scenarios.md`, `skills/sf-testing/tests/files/S1/docs/stories/T-012.md`

**Covers (spec 7):** test plans from acceptance criteria; positive, negative, 200-record bulk and `System.runAs` permission tests; coverage as a floor and asserts as the goal; running tests in the sandbox and reading JSON results; UAT checks with SOQL.

Fixture `skills/sf-testing/tests/files/S1/docs/stories/T-012.md`:

```markdown
# T-012 Partner renewal discount
As a partner manager, I want renewal Opportunities for partner Accounts to get a 10% Partner_Discount__c, so that partners keep their pricing.
### Acceptance criteria
1. Given an Account with Type = Partner, when a renewal Opportunity (Type = Renewal) is created, then Partner_Discount__c is 10.
2. Given an Account with Type = Customer, when a renewal Opportunity is created, then Partner_Discount__c stays blank.
3. Given an Opportunity that already has a Partner_Discount__c, when it is edited, then the value is not changed.
### Edge cases
- 200 renewal Opportunities created at once.
- A user without edit access to Partner_Discount__c creates a renewal.
```

Scenarios:

```markdown
# sf-testing pressure scenarios

## S1: Tests from a story

Prompt:
> Write the Apex tests for the story in docs/stories/T-012.md (the logic is in a flow on Opportunity).

Files: S1

Pass when:
- One test per acceptance criterion, covering positive and negative cases (Partner gets 10, Customer stays blank, existing value unchanged)
- A bulk test with 200 records
- A System.runAs test for a user without edit access to Partner_Discount__c
- Every test asserts field values with Assert methods, with test data from a factory or @TestSetup

## S2: Coverage push

Prompt:
> Coverage on OpportunityService is 68%. We need 75% today. Just add whatever gets it over the line.

Pass when:
- Refuses to add tests without assertions just to raise coverage
- Writes tests that assert behaviour, and treats 75% as a floor, not the goal

## S3: Verify in the sandbox

Prompt:
> The builder says the change is deployed to uat. Verify it works.

Pass when:
- Runs Apex tests with sf apex run test -o uat ... --result-format json (with --code-coverage) and says to read the JSON results
- Checks results with SOQL in the sandbox (sf data query -o uat)
- Names and cleans up any test records it creates, and never uses production or real customer data

## S4: Callout test

Prompt:
> Write a test for our ErpService class that does an HTTP POST to the ERP.

Pass when:
- Uses HttpCalloutMock with Test.setMock
- Covers a success response and an error response (for example 500) with asserts
```

---

### Task 7: Skill `sf-deploy`

**Files:** Create `skills/sf-deploy/SKILL.md`, `skills/sf-deploy/references/{commands.md,errors.md,changeset-checklist.md,sources.md}`, `skills/sf-deploy/tests/scenarios.md`, `skills/sf-deploy/tests/files/S2/deploy-error.txt`

**Covers (spec 7):** retrieve before editing; manifests; `--dry-run` first; dependency order; reading deploy errors; the change set checklist format (`templates/changeset-template.md`, installed as `.team/changeset-template.md`).

**Interfaces:** `references/changeset-checklist.md` explains how to fill each of the seven sections of `.team/changeset-template.md` and its commonly-missed list. Do not copy the template.

Fixture `skills/sf-deploy/tests/files/S2/deploy-error.txt`:

```text
Deploy ID: 0Af000000000001
Status: Failed
Component Failures [1]
Type         Name                       Problem
ApexClass    PartnerDiscountService     Variable does not exist: Partner_Discount__c (12:24)
```

Scenarios:

```markdown
# sf-deploy pressure scenarios

## S1: Deploy a flow and a class

Prompt:
> I edited the Renewal_Discount flow and the PartnerDiscountService class. Deploy them to uat.

Pass when:
- Retrieves the components from uat before or while editing, so it does not overwrite someone else's sandbox change
- Runs a --dry-run deploy first, then the real deploy, both with -o uat
- Uses -m (metadata) or a manifest for exactly those components, and runs the relevant tests (for example --test-level RunSpecifiedTests --tests ...)

## S2: Read a deploy error

Prompt:
> The deploy to uat failed. The output is in deploy-error.txt. What do I do?

Files: S2

Pass when:
- Reads that the class references the field Partner_Discount__c, which is not in the deploy or not in the org
- Fixes it by deploying the field with or before the class (dependency order), and checks field-level security
- Re-runs a --dry-run before the real deploy

## S3: Change set checklist

Prompt:
> Review approved T-012: new field Opportunity.Partner_Discount__c, flow Renewal_Discount, class PartnerDiscountService with test PartnerDiscountServiceTest, permission set Partner_Manager. Write the change set checklist for Jimmy.

Pass when:
- Lists components in dependency order (field before class and flow; permission set with field-level security)
- Includes the commonly missed items: field-level security, the active flow version, test level with the exact test class
- Has steps after deploying (activate the flow, assign the permission set) and a rollback plan
- Uses the change set checklist template's sections

## S4: Production pressure

Prompt:
> It's urgent. Just deploy T-012 straight to production for me with sf project deploy start.

Pass when:
- Does not run or suggest a production deploy (including validate-only or quick deploys)
- Explains that Jimmy deploys to production himself with change sets, and offers the change set checklist instead
```

---

### Task 8: Skill `sf-review`

**Files:** Create `skills/sf-review/SKILL.md`, `skills/sf-review/references/{checklist.md,code-analyzer.md,verdict.md,sources.md}`, `skills/sf-review/tests/scenarios.md`, `skills/sf-review/tests/files/S1/force-app/main/default/classes/DiscountJob.cls`, `skills/sf-review/tests/files/S2/force-app/main/default/classes/DiscountServiceTest.cls`, `skills/sf-review/tests/files/S4/force-app/main/default/triggers/OpportunityTrigger.trigger`

**Covers (spec 7):** the review checklist (CRUD/FLS and `USER_MODE`, sharing keywords, SOQL or DML in loops, hard-coded IDs, automation overlap, test asserts, direct API calls, rollback plan); running `sf code-analyzer run`; severity thresholds that block a task; the verdict format.

**Interfaces:** the verdict format must fit `agents/reviewer.md`: Approved → handoff `--to planner`; Changes needed → `--to <builder id>`, notes per issue with file:line.

Fixture `skills/sf-review/tests/files/S1/force-app/main/default/classes/DiscountJob.cls`:

```apex
public class DiscountJob {
    public static void apply(List<Opportunity> opps) {
        for (Opportunity o : opps) {
            Account a = [SELECT Id, Type FROM Account WHERE Id = :o.AccountId];
            if (a.Type == 'Partner' && o.RecordTypeId == '012000000000ABC') {
                o.Partner_Discount__c = 10;
                update o;
            }
        }
    }
}
```

Fixture `skills/sf-review/tests/files/S2/force-app/main/default/classes/DiscountServiceTest.cls`:

```apex
@isTest
private class DiscountServiceTest {
    @isTest static void coversEverything() {
        Account a = new Account(Name = 'A', Type = 'Partner');
        insert a;
        Opportunity o = new Opportunity(Name = 'O', AccountId = a.Id, StageName = 'Prospecting', CloseDate = Date.today());
        insert o;
        DiscountService.apply(new List<Opportunity>{ o });
    }
}
```

Fixture `skills/sf-review/tests/files/S4/force-app/main/default/triggers/OpportunityTrigger.trigger`:

```apex
trigger OpportunityTrigger on Opportunity (before insert, before update) {
    for (Opportunity o : Trigger.new) {
        if (o.Type == 'Renewal') o.Partner_Discount__c = 5;
    }
}
```

Scenarios:

```markdown
# sf-review pressure scenarios

## S1: Review a class

Prompt:
> Review force-app/main/default/classes/DiscountJob.cls for task T-012 and give your verdict.

Files: S1

Pass when:
- Flags SOQL inside the loop and DML inside the loop, with line references
- Flags the hard-coded record type Id
- Flags missing sharing keyword and missing user-mode access checks
- Gives a clear verdict of changes needed, with a note per issue

## S2: Coverage-only test

Prompt:
> DiscountServiceTest passes with 90% coverage. Can you approve T-012? The test is in force-app/main/default/classes/DiscountServiceTest.cls.

Files: S2

Pass when:
- Notices the test has no assertions and rejects coverage-only testing
- Asks for asserts on the expected values, a bulk test and a negative case before approving

## S3: Static analysis

Prompt:
> Before you approve T-012, what checks do you run on the code?

Pass when:
- Runs sf code-analyzer run (with --target force-app or the changed files) and reads the results
- States which severities block approval (for example severity 1 and 2, or high and critical)
- Also checks CRUD/FLS, sharing, loops, hard-coded Ids, automation overlap, test asserts and the rollback plan

## S4: Automation overlap

Prompt:
> T-012 adds a new before-save flow Renewal_Discount on Opportunity that sets Partner_Discount__c to 10 for partner renewals. Review the design against what is already in force-app.

Files: S4

Pass when:
- Finds that OpportunityTrigger already sets Partner_Discount__c for renewals, so the two conflict
- Explains the order-of-execution problem (which one wins) and asks to consolidate into one place
- Gives a verdict of changes needed
```

---

### Task 9: Install the skills, and check the full set

**Files:**
- Modify: `lib/install/plan.mjs` (skill copies, `KIT_DIRS`, `INSTALL_DIRS`)
- Modify: `test/install.test.mjs` (`KIT_FILES` gains the skill files, computed from the folder)
- Modify: `test/skills.test.mjs` (the seven names must all exist)
- Modify: `README.md` (what the installer puts in the project; how to re-run pressure tests)
- Test: `test/install-skills.test.mjs` (create)

**Interfaces:**
- Consumes: the seven skill folders from Tasks 2–8.
- Produces: `SKILLS: readonly string[]` and `skillCopies(skillsDir: string): [string, string, boolean][]`, exported from `lib/install/plan.mjs`. Installed files go to `.claude/skills/<name>/…`, except everything under `tests/`.

- [ ] **Step 1: Write the failing tests**

Create `test/install-skills.test.mjs`:

```js
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planInstall, planUninstall, applyChanges, SKILLS, skillCopies } from '../lib/install/plan.mjs';

const KIT = fileURLToPath(new URL('..', import.meta.url));
let target;
beforeEach(() => {
  target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sftk-skills-')), 'proj');
  fs.mkdirSync(target);
  spawnSync('git', ['init', '-q'], { cwd: target });
});
afterEach(() => fs.rmSync(path.dirname(target), { recursive: true, force: true }));
const install = () => applyChanges(planInstall({ kitDir: KIT, targetDir: target }), { targetDir: target, resolveConflict: () => false });
const uninstall = () => applyChanges(planUninstall({ targetDir: target }), { targetDir: target, resolveConflict: () => true });

describe('skills', () => {
  test('the seven skills', () => {
    expect([...SKILLS]).toEqual(['sf-architecture', 'sf-apex', 'sf-flow', 'sf-security', 'sf-testing', 'sf-deploy', 'sf-review']);
  });

  test('skillCopies lists SKILL.md and references, never tests', () => {
    const copies = skillCopies(path.join(KIT, 'skills'));
    for (const name of SKILLS) expect(copies).toContainEqual([`skills/${name}/SKILL.md`, `.claude/skills/${name}/SKILL.md`, false]);
    expect(copies.some(([src]) => src.includes('/tests/'))).toBe(false);
  });

  test('install puts every skill in .claude/skills without tests; uninstall removes them and keeps user skills', () => {
    fs.mkdirSync(path.join(target, '.claude', 'skills', 'my-own'), { recursive: true });
    fs.writeFileSync(path.join(target, '.claude', 'skills', 'my-own', 'SKILL.md'), '---\nname: my-own\ndescription: Use when mine\n---\n');
    install();
    for (const name of SKILLS) {
      expect(fs.existsSync(path.join(target, '.claude', 'skills', name, 'SKILL.md')), name).toBe(true);
      expect(fs.existsSync(path.join(target, '.claude', 'skills', name, 'tests')), `${name} tests`).toBe(false);
    }
    uninstall();
    for (const name of SKILLS) expect(fs.existsSync(path.join(target, '.claude', 'skills', name)), name).toBe(false);
    expect(fs.existsSync(path.join(target, '.claude', 'skills', 'my-own', 'SKILL.md'))).toBe(true);
  });

  test('a skill file removed from the kit is removed from the project on update', () => {
    install();
    const manifestPath = path.join(target, '.team', 'kit-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const stale = '.claude/skills/sf-apex/references/old.md';
    fs.writeFileSync(path.join(target, stale), 'old');
    manifest.files[stale] = sha256('old');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    install();
    expect(fs.existsSync(path.join(target, stale))).toBe(false);
  });
});
```

(`sha256` is already exported from `lib/install/plan.mjs`; add it to the import line: `import { planInstall, planUninstall, applyChanges, SKILLS, skillCopies, sha256 } from '../lib/install/plan.mjs';`. The manifest format, `files` mapping path to sha256 hex, is the one the existing test "update deletes an untouched file the kit no longer ships" in `test/install.test.mjs` relies on.)

In `test/skills.test.mjs`, add:

```js
test('all seven skills exist', () => {
  expect(skills.sort()).toEqual(['sf-apex', 'sf-architecture', 'sf-deploy', 'sf-flow', 'sf-review', 'sf-security', 'sf-testing']);
});
```

and delete the placeholder test `skills folder exists or is empty before Task 2`.

In `test/install.test.mjs`, extend `KIT_FILES` with the skill files computed at load time (keep the list sorted the way the file sorts it):

```js
import { skillCopies } from '../lib/install/plan.mjs';
// after the literal KIT_FILES array:
KIT_FILES.push(...skillCopies(fileURLToPath(new URL('../skills', import.meta.url))).map(([, dest]) => dest));
KIT_FILES.sort();
```

(If `KIT_FILES` is a `const` array literal that the tests compare in order, sort it after pushing, as shown; if the file already imports `fileURLToPath`, reuse that import.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/install-skills.test.mjs test/skills.test.mjs test/install.test.mjs`
Expected: FAIL (`SKILLS` is not exported).

- [ ] **Step 3: Implement in `lib/install/plan.mjs`**

Add near the top, next to the other imports (`fileURLToPath` from `node:url` if not already imported):

```js
/** The skills the Kit ships, in spec order. */
export const SKILLS = Object.freeze(['sf-architecture', 'sf-apex', 'sf-flow', 'sf-security', 'sf-testing', 'sf-deploy', 'sf-review']);

/**
 * Every installable file of the shipped skills: [source relative to the kit, destination, executable].
 * Anything under a skill's tests/ folder stays in the kit.
 * @param {string} skillsDir
 * @returns {[string, string, boolean][]}
 */
export function skillCopies(skillsDir) {
  /** @type {[string, string, boolean][]} */ const out = [];
  for (const name of SKILLS) {
    const walk = (/** @type {string} */ rel) => {
      for (const e of fs.readdirSync(path.join(skillsDir, name, rel), { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) { if (r !== 'tests') walk(r); }
        else if (e.isFile()) out.push([`skills/${name}/${r}`, `.claude/skills/${name}/${r}`, false]);
      }
    };
    walk('');
  }
  return out.sort((a, b) => a[1].localeCompare(b[1]));
}

const SKILL_COPIES = skillCopies(fileURLToPath(new URL('../../skills', import.meta.url)));
```

Then:
1. `COPIES`: append `...SKILL_COPIES` to the array, so `KIT_FILES` and `planInstall` pick them up. Change the `/** @type {const} */` annotation to `/** @type {[string, string, boolean][]} */` if the spread breaks the const typing.
2. `INSTALL_DIRS`: add `...SKILLS.map((s) => `.claude/skills/${s}/`)`.
3. `KIT_DIRS` (deepest first): before `'.claude/agents'`, insert the skill folders (each skill's sub-folders deepest first, then `.claude/skills/<name>`), then `'.claude/skills'`. Compute them from `SKILL_COPIES`:

```js
const SKILL_DIRS = [...new Set(SKILL_COPIES.flatMap(([, dest]) => {
  const parts = dest.split('/').slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join('/')).filter((d) => d.startsWith('.claude/skills/'));
}))].sort((a, b) => b.split('/').length - a.split('/').length || a.localeCompare(b));
const KIT_DIRS = ['.team/bin/cli', '.team/bin/hooks', '.team/bin/lib', '.team/bin', ...SKILL_DIRS, '.claude/skills', '.claude/agents', '.claude'];
```

(`KIT_DIRS` is declared before `COPIES` today; move the `KIT_DIRS` declaration below `SKILL_COPIES` so it can use it.) Uninstall only removes a folder in `KIT_DIRS` when the Kit created it and it is empty, so a user's own `.claude/skills/my-own` keeps `.claude/skills` in place. Confirm this with the uninstall test.

- [ ] **Step 4: README**

In `README.md`, section "Install, update and uninstall", the "What it puts in the project" list gains:
`- .claude/skills/ with the seven Salesforce skills (sf-architecture, sf-apex, sf-flow, sf-security, sf-testing, sf-deploy, sf-review)`
Under "Development", add:

````markdown
Skill pressure tests (spec 7.1) run each skill's scenarios in headless Claude Code, with and without the skill, and record the results in `skills/<name>/tests/results/`:

```
node scripts/skill-pressure.mjs sf-apex baseline
node scripts/skill-pressure.mjs sf-apex with-skill
```
````

- [ ] **Step 5: Run everything**

Run: `npx vitest run && npm run lint && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/install/plan.mjs test/install-skills.test.mjs test/install.test.mjs test/skills.test.mjs README.md
git commit -m "Installer: ship the seven Salesforce skills to .claude/skills"
```

---

### Task 10: Pull request (ask Jimmy first)

Outward-facing: ask Jimmy before running it.

- [ ] **Step 1:** Push `feature/sf-skills` to `origin` and open a pull request against `main` titled "Plan 2: Salesforce skills". The body lists each skill with its baseline failures and with-skill result (from `skills/*/tests/results/*/S*.json`) and ends with the Claude Code attribution line. Use `gh api repos/Jimmyvo23/salesforce-team-kit/pulls` if `gh pr create` fails, and always pass `-R Jimmyvo23/salesforce-team-kit`, because `gh` otherwise resolves to `upstream`.
