// @ts-check
// Decision logic for the org guard (hooks/guard-org.mjs). Pure functions: all I/O comes in
// through the GuardCtx functions, so every rule can be tested without Salesforce.
import path from 'node:path';

/** @param {string} w */
const baseName = (w) => (w.includes('/') ? w.split('/').filter(Boolean).pop() || w : w);

/**
 * Index just after the ")" that closes a substitution whose body starts at `from`.
 * Parentheses inside quotes or after a backslash do not count.
 * @param {string} s
 * @param {number} from
 * @param {string} [open]
 * @param {string} [close]
 */
function substEnd(s, from, open = '(', close = ')') {
  let depth = 1;
  let j = from;
  while (j < s.length && depth > 0) {
    const ch = s[j];
    if (ch === '\\') { j += 2; continue; }
    if (ch === "'") {
      const k = s.indexOf("'", j + 1);
      j = k === -1 ? s.length : k + 1;
      continue;
    }
    if (ch === '"') {
      j++;
      while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1;
      j++;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) depth--;
    j++;
  }
  return Math.min(j, s.length);
}

/**
 * Split a shell command into simple commands, each a list of words with quotes removed.
 * Splits on ; & | newlines ( ) { } outside quotes. Redirect targets are dropped.
 * The text inside $( ) and backticks is split too and appended at the end.
 * @param {string} command
 * @returns {string[][]}
 */
export function splitCommands(command) {
  /** @type {string[][]} */ const out = [];
  /** @type {string[]} */ const inner = [];
  /** @type {string[]} */ let words = [];
  let word = '';
  let inWord = false;
  let quote = '';
  let dropNext = false;
  const endWord = () => {
    if (inWord) {
      if (dropNext) dropNext = false;
      else words.push(word);
    }
    word = '';
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    dropNext = false;
    if (words.length) out.push(words);
    words = [];
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote === "'") {
      if (c === "'") quote = '';
      else word += c;
      continue;
    }
    const procSubst = quote === '' && (c === '<' || c === '>') && command[i + 1] === '(';
    if ((c === '$' && command[i + 1] === '(') || procSubst) {
      const end = substEnd(command, i + 2);
      const closed = command[end - 1] === ')';
      inner.push(command.slice(i + 2, closed ? end - 1 : end));
      word += '$(…)';
      inWord = true;
      i = end - 1;
      continue;
    }
    if (c === '`') {
      const j = command.indexOf('`', i + 1);
      const end = j === -1 ? command.length : j;
      inner.push(command.slice(i + 1, end));
      word += '$(…)';
      inWord = true;
      i = end;
      continue;
    }
    if (c === '$' && command[i + 1] === '{') {
      if (/^\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(command.slice(i))) {
        const j = command.indexOf('}', i);
        word += command.slice(i, j + 1);
        i = j;
      } else {
        const end = substEnd(command, i + 2, '{', '}');
        const closed = command[end - 1] === '}';
        inner.push(command.slice(i + 2, closed ? end - 1 : end));
        word += command.slice(i, end);
        i = end - 1;
      }
      inWord = true;
      continue;
    }
    if (quote === '"') {
      if (c === '"') quote = '';
      else if (c === '\\' && i + 1 < command.length) word += command[++i];
      else word += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; inWord = true; continue; }
    if (c === '\\' && i + 1 < command.length) { word += command[++i]; inWord = true; continue; }
    if (c === '#' && !inWord) {
      endCommand();
      while (i + 1 < command.length && command[i + 1] !== '\n') i++;
      continue;
    }
    if (c === '>' || c === '<') {
      if (inWord && /^\d+$/.test(word)) { word = ''; inWord = false; }
      endWord();
      while (command[i + 1] === '>' || command[i + 1] === '<') i++;
      if (command[i + 1] === '&') {
        i++;
        while (/\d/.test(command[i + 1] ?? '')) i++;
        continue;
      }
      dropNext = true;
      continue;
    }
    if (';&|\n\r(){}'.includes(c)) { endCommand(); continue; }
    if (/\s/.test(c)) { endWord(); continue; }
    word += c;
    inWord = true;
  }
  endCommand();
  for (const text of inner) out.push(...splitCommands(text));
  return out;
}

