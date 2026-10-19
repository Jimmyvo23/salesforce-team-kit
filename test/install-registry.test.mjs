import { test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REGISTRY, readRegistry, addProject, removeProject } from '../lib/install/registry.mjs';

let home, a, b;
beforeEach(() => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sftk-reg-')));
  home = path.join(root, 'home');
  a = path.join(root, 'a');
  b = path.join(root, 'b');
  for (const d of [home, a, b]) fs.mkdirSync(d);
});
afterEach(() => fs.rmSync(path.dirname(home), { recursive: true, force: true }));

test('empty when missing or broken', () => {
  expect(readRegistry(home)).toEqual([]);
  fs.mkdirSync(path.join(home, path.dirname(REGISTRY)), { recursive: true });
  fs.writeFileSync(path.join(home, REGISTRY), '{bad');
  expect(readRegistry(home)).toEqual([]);
});

test('add keeps paths sorted and unique; remove drops one', () => {
  addProject(home, b);
  addProject(home, a);
  addProject(home, a);
  expect(readRegistry(home)).toEqual([a, b]);
  removeProject(home, b);
  expect(readRegistry(home)).toEqual([a]);
  expect(JSON.parse(fs.readFileSync(path.join(home, REGISTRY), 'utf8'))).toEqual({ projects: [a] });
});

test('remove works for a folder that no longer exists', () => {
  addProject(home, b);
  fs.rmSync(b, { recursive: true });
  removeProject(home, b);
  expect(readRegistry(home)).toEqual([]);
});

test('a broken file is rewritten on add', () => {
  fs.mkdirSync(path.join(home, path.dirname(REGISTRY)), { recursive: true });
  fs.writeFileSync(path.join(home, REGISTRY), 'nope');
  addProject(home, a);
  expect(readRegistry(home)).toEqual([a]);
});
