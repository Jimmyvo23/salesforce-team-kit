// @ts-check
// Pure text/JSON helpers for the installer. No I/O.

export const MD_MARKERS = { start: '<!-- agent-team-kit:start -->', end: '<!-- agent-team-kit:end -->' };
export const GITIGNORE_MARKERS = { start: '# agent-team-kit:start', end: '# agent-team-kit:end' };

/** A Kit hook is any hook whose command runs a script in the Kit's hooks folder (recorder or guard). */
const KIT_HOOK_MARKER = '.team/bin/hooks/';

/**
 * Locate the marked block. Returns null when there is none; throws on a half block.
 * @param {string} text
 * @param {{ start: string, end: string }} markers
 * @returns {{ from: number, to: number } | null} `to` is just past the end marker
 */
function findBlock(text, markers) {
  const s = text.indexOf(markers.start);
  if (s === -1) {
    if (text.includes(markers.end)) {
      throw new Error(`Found the end marker "${markers.end}" with no matching start marker "${markers.start}". Fix or remove it by hand, then re-run.`);
    }
    return null;
  }
  const e = text.indexOf(markers.end, s + markers.start.length);
  if (e === -1) {
    throw new Error(`Found the start marker "${markers.start}" with no matching end marker "${markers.end}". Fix or remove it by hand, then re-run.`);
  }
  return { from: s, to: e + markers.end.length };
}

/**
 * Insert or replace the marked block.
 * Appended after exactly one blank line. If the text had no trailing newline the
 * block also has none, so removeMarked can restore the original byte for byte.
 * @param {string} text
 * @param {string} body
 * @param {{ start: string, end: string }} markers
 * @returns {string}
 */
export function upsertMarked(text, body, markers) {
  const block = `${markers.start}\n${body.replace(/\n+$/, '')}\n${markers.end}`;
  const found = findBlock(text, markers);
  if (found) return text.slice(0, found.from) + block + text.slice(found.to);
  if (text === '') return `${block}\n`;
  if (text.endsWith('\n')) return `${text}\n${block}\n`;
  return `${text}\n\n${block}`;
}

/**
 * Remove the marked block and the blank-line separator added with it.
 * @param {string} text
 * @param {{ start: string, end: string }} markers
 * @returns {string}
 */
export function removeMarked(text, markers) {
  const found = findBlock(text, markers);
  if (!found) return text;
  let before = text.slice(0, found.from);
  let after = text.slice(found.to);
  if (after.startsWith('\n')) {
    after = after.slice(1);
    if (after === '') {
      // block was last, with a trailing newline: drop one separator newline
      if (before.endsWith('\n\n')) before = before.slice(0, -1);
    } else if (before.endsWith('\n\n') && after.startsWith('\n')) {
      after = after.slice(1);
    }
  } else if (after === '' && before.endsWith('\n\n')) {
    // block was last, no trailing newline
    before = before.slice(0, -2);
  }
  return before + after;
}

/**
 * @param {any} hook
 * @returns {boolean}
 */
const isKitHook = (hook) =>
  !!hook && typeof hook.command === 'string' && hook.command.includes(KIT_HOOK_MARKER);

/**
 * Remove every Kit hook; never mutates the input.
 * @param {Record<string, any>} settings
 * @returns {Record<string, any>}
 */
export function removeKitHooks(settings) {
  const out = structuredClone(settings);
  const hooks = out.hooks;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return out;
  let touched = false;
  for (const event of Object.keys(hooks)) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) continue;
    const kept = [];
    for (const group of groups) {
      if (!group || !Array.isArray(group.hooks)) { kept.push(group); continue; }
      const inner = group.hooks.filter((/** @type {any} */ h) => !isKitHook(h));
      if (inner.length === group.hooks.length) { kept.push(group); continue; }
      touched = true;
      if (inner.length > 0) kept.push({ ...group, hooks: inner });
    }
    if (kept.length > 0) hooks[event] = kept;
    else if (groups.length > 0) delete hooks[event];
  }
  if (touched && Object.keys(hooks).length === 0) delete out.hooks;
  return out;
}

/**
 * Add the Kit hooks, replacing any earlier Kit entries. User hooks are untouched.
 * @param {Record<string, any>} settings
 * @param {Record<string, any[]>} kitHooks
 * @returns {Record<string, any>}
 */
export function mergeHooks(settings, kitHooks) {
  const out = removeKitHooks(settings);
  if (!out.hooks || typeof out.hooks !== 'object' || Array.isArray(out.hooks)) out.hooks = {};
  for (const [event, groups] of Object.entries(structuredClone(kitHooks))) {
    out.hooks[event] = [...(Array.isArray(out.hooks[event]) ? out.hooks[event] : []), ...groups];
  }
  return out;
}

/**
 * @param {string | null} text
 * @returns {{ ok: true, settings: Record<string, any> } | { ok: false, error: string }}
 */
export function parseSettings(text) {
  if (text !== null && text.startsWith('\uFEFF')) text = text.slice(1);
  if (text === null || text.trim() === '') return { ok: true, settings: {} };
  let value;
  try {
    value = JSON.parse(text);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `settings.json is not valid JSON (${why}). Fix it by hand, then re-run; nothing was changed.` };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'settings.json must contain a JSON object at the top level. Fix it by hand, then re-run; nothing was changed.' };
  }
  if (Object.hasOwn(value, 'hooks')) {
    const hooks = value.hooks;
    if (hooks === null || typeof hooks !== 'object' || Array.isArray(hooks)) {
      return { ok: false, error: 'settings.json has a "hooks" value that is not an object, so the Kit cannot add its hooks safely. Fix it by hand, then re-run; nothing was changed.' };
    }
    for (const [event, groups] of Object.entries(hooks)) {
      if (!Array.isArray(groups)) {
        return { ok: false, error: `settings.json has hooks.${event} that is not an array, so the Kit cannot add its hooks safely. Fix it by hand, then re-run; nothing was changed.` };
      }
    }
  }
  return { ok: true, settings: value };
}

/** Permission deny rules the Kit adds: a second lock behind the org guard (spec 3.1). */
export const KIT_DENY = Object.freeze(['Bash(sf project deploy quick:*)']);

/**
 * Add the Kit deny rules once; never mutates the input.
 * @param {Record<string, any>} settings
 * @returns {Record<string, any>}
 */
export function mergeDeny(settings) {
  const out = structuredClone(settings);
  if (!out.permissions || typeof out.permissions !== 'object' || Array.isArray(out.permissions)) out.permissions = {};
  if (!Array.isArray(out.permissions.deny)) out.permissions.deny = [];
  for (const rule of KIT_DENY) if (!out.permissions.deny.includes(rule)) out.permissions.deny.push(rule);
  return out;
}

/**
 * Remove the Kit deny rules, and the deny list or permissions object if that leaves them empty.
 * @param {Record<string, any>} settings
 * @returns {Record<string, any>}
 */
export function removeKitDeny(settings) {
  const out = structuredClone(settings);
  const perms = out.permissions;
  if (!perms || typeof perms !== 'object' || Array.isArray(perms) || !Array.isArray(perms.deny)) return out;
  const kept = perms.deny.filter((/** @type {unknown} */ r) => !KIT_DENY.includes(/** @type {string} */ (r)));
  if (kept.length === perms.deny.length) return out;
  if (kept.length > 0) perms.deny = kept;
  else delete perms.deny;
  if (Object.keys(perms).length === 0) delete out.permissions;
  return out;
}
