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
