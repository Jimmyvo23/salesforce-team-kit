import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  MD_MARKERS, GITIGNORE_MARKERS, upsertMarked, removeMarked,
  mergeHooks, removeKitHooks, parseSettings,
} from '../lib/install/text.mjs';

const kitHooks = JSON.parse(readFileSync(new URL('../templates/hooks.json', import.meta.url), 'utf8'));
const BODY = '## Team\nline two';
const block = `${MD_MARKERS.start}\n${BODY}\n${MD_MARKERS.end}`;
const userHook = { type: 'command', command: 'echo user' };

describe('markers', () => {
  it('has the exact marker strings', () => {
    expect(MD_MARKERS).toEqual({ start: '<!-- agent-team-kit:start -->', end: '<!-- agent-team-kit:end -->' });
    expect(GITIGNORE_MARKERS).toEqual({ start: '# agent-team-kit:start', end: '# agent-team-kit:end' });
  });
});

describe('upsertMarked / removeMarked', () => {
  it('empty text gives just the block with no leading blank line', () => {
    expect(upsertMarked('', BODY, MD_MARKERS)).toBe(`${block}\n`);
  });
  it('appends after a blank line when text ends with a newline', () => {
    expect(upsertMarked('# Hi\n', BODY, MD_MARKERS)).toBe(`# Hi\n\n${block}\n`);
  });
  it('appends after a blank line when text has no trailing newline', () => {
    expect(upsertMarked('# Hi', BODY, MD_MARKERS)).toBe(`# Hi\n\n${block}`);
  });
  it('trims trailing newlines from the body', () => {
    expect(upsertMarked('', `${BODY}\n\n\n`, MD_MARKERS)).toBe(`${block}\n`);
  });
  it('replaces an existing block and keeps surrounding text', () => {
    const t = `intro\n\n${block}\n\noutro\n`;
    expect(upsertMarked(t, 'new', MD_MARKERS)).toBe(`intro\n\n${MD_MARKERS.start}\nnew\n${MD_MARKERS.end}\n\noutro\n`);
  });
  const shapes = {
    empty: '',
    'no trailing newline': '# Hi\ntext',
    'trailing newline': '# Hi\ntext\n',
    'several trailing newlines': '# Hi\n\n\n',
    'only newline': '\n',
    'CRLF text': 'a\r\nb\r\n',
  };
  for (const [name, t] of Object.entries(shapes)) {
    it(`is idempotent and removal round-trips: ${name}`, () => {
      const once = upsertMarked(t, BODY, MD_MARKERS);
      expect(upsertMarked(once, BODY, MD_MARKERS)).toBe(once);
      expect(removeMarked(once, MD_MARKERS)).toBe(t);
    });
  }
  it('round-trips with an existing block in the middle', () => {
    const t = `intro\n\n${block}\n\noutro\n`;
    expect(removeMarked(t, MD_MARKERS)).toBe('intro\n\noutro\n');
    const t2 = `${block}\nafter\n`;
    expect(removeMarked(t2, MD_MARKERS)).toBe('after\n');
  });
  it('removeMarked is a no-op when no block exists', () => {
    expect(removeMarked('plain\n', MD_MARKERS)).toBe('plain\n');
  });
  it('works with gitignore markers', () => {
    const out = upsertMarked('node_modules\n', 'a\nb', GITIGNORE_MARKERS);
    expect(out).toBe('node_modules\n\n# agent-team-kit:start\na\nb\n# agent-team-kit:end\n');
    expect(removeMarked(out, GITIGNORE_MARKERS)).toBe('node_modules\n');
  });
  it('throws on a start marker without an end marker', () => {
    expect(() => upsertMarked(`x\n${MD_MARKERS.start}\nhalf`, BODY, MD_MARKERS)).toThrow(/start marker.*no matching end/i);
    expect(() => removeMarked(`${MD_MARKERS.start}\nhalf`, MD_MARKERS)).toThrow(/no matching end/i);
  });
  it('throws on an end marker without a start marker', () => {
    expect(() => upsertMarked(`x\n${MD_MARKERS.end}\n`, BODY, MD_MARKERS)).toThrow(/end marker.*no matching start/i);
  });
});

const isKit = (h) => String(h.command).includes('.team/bin/hooks/record.mjs');
const kitCount = (s) => Object.values(s.hooks ?? {}).flat().flatMap((g) => g.hooks).filter(isKit).length;