const PASS_THROUGH = new Set([
  'env', 'sudo', 'time', 'nice', 'nohup', 'command', 'exec', 'npx', 'builtin',
  'timeout', 'stdbuf', 'ionice', 'caffeinate', 'unbuffer', 'chronic',
  'setsid', 'doas', 'coproc', 'strace', 'ltrace', 'flock',
]);
const EXEC_STYLE = new Set(['find', 'watch', 'parallel']);
const KEYWORDS = new Set(['if', 'then', 'do', 'else', 'elif', 'while', 'until', '!', '{']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh']);
const SCRIPT_FILE = /^\.\.?\/|\.(sh|bash|zsh)$/;

/** @param {string} x */
const isSf = (x) => {
  const b = baseName(x).toLowerCase();
  return b === 'sf' || b === 'sfdx';
};

const INTERPRETERS = new Set(['eval', 'source', '.', 'xargs', 'find', 'watch', 'parallel']);

/** Words worth resuming unwrapping from behind a wrapper's options. @param {string} x */
const isInterpreter = (x) => {
  const b = baseName(x).toLowerCase();
  return isSf(x) || SHELLS.has(b) || INTERPRETERS.has(b) || PASS_THROUGH.has(b) || SCRIPT_FILE.test(x);
};

/**
 * What a simple command really runs. `always` on an opaque result means block regardless of text.
 * @param {string[]} words
 * @param {string} [fullText]
 * @returns {{ kind: 'program', program: string, args: string[] } | { kind: 'inline', text: string } | { kind: 'script', file: string } | { kind: 'opaque', what: string, text: string, always: boolean } | null}
 */
export function unwrap(words, fullText = words.join(' ')) {
  let w = words.filter((x) => x !== '');
  for (;;) {
    while (w.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]) || KEYWORDS.has(w[0]))) w = w.slice(1);
    if (w.length === 0) return null;
    if (/[$`{]/.test(w[0])) {
      const simpleVar = /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(w[0]);
      return { kind: 'opaque', what: 'a computed command name', text: fullText, always: !simpleVar };
    }
    const prog = baseName(w[0]);
    if (PASS_THROUGH.has(prog)) {
      const k = w.findIndex((x, idx) => idx > 0 && isInterpreter(x));
      if (k !== -1) {
        w = w.slice(k);
        continue;
      }
      w = w.slice(1);
      while (w.length && w[0].startsWith('-')) w = w.slice(1);
      continue;
    }
    if (prog === 'eval') return { kind: 'inline', text: w.slice(1).join(' ') };
    if (SHELLS.has(prog)) {
      const rest = w.slice(1);
      let c = -1;
      let first = -1;
      for (let k = 0; k < rest.length; k++) {
        const x = rest[k];
        if (x === '-o' || x === '-O' || x === '+o' || x === '+O') { k++; continue; }
        if (/^-[A-Za-z]*c[A-Za-z]*$/.test(x)) { c = k; break; }
        if (!x.startsWith('-')) { first = k; break; }
      }
      if (c !== -1) return { kind: 'inline', text: rest[c + 1] ?? '' };
      if (first !== -1) return { kind: 'script', file: rest[first] };
      return { kind: 'opaque', what: `${prog} reading stdin`, text: '', always: true };
    }
    if (prog === 'su' || prog === 'script') {
      const c = w.findIndex((x, idx) => idx > 0 && /^-[A-Za-z]*c[A-Za-z]*$/.test(x));
      if (c !== -1) return { kind: 'inline', text: w[c + 1] ?? '' };
    }
    if (prog === 'source' || prog === '.') return w[1] ? { kind: 'script', file: w[1] } : null;
    if (prog === 'xargs') return { kind: 'opaque', what: 'xargs', text: w.slice(1).join(' '), always: false };
    if (EXEC_STYLE.has(prog) && w.slice(1).some(isSf)) {
      return { kind: 'opaque', what: prog, text: w.slice(1).join(' '), always: false };
    }
    const lower = prog.toLowerCase().replace(/\.(cmd|exe|js)$/, '');
    const sfLike = lower === 'sf' || lower === 'sfdx';
    if (!sfLike && SCRIPT_FILE.test(w[0])) return { kind: 'script', file: w[0] };
    return { kind: 'program', program: sfLike ? lower : prog, args: w.slice(1) };
  }
}

/** @typedef {{ allow: true } | { allow: false, reason: string }} Decision */
/**
 * @typedef {object} GuardCtx
 * @property {string[] | null} sandboxes aliases from orgs.sandbox in team.json; null when team.json can't be read
 * @property {string} [teamError] why sandboxes is null
 * @property {() => string | null} defaultOrg the default target org (project, then global)
 * @property {(alias: string) => string | null} instanceUrl the org's instance URL, or null when unknown
 * @property {(file: string) => string | null} readScript a script's text, or null when unreadable
 */

/** @type {Decision} */
const ALLOW = Object.freeze({ allow: true });
/** @param {string} reason @returns {Decision} */
const deny = (reason) => ({ allow: false, reason });

/**
 * True for sandbox instance URLs: enhanced domains (<domain>--<sandbox>.sandbox.my.salesforce.com),
 * legacy My Domain sandboxes (<domain>--<sandbox>[.csNN].my.salesforce.com) and legacy csNN instances.
 * Production My Domains can't contain "--".
 * @param {string} url
 * @returns {boolean}
 */
export function isSandboxUrl(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host.endsWith('.sandbox.my.salesforce.com')
    || /^[a-z0-9-]+--[a-z0-9]+(\.cs\d+)?\.my\.salesforce\.com$/.test(host)
    || /^cs\d+\.salesforce\.com$/.test(host);
}

/** @param {string} url */
const hostOf = (url) => {
  try { return new URL(url).hostname; } catch { return url; }
};

const CONFIG_ORG_KEY = (/** @type {string} */ w) => w.includes('target-org') || w.includes('target-dev-hub');

/** @type {{ topic: string[], when?: (flags: string[], args: string[]) => boolean, reason: string }[]} */
const FORBIDDEN = [
  { topic: ['project', 'deploy', 'quick'], reason: 'Quick deploys are for production releases. Jimmy deploys to production himself with change sets.' },
  { topic: ['org', 'display'], reason: 'sf org display prints an access token. Use "sf org list" to see orgs.' },
  { topic: ['org', 'open'], when: (f) => f.includes('--url-only') || f.includes('-r'), reason: 'sf org open --url-only prints a login URL with a session token.' },
  { topic: ['org', 'list'], when: (f) => f.includes('--json'), reason: 'sf org list --json can include access tokens. Run it without --json.' },
  { topic: ['org', 'login'], reason: 'Jimmy authorises orgs himself.' },
  { topic: ['org', 'logout'], reason: 'Jimmy manages org logins himself.' },
  { topic: ['deploy', 'metadata', 'quick'], reason: 'Quick deploys are for production releases. Jimmy deploys to production himself with change sets.' },
  { topic: ['auth'], reason: 'Jimmy authorises orgs himself.' },
  { topic: ['login'], reason: 'Jimmy authorises orgs himself.' },
  { topic: ['logout'], reason: 'Jimmy manages org logins himself.' },
  { topic: ['config', 'set'], when: (_f, a) => a.some(CONFIG_ORG_KEY), reason: "Changing the default org is Jimmy's job. Pass -o <sandbox alias> instead." },
  { topic: ['config', 'unset'], when: (_f, a) => a.some(CONFIG_ORG_KEY), reason: "Changing the default org is Jimmy's job. Pass -o <sandbox alias> instead." },
  { topic: ['alias', 'set'], reason: 'Jimmy manages org aliases.' },
  { topic: ['alias', 'unset'], reason: 'Jimmy manages org aliases.' },
];

/** Topics that never touch an org unless an org flag is given. */
const NO_ORG = [['version'], ['help'], ['plugins'], ['update'], ['autocomplete'], ['doctor'], ['config'], ['alias'],
  ['search'], ['info'], ['which'], ['commands'], ['project', 'generate'], ['apex', 'generate'], ['lightning', 'generate'],
  ['static-resource', 'generate'], ['visualforce', 'generate'], ['analytics', 'generate'], ['template'],
  ['code-analyzer'], ['scanner'], ['org', 'list']];

const ORG_FLAGS = new Set(['-o', '--target-org', '-v', '--target-dev-hub', '--from-org', '--source-org']);

/**
 * Every org named by an org flag (-o x, --target-org x, --target-org=x, ...).
 * @param {string[]} flags
 * @returns {string[]}
 */
function orgFlagValues(flags) {
  /** @type {string[]} */ const out = [];
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i];
    const eq = f.indexOf('=');
    if (f.startsWith('-') && eq > 0 && ORG_FLAGS.has(f.slice(0, eq))) out.push(f.slice(eq + 1));
    else if (/^-[ov]./.test(f) && f !== '-o' && f !== '-v' && !f.startsWith('--')) out.push(f.slice(2).replace(/^=/, ''));
    else if (ORG_FLAGS.has(f)) { out.push(flags[i + 1] ?? ''); i++; }
  }
  return out;
}

/**
 * Decide one sf invocation (the words after "sf").
 * @param {string[]} args
 * @param {GuardCtx} ctx
 * @returns {Decision}
 */
export function checkSf(args, ctx) {
  if (args.some((a) => /[$`]/.test(a))) {
    return deny("This sf command builds its arguments at run time ($…), so the guard can't see the target org. Write the arguments out in full.");
  }
  /** @type {string[]} */ const topic = [];
  let i = 0;
  for (; i < args.length && !args[i].startsWith('-'); i++) topic.push(...args[i].split(':'));
  if (topic[0] === 'force') topic.shift();
  const flags = args.slice(i);
  const helpOnly = flags.length > 0 && flags.every((f) => f === '--help' || f === '-h');
  if (topic.length === 0 || topic[0] === 'help' || helpOnly) return ALLOW;
  const starts = (/** @type {string[]} */ p) => p.every((w, k) => topic[k] === w);
  for (const f of FORBIDDEN) {
    if (starts(f.topic) && (!f.when || f.when(flags, args))) return deny(f.reason);
  }
  const named = orgFlagValues(flags);
  if (named.length === 0 && NO_ORG.some(starts)) return ALLOW;
  if (ctx.sandboxes === null) {
    return deny(`The guard can't read .team/team.json (${ctx.teamError ?? 'unknown error'}), so sf org commands are blocked until it is fixed.`);
  }
  let orgs = named;
  if (orgs.length === 0) {
    const d = ctx.defaultOrg();
    if (!d) return deny('This sf command has no target org. Add -o <alias> with an alias from orgs.sandbox in .team/team.json.');
    orgs = [d];
  }
  for (const org of orgs) {
    if (!ctx.sandboxes.includes(org)) {
      return deny(`"${org}" is not listed as a sandbox in .team/team.json (orgs.sandbox). The team only works in listed sandboxes; ask Jimmy to add it if it is one.`);
    }
    const url = ctx.instanceUrl(org);
    if (url === null) return deny(`The guard could not look up "${org}". Ask Jimmy to check the alias with "sf org list".`);
    if (!isSandboxUrl(url)) return deny(`"${org}" points to ${hostOf(url)}, which is not a sandbox. The team only works in sandboxes.`);
  }
  return ALLOW;
}

