// @ts-check
import fs from 'node:fs';

/** @typedef {{ id: string, name: string, role: string, color: string }} Member */
/** @typedef {{ project: string, staleAfterMinutes: number, approver: Member, members: Member[], orgSkill: string | null, orgs: { sandbox: string[] } }} Team */

const DEFAULT_STALE_MINUTES = 5;
const COLOR = /^#[0-9a-f]{6}$/i;

/** @param {unknown} v */
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * @param {any} raw
 * @param {string} where e.g. `members[0]` or `approver`
 * @returns {{ ok: true, member: Member } | { ok: false, error: string }}
 */
function checkMember(raw, where) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: `${where} must be an object` };
  }
  for (const f of ['id', 'name', 'role']) {
    if (!nonEmpty(raw[f])) return { ok: false, error: `${where}.${f} must be a non-empty string` };
  }
  if (typeof raw.color !== 'string' || !COLOR.test(raw.color)) {
    return { ok: false, error: `${where}.color must be a hex color like #aabbcc` };
  }
  return {
    ok: true,
    member: { id: raw.id.trim().toLowerCase(), name: raw.name, role: raw.role, color: raw.color },
  };
}

/**
 * Load and validate team.json.
 * @param {string} file
 * @returns {{ ok: true, team: Team } | { ok: false, error: string }}
 */
export function loadTeam(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    const code = /** @type {any} */ (err)?.code;
    return { ok: false, error: code === 'ENOENT' ? `team file not found: ${file}` : `cannot read team file ${file}: ${/** @type {Error} */ (err).message}` };
  }
  /** @type {any} */
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `team file ${file} is not valid JSON: ${/** @type {Error} */ (err).message}` };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'team file must contain a JSON object' };
  }
  if (!nonEmpty(raw.project)) return { ok: false, error: 'project must be a non-empty string' };
  if (raw.approver === undefined) return { ok: false, error: 'approver is required' };
  if (raw.members === undefined) return { ok: false, error: 'members is required' };
  if (!Array.isArray(raw.members) || raw.members.length === 0) {
    return { ok: false, error: 'members must be a non-empty array' };
  }
  let staleAfterMinutes = DEFAULT_STALE_MINUTES;
  if ('staleAfterMinutes' in raw) {
    const s = raw.staleAfterMinutes;
    if (typeof s !== 'number' || !Number.isFinite(s) || s <= 0) {
      return { ok: false, error: 'staleAfterMinutes must be a positive number' };
    }
    staleAfterMinutes = s;
  }

  /** @type {string | null} */
  let orgSkill = null;
  if ('orgSkill' in raw) {
    if (typeof raw.orgSkill !== 'string') return { ok: false, error: 'orgSkill must be a string' };
    orgSkill = raw.orgSkill.trim() || null;
  }
  /** @type {string[]} */
  let sandbox = [];
  if ('orgs' in raw) {
    const o = raw.orgs;
    if (o === null || typeof o !== 'object' || Array.isArray(o)) return { ok: false, error: 'orgs must be an object' };
    if ('production' in o) {
      return { ok: false, error: 'orgs.production is not supported: agents never work in production. Remove it from .team/team.json.' };
    }
    if ('sandbox' in o) {
      if (!Array.isArray(o.sandbox) || !o.sandbox.every(nonEmpty)) {
        return { ok: false, error: 'orgs.sandbox must be an array of non-empty strings' };
      }
      sandbox = o.sandbox.map((/** @type {string} */ s) => s.trim());
    }
  }

  const a = checkMember(raw.approver, 'approver');
  if (!a.ok) return a;
  const seen = new Set([a.member.id]);
  /** @type {Member[]} */
  const members = [];
  for (let i = 0; i < raw.members.length; i++) {
    const r = checkMember(raw.members[i], `members[${i}]`);
    if (!r.ok) return r;
    if (seen.has(r.member.id)) return { ok: false, error: `duplicate id "${r.member.id}" (members[${i}])` };
    seen.add(r.member.id);
    members.push(r.member);
  }
  return { ok: true, team: { project: raw.project, staleAfterMinutes, approver: a.member, members, orgSkill, orgs: { sandbox } } };
}