describe('mergeHooks', () => {
  it('adds Kit hooks to empty settings', () => {
    const out = mergeHooks({}, kitHooks);
    expect(out.hooks).toEqual(kitHooks);
  });
  it('keeps a user PreToolUse hook and adds Kit ones', () => {
    const s = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [userHook] }] } };
    const out = mergeHooks(s, kitHooks);
    expect(out.hooks.PreToolUse).toEqual([...s.hooks.PreToolUse, ...kitHooks.PreToolUse]);
    expect(out.hooks.SubagentStart).toEqual(kitHooks.SubagentStart);
    expect(kitCount(out)).toBe(4);
  });
  it('keeps a user hook in a PostToolUse group with the same matcher', () => {
    const s = { hooks: { PostToolUse: [{ matcher: 'Edit|Write|Bash', hooks: [userHook] }] } };
    const out = mergeHooks(s, kitHooks);
    expect(out.hooks.PostToolUse[0]).toEqual(s.hooks.PostToolUse[0]);
    expect(out.hooks.PostToolUse).toHaveLength(2);
  });
  it('keeps a user hook that shares a group with a stale Kit hook', () => {
    const stale = { type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.team/bin/hooks/record.mjs" old' };
    const s = { hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [userHook, stale] }] } };
    const out = mergeHooks(s, kitHooks);
    expect(out.hooks.PostToolUse[0]).toEqual({ matcher: 'Bash', hooks: [userHook] });
    expect(kitCount(out)).toBe(4);
  });
  it('is idempotent', () => {
    const s = { model: 'x', hooks: { PreToolUse: [{ hooks: [userHook] }] } };
    const once = mergeHooks(s, kitHooks);
    expect(mergeHooks(once, kitHooks)).toEqual(once);
    expect(kitCount(mergeHooks(once, kitHooks))).toBe(4);
  });
  it('does not mutate its inputs and keeps other keys and order', () => {
    const s = { a: 1, hooks: { PreToolUse: [{ hooks: [userHook] }] }, z: 2 };
    const snap = structuredClone(s);
    const kitSnap = structuredClone(kitHooks);
    const out = mergeHooks(s, kitHooks);
    expect(s).toEqual(snap);
    expect(kitHooks).toEqual(kitSnap);
    expect(Object.keys(out)).toEqual(['a', 'hooks', 'z']);
    out.hooks.SubagentStart[0].hooks[0].command = 'changed';
    expect(kitHooks.SubagentStart[0].hooks[0].command).not.toBe('changed');
  });
});

describe('removeKitHooks', () => {
  it('leaves only the user hook', () => {
    const s = { hooks: { PreToolUse: [{ hooks: [userHook] }] } };
    const out = removeKitHooks(mergeHooks(s, kitHooks));
    expect(out).toEqual(s);
  });
  it('drops settings.hooks when it held only Kit entries', () => {
    const out = removeKitHooks(mergeHooks({ model: 'x' }, kitHooks));
    expect(out).toEqual({ model: 'x' });
  });
  it('keeps an empty-but-user-owned hooks object', () => {
    const s = { hooks: {} };
    expect(removeKitHooks(s)).toEqual({ hooks: {} });
  });
  it('drops emptied groups and events but keeps user siblings', () => {
    const s = { hooks: { PostToolUse: [
      { matcher: 'Bash', hooks: [userHook] },
      kitHooks.PostToolUse[0],
    ] } };
    expect(removeKitHooks(s)).toEqual({ hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [userHook] }] } });
  });
  it('does not mutate the input', () => {
    const s = mergeHooks({}, kitHooks);
    const snap = structuredClone(s);
    removeKitHooks(s);
    expect(s).toEqual(snap);
  });
  it('is a no-op on settings without hooks', () => {
    expect(removeKitHooks({ a: 1 })).toEqual({ a: 1 });
  });
});

describe('parseSettings', () => {
  it('null and blank give empty settings', () => {
    expect(parseSettings(null)).toEqual({ ok: true, settings: {} });
    expect(parseSettings('')).toEqual({ ok: true, settings: {} });
    expect(parseSettings('  \n ')).toEqual({ ok: true, settings: {} });
  });
  it('parses an object', () => {
    expect(parseSettings('{"a":1}')).toEqual({ ok: true, settings: { a: 1 } });
  });
  it('refuses invalid JSON', () => {
    const r = parseSettings('{ bad');
    expect(r.ok).toBe(false);
    expect(r.error.startsWith('settings.json is not valid JSON')).toBe(true);
  });
  it('refuses non-object JSON', () => {
    for (const t of ['[]', '5', 'null', '"x"']) {
      const r = parseSettings(t);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/settings\.json/);
      expect(r.error).toMatch(/object/);
    }
  });
  it('strips a leading UTF-8 BOM', () => {
    expect(parseSettings('\uFEFF{"a":1}')).toEqual({ ok: true, settings: { a: 1 } });
    expect(parseSettings('\uFEFF')).toEqual({ ok: true, settings: {} });
  });
  it('refuses a hooks value that is not a plain object', () => {
    for (const t of ['{"hooks":[]}', '{"hooks":"x"}', '{"hooks":null}', '{"hooks":5}']) {
      const r = parseSettings(t);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/"hooks"/);
      expect(r.error).toMatch(/nothing was changed/);
    }
  });
  it('refuses a hooks event whose value is not an array', () => {
    for (const t of ['{"hooks":{"PostToolUse":{}}}', '{"hooks":{"Stop":"x"}}', '{"hooks":{"Stop":null}}']) {
      const r = parseSettings(t);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/hooks\./);
      expect(r.error).toMatch(/array/);
    }
  });
  it('accepts a valid hooks object with array events', () => {
    const r = parseSettings('{"hooks":{"Stop":[]}}');
    expect(r).toEqual({ ok: true, settings: { hooks: { Stop: [] } } });
  });
});
