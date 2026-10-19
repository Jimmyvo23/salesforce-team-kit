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
  test('parseGrade rejects a grade with fewer items than the scenario has criteria', () => {
    const text = '```json\n{"items": [{"item":"a","met":true,"evidence":"x"}]}\n```';
    expect(parseGrade(text)).not.toBeNull();
    expect(parseGrade(text, 1)?.pass).toBe(true);
    expect(parseGrade(text, 2)).toBeNull();
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
      const items = '[{"item":"a","met":true,"evidence":"e"},{"item":"b","met":true,"evidence":"e"}]';
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
