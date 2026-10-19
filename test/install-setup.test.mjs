import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readAliases, classifyAliases, parseSelection, defaultProjectName, defaultOrgName,
  orgSkillSkeleton, discoveryStory, writeIfMissing, STORY_PATH,
} from '../lib/install/setup.mjs';

let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'sftk-setup-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };

describe('readAliases', () => {
  test('merges both alias files, sorted and unique', () => {
    put('.sfdx/alias.json', JSON.stringify({ orgs: { uat: 'a@x.com.uat', prod: 'a@x.com' } }));
    put('.sf/alias.json', JSON.stringify({ orgs: { uat: 'a@x.com.uat', dev: 'a@x.com.dev' } }));
    expect(readAliases({ homeDir: root })).toEqual(['dev', 'prod', 'uat']);
  });
  test('missing or broken files count as empty', () => {
    expect(readAliases({ homeDir: root })).toEqual([]);
    put('.sfdx/alias.json', '{not json');
    put('.sf/alias.json', JSON.stringify({ orgs: ['x'] }));
    expect(readAliases({ homeDir: root })).toEqual([]);
  });
});

describe('classifyAliases', () => {
  const urls = {
    uat: 'https://acme--uat.sandbox.my.salesforce.com',
    prod: 'https://acme.my.salesforce.com',
    gone: null,
  };
  test('keeps sandboxes, skips production with its host and failed lookups', () => {
    const r = classifyAliases(['gone', 'prod', 'uat'], (a) => urls[a]);
    expect(r.sandboxes).toEqual([{ alias: 'uat', host: 'acme--uat.sandbox.my.salesforce.com' }]);
    expect(r.skipped).toEqual([
      { alias: 'gone', reason: 'could not look up' },
      { alias: 'prod', reason: 'not a sandbox (acme.my.salesforce.com)' },
    ]);
  });
  test('result carries no token fields', () => {
    const r = classifyAliases(['uat'], (a) => urls[a]);
    expect(JSON.stringify(r)).not.toMatch(/token/i);
  });
});

describe('parseSelection', () => {
  test('Enter keeps the preselection', () => expect(parseSelection('', 3, [1])).toEqual([1]));
  test('comma-separated 1-based numbers', () => expect(parseSelection(' 1, 3 ', 3, [])).toEqual([0, 2]));
  test('duplicates collapse, order sorted', () => expect(parseSelection('3,1,3', 3, [])).toEqual([0, 2]));
  test('"none" chooses nothing', () => expect(parseSelection('none', 3, [0])).toEqual([]));
  test('out of range or junk is null', () => {
    expect(parseSelection('4', 3, [])).toBeNull();
    expect(parseSelection('0', 3, [])).toBeNull();
    expect(parseSelection('a', 3, [])).toBeNull();
  });
});

describe('names', () => {
  test('project name from sfdx-project.json, else folder name', () => {
    const dir = path.join(root, 'Client X');
    fs.mkdirSync(dir);
    expect(defaultProjectName(dir)).toBe('Client X');
    fs.writeFileSync(path.join(dir, 'sfdx-project.json'), JSON.stringify({ name: 'clientx-sf' }));
    expect(defaultProjectName(dir)).toBe('clientx-sf');
    fs.writeFileSync(path.join(dir, 'sfdx-project.json'), '{broken');
    expect(defaultProjectName(dir)).toBe('Client X');
  });
  test('org name is lower-case with dashes', () => {
    expect(defaultOrgName('Client X  Salesforce!')).toBe('client-x-salesforce');
    expect(defaultOrgName('***')).toBe('org');
  });
});

describe('texts', () => {
  test('skeleton has frontmatter and the seven sections, each not discovered yet', () => {
    const s = orgSkillSkeleton({ skill: 'clientx-org', project: 'Client X' });
    expect(s).toMatch(/^---\nname: clientx-org\ndescription: Use when working in the Client X Salesforce org: /);
    for (const h of ['Org basics', 'Automation by object', 'Key objects and fields', 'Apex and integrations', 'Conventions', 'Known gotchas', 'Sources']) {
      expect(s).toContain(`## ${h}`);
    }
    expect(s.match(/Not discovered yet — run T-000\./g)).toHaveLength(7);
  });
  test('discovery story names the skill and forbids deploys and data changes', () => {
    const s = discoveryStory({ skill: 'clientx-org', project: 'Client X' });
    expect(s).toContain('# T-000: Org discovery for Client X');
    expect(s).toContain('.claude/skills/clientx-org/SKILL.md');
    expect(s).toMatch(/## Out of scope[\s\S]*deploy/);
    expect(STORY_PATH).toBe('docs/stories/T-000-org-discovery.md');
  });
});

describe('writeIfMissing', () => {
  test('writes once, never overwrites', () => {
    const f = path.join(root, 'a', 'b.md');
    expect(writeIfMissing(f, 'one')).toBe(true);
    expect(writeIfMissing(f, 'two')).toBe(false);
    expect(fs.readFileSync(f, 'utf8')).toBe('one');
  });
});