const SCRIPT_RUNS_SF = /(?:^|[\s;&|(){}`'"=$!<>/])(?:sf|sfdx)\s+[A-Za-z-]/im;
const MAX_DEPTH = 3;

/** Command-like sf/sfdx words anywhere in raw text, used to catch what the parser could not see. */
const SF_TOKEN = /(?:^|[\s;&|(){}`'"=$!<>/])(?:sf|sfdx)\s+[A-Za-z-]/gi;

/** Other ways to start the same CLI (npx @salesforce/cli, node .../sfdx-cli/...). */
const SF_LAUNCHER = /@salesforce\/cli\b|\bsfdx-cli\b/gi;

/**
 * Walk one command string. `counter.checked` counts sf/sfdx invocations the walk examined.
 * @param {string} command
 * @param {GuardCtx} ctx
 * @param {number} depth
 * @param {{ checked: number }} counter
 * @returns {Decision}
 */
function walk(command, ctx, depth, counter) {
  if (depth > MAX_DEPTH) return deny('The command nests shells too deeply for the guard to check. Run the sf command directly.');
  for (const words of splitCommands(command)) {
    const u = unwrap(words, command);
    if (!u) continue;
    if (u.kind === 'inline') {
      const r = walk(u.text, ctx, depth + 1, counter);
      if (!r.allow) return r;
      continue;
    }
    if (u.kind === 'opaque') {
      if (u.always) return deny(`${u.what} hides the command from the guard. Run the command directly.`);
      if (/\bsf(dx)?\b/i.test(u.text)) return deny(`${u.what} hides the sf command's arguments from the guard. Run the sf command directly.`);
      continue;
    }
    if (u.kind === 'script') {
      const text = ctx.readScript(u.file);
      if (text !== null && SCRIPT_RUNS_SF.test(text)) {
        return deny(`${u.file} runs sf commands the guard can't check one by one. Run those sf commands directly.`);
      }
      continue;
    }
    if (u.program === 'sfdx') {
      counter.checked++;
      return deny('Use sf instead of the legacy sfdx command, so the guard can check the target org.');
    }
    if (u.program === 'sf') {
      counter.checked++;
      const r = checkSf(u.args, ctx);
      if (!r.allow) return r;
    }
  }
  return ALLOW;
}

/**
 * Decide a whole Bash command.
 * @param {string} command
 * @param {GuardCtx} ctx
 * @returns {Decision}
 */
export function decide(command, ctx) {
  const counter = { checked: 0 };
  const r = walk(command, ctx, 0, counter);
  if (!r.allow) return r;
  const tokens = (command.match(SF_TOKEN) ?? []).length + (command.match(SF_LAUNCHER) ?? []).length;
  if (tokens > counter.checked) return deny('The guard could not find every sf command in this line. Run each sf command on its own.');
  return ALLOW;
}

/**
 * The default target org: project .sf, project .sfdx, then the same in the home folder.
 * @param {{ projectDir: string, homeDir: string, readFile: (file: string) => string | null }} o
 * @returns {string | null}
 */
export function readDefaultOrg({ projectDir, homeDir, readFile }) {
  /** @type {[string, string][]} */
  const tries = [
    [path.join(projectDir, '.sf', 'config.json'), 'target-org'],
    [path.join(projectDir, '.sfdx', 'sfdx-config.json'), 'defaultusername'],
    [path.join(homeDir, '.sf', 'config.json'), 'target-org'],
    [path.join(homeDir, '.sfdx', 'sfdx-config.json'), 'defaultusername'],
  ];
  for (const [file, key] of tries) {
    const text = readFile(file);
    if (text === null) continue;
    try {
      const v = JSON.parse(text)?.[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    } catch {
      // A broken config file is skipped, like sf itself would fail on it.
    }
  }
  return null;
}

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Instance URL for an alias, from a cache that is trusted for one day.
 * @param {string} alias
 * @param {{ cache: Record<string, { url: string, at: string }>, now: Date, lookup: (alias: string) => string | null }} o
 * @returns {{ url: string | null, cache: Record<string, { url: string, at: string }> }} the same cache object when unchanged
 */
export function cachedInstanceUrl(alias, { cache, now, lookup }) {
  const hit = Object.hasOwn(cache, alias) ? cache[alias] : undefined;
  if (hit && typeof hit.url === 'string' && (() => { const age = now.getTime() - Date.parse(hit.at); return age >= 0 && age < CACHE_TTL_MS; })()) return { url: hit.url, cache };
  const url = lookup(alias);
  if (url === null) return { url: null, cache };
  return { url, cache: { ...cache, [alias]: { url, at: now.toISOString() } } };
}
