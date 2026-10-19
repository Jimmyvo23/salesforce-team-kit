// @ts-check
// Where the Kit is installed: ~/.salesforce-team-kit/projects.json, used by --update-all.
import fs from 'node:fs';
import path from 'node:path';

export const REGISTRY = '.salesforce-team-kit/projects.json';

/** @param {string} homeDir @returns {string[]} */
export function readRegistry(homeDir) {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(homeDir, REGISTRY), 'utf8'))?.projects;
    return Array.isArray(list) ? [...new Set(list.filter((x) => typeof x === 'string'))].sort() : [];
  } catch {
    return [];
  }
}

/** @param {string} homeDir @param {string[]} projects */
function save(homeDir, projects) {
  const file = path.join(homeDir, REGISTRY);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ projects: [...new Set(projects)].sort() }, null, 2)}\n`);
}

/** @param {string} dir */
const realOrResolved = (dir) => { try { return fs.realpathSync(dir); } catch { return path.resolve(dir); } };

/** @param {string} homeDir @param {string} dir */
export function addProject(homeDir, dir) {
  save(homeDir, [...readRegistry(homeDir), realOrResolved(dir)]);
}

/** @param {string} homeDir @param {string} dir */
export function removeProject(homeDir, dir) {
  const drop = new Set([path.resolve(dir), realOrResolved(dir)]);
  save(homeDir, readRegistry(homeDir).filter((p) => !drop.has(p)));
}
