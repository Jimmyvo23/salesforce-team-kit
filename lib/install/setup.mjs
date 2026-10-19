// @ts-check
// First-run setup helpers: sandbox aliases, org skill skeleton and discovery story.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isSandboxUrl } from '../guard.mjs';

export const STORY_PATH = 'docs/stories/T-000-org-discovery.md';

/**
 * Alias names from the sf alias files. They hold usernames only, no tokens.
 * @param {{ homeDir: string }} o
 * @returns {string[]}
 */
export function readAliases({ homeDir }) {
  /** @type {Set<string>} */ const names = new Set();
  for (const file of [path.join(homeDir, '.sfdx', 'alias.json'), path.join(homeDir, '.sf', 'alias.json')]) {
    try {
      const orgs = JSON.parse(fs.readFileSync(file, 'utf8'))?.orgs;
      if (orgs && typeof orgs === 'object' && !Array.isArray(orgs)) for (const k of Object.keys(orgs)) names.add(k);
    } catch {
      // missing or broken: counts as empty
    }
  }
  return [...names].sort();
}

/** @param {string} url */
const hostOf = (url) => { try { return new URL(url).hostname; } catch { return url; } };

/**
 * @param {string[]} aliases
 * @param {(alias: string) => string | null} lookup instance URL or null
 * @returns {{ sandboxes: { alias: string, host: string }[], skipped: { alias: string, reason: string }[] }}
 */
export function classifyAliases(aliases, lookup) {
  /** @type {{ alias: string, host: string }[]} */ const sandboxes = [];
  /** @type {{ alias: string, reason: string }[]} */ const skipped = [];
  for (const alias of aliases) {
    const url = lookup(alias);
    if (url === null) skipped.push({ alias, reason: 'could not look up' });
    else if (isSandboxUrl(url)) sandboxes.push({ alias, host: hostOf(url) });
    else skipped.push({ alias, reason: `not a sandbox (${hostOf(url)})` });
  }
  return { sandboxes, skipped };
}

/**
 * The org's instance URL from `sf org display`. Only instanceUrl is kept; the rest (tokens) is dropped.
 * @param {string} alias
 * @returns {string | null}
 */
export function sfInstanceUrl(alias) {
  const r = spawnSync('sf', ['org', 'display', '-o', alias, '--json'], { encoding: 'utf8', timeout: 10_000 });
  if (r.status !== 0 || typeof r.stdout !== 'string') return null;
  try {
    const url = JSON.parse(r.stdout)?.result?.instanceUrl;
    return typeof url === 'string' ? url : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} answer "1,3", "" (keep preselected) or "none"
 * @param {number} count
 * @param {number[]} preselected 0-based
 * @returns {number[] | null} sorted 0-based indexes, or null when invalid
 */
export function parseSelection(answer, count, preselected) {
  const a = answer.trim().toLowerCase();
  if (a === '') return [...preselected].sort((x, y) => x - y);
  if (a === 'none') return [];
  /** @type {Set<number>} */ const picked = new Set();
  for (const part of a.split(',')) {
    const t = part.trim();
    if (!/^\d+$/.test(t)) return null;
    const n = Number(t);
    if (n < 1 || n > count) return null;
    picked.add(n - 1);
  }
  return [...picked].sort((x, y) => x - y);
}

/** @param {string} targetDir */
export function defaultProjectName(targetDir) {
  try {
    const name = JSON.parse(fs.readFileSync(path.join(targetDir, 'sfdx-project.json'), 'utf8'))?.name;
    if (typeof name === 'string' && name.trim()) return name.trim();
  } catch {
    // no sfdx-project.json name: use the folder
  }
  return path.basename(path.resolve(targetDir));
}

/** @param {string} project */
export function defaultOrgName(project) {
  return project.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'org';
}

const SECTIONS = Object.freeze([
  ['Org basics', 'Edition, `sourceApiVersion`, the sandboxes and what each is for.'],
  ['Automation by object', 'Flows, triggers, validation rules, workflow rules and Process Builder per object.'],
  ['Key objects and fields', 'The objects the business runs on and their important custom fields.'],
  ['Apex and integrations', 'Apex classes and triggers, Named Credentials, external systems.'],
  ['Conventions', 'Naming, record types, permission sets.'],
  ['Known gotchas', 'Things that surprised someone once.'],
  ['Sources', 'What was queried, from which sandbox, and when.'],
]);

/** @param {{ skill: string, project: string }} o */
export function orgSkillSkeleton({ skill, project }) {
  const body = SECTIONS.map(([h, what]) => `## ${h}\n\n<!-- ${what} -->\nNot discovered yet — run T-000.\n`).join('\n');
  return `---\nname: ${skill}\ndescription: Use when working in the ${project} Salesforce org: its sandboxes, automation per object, key objects and fields, Apex and integrations, conventions and known gotchas.\n---\n\n# ${project} org knowledge\n\nFilled by the team's discovery task (T-000) and kept up to date as tasks touch the org. Read-only facts about the sandboxes; nothing here is a secret.\n\n${body}`;
}

/** @param {{ skill: string, project: string }} o */
export function discoveryStory({ skill, project }) {
  return `# T-000: Org discovery for ${project}

## Story

As Jimmy, I want the team to know this org before it changes anything, so that designs fit the automation and data model that already exist.

## Acceptance criteria

1. Every section of \`.claude/skills/${skill}/SKILL.md\` is filled, or says "None found".
2. "Automation by object" lists, for each key object, its record-triggered flows, Apex triggers, validation rules, workflow rules and Process Builder processes (the automation inventory in the sf-architecture skill).
3. "Org basics" gives \`sourceApiVersion\` from \`sfdx-project.json\` and the sandboxes listed under \`orgs.sandbox\` in \`.team/team.json\`.
4. "Sources" records each query or command, the sandbox alias and the date.

## Steps (read-only)

1. Read \`sfdx-project.json\` and \`.team/team.json\`.
2. List installed packages and custom objects with their custom fields in the sandbox.
3. Pick the key objects (the ones with the most automation or custom fields) and run the automation inventory for each.
4. List Apex classes and triggers and Named Credentials.
5. Write the findings into the skill and show Jimmy the diff.

## Out of scope

No deploy, no data change and no edit in \`force-app/\`. Reading needs no Work Order; anything else does.
`;
}

/**
 * @param {string} file
 * @param {string} content
 * @returns {boolean} true when written
 */
export function writeIfMissing(file, content) {
  if (fs.existsSync(file)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return true;
}
