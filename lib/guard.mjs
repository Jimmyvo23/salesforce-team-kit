// @ts-check
// Decision logic for the org guard (hooks/guard-org.mjs). Pure functions: all I/O comes in
// through the GuardCtx functions, so every rule can be tested without Salesforce.
import path from 'node:path';
import { SF_COMMAND_IDS } from './sf-commands.mjs';

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
    if (ch === '$' && s[j + 1] === "'") {
      j += 2;
      while (j < s.length && s[j] !== "'") j += s[j] === '\\' ? 2 : 1;
      j++;
      continue;
    }
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

/** Thrown when the shell text has syntax the guard can't read; decide() turns it into a block. */
export class UnreadableShellError extends Error {}

const ANSI_C_SIMPLE = { a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };

/**
 * Decode a bash $'…' string whose body starts at `from`. Returns the text and the index of the
 * closing quote, or null when bash and zsh could read it differently (no closing quote, a NUL,
 * a bad code point, \c at the end).
 * @param {string} s
 * @param {number} from
 * @returns {{ text: string, end: number } | null}
 */
function decodeAnsiC(s, from) {
  let text = '';
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === "'") return text.includes('\0') ? null : { text, end: i };
    if (c !== '\\') { text += c; continue; }
    const e = s[++i];
    if (e === undefined) return null;
    const hex = (/** @type {number} */ max) => {
      const m = new RegExp(`^[0-9a-fA-F]{1,${max}}`).exec(s.slice(i + 1));
      return m ? (i += m[0].length, parseInt(m[0], 16)) : null;
    };
    if (Object.hasOwn(ANSI_C_SIMPLE, e)) text += ANSI_C_SIMPLE[/** @type {keyof typeof ANSI_C_SIMPLE} */ (e)];
    else if (/[0-7]/.test(e)) {
      const m = /^[0-7]{1,3}/.exec(s.slice(i));
      text += String.fromCharCode(parseInt(m?.[0] ?? '0', 8) & 0xff);
      i += (m?.[0].length ?? 1) - 1;
    } else if (e === 'x' || e === 'u' || e === 'U') {
      const n = hex(e === 'x' ? 2 : e === 'u' ? 4 : 8);
      if (n === null) text += `\\${e}`;
      else if (n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return null;
      else text += String.fromCodePoint(n);
    } else if (e === 'c') {
      const x = s[++i];
      if (x === undefined || x === "'") return null;
      text += String.fromCharCode(x === '?' ? 0x7f : x.toUpperCase().charCodeAt(0) & 0x1f);
    } else text += `\\${e}`;
  }
  return null;
}

/**
 * For each simple command from splitCommands, the words that hold an unquoted shell pattern
 * (* ? [..] {a,b} a(b) or a leading zsh =name), which the shell may expand into other words.
 * @type {WeakMap<string[], Set<string>>}
 */
const PATTERN_WORDS = new WeakMap();
/** Pattern syntax in a word (quoted parts included, which only errs towards blocking). */
const PATTERN_SYNTAX = /[*?{(]|^=|\[.*\]/;
/** A pattern word the shell really expands: * ? [..], a group, zsh =name, or braces with , or .. ({} alone is not). */
const EXPANDS = /[*?(]|^=|\[.*\]|\{[^{}]*(,|\.\.)[^{}]*\}/;
/**
 * For each simple command from splitCommands, the words whose text the shell computes at run time:
 * a $ expansion (unquoted or in double quotes), a substitution, a $'…' that decodes to other text,
 * ~user/~+/~-, or an unquoted pattern the shell expands (Ruling L-1).
 * @type {WeakMap<string[], Set<string>>}
 */
const DYNAMIC_WORDS = new WeakMap();
/** What follows a $ that the shell expands. */
const EXPANDED_AFTER_DOLLAR = /[A-Za-z0-9_@*#?$!-]/;
/**
 * Simple commands from splitCommands that the shell does not run: the inside of pattern groups
 * ('text'), and case patterns ('case', which are not expanded either). Their words still count
 * as sf mentions, but they are not commands.
 * @type {WeakMap<string[], 'text' | 'case'>}
 */
const NOT_RUN = new WeakMap();
/** Results of splitCommands for lines where a command's stdin is a pipe or an input redirect. @type {WeakSet<string[][]>} */
const STDIN_FED = new WeakSet();
/** Simple commands with their own here-document or here-string (<<, <<<). @type {WeakSet<string[]>} */
const OWN_HEREDOC = new WeakSet();
/** Results of splitCommands for lines with a here-document or here-string, and lines with a pipe. @type {WeakSet<string[][]>} */
const HEREDOC_LINE = new WeakSet();
/** @type {WeakSet<string[][]>} */
const PIPED_LINE = new WeakSet();

/**
 * The text of every $( ), ${ } and backtick substitution in `text` (an unquoted here-document
 * body, where the shell runs them).
 * @param {string} text
 * @returns {string[]}
 */
function substitutions(text) {
  /** @type {string[]} */ const found = [];
  for (let k = 0; k < text.length; k++) {
    if (text[k] === '\\') { k++; continue; }
    if (text[k] === '$' && (text[k + 1] === '(' || text[k + 1] === '{')) {
      const [open, close] = text[k + 1] === '(' ? ['(', ')'] : ['{', '}'];
      const end = substEnd(text, k + 2, open, close);
      found.push(text.slice(k + 2, text[end - 1] === close ? end - 1 : end));
      k = end - 1;
    } else if (text[k] === '`') {
      const j = text.indexOf('`', k + 1);
      found.push(text.slice(k + 1, j === -1 ? text.length : j));
      k = j === -1 ? text.length : j;
    }
  }
  return found;
}

/**
 * Split a shell command into simple commands, each a list of words with quotes removed.
 * Splits on ; & | newlines ( ) outside quotes, and on { } when they stand alone. $'…' is decoded
 * and $"…" read as "…". Redirect targets are dropped. Here-document bodies are data: only the
 * substitutions in an unquoted body are returned, as commands. Case patterns are returned as
 * commands marked NOT_RUN. A line with a pipe or an input redirect is in STDIN_FED; words the
 * shell computes are in DYNAMIC_WORDS; here-documents mark OWN_HEREDOC and HEREDOC_LINE.
 * The text inside $( ) and backticks is split too and appended at the end.
 * @param {string} command
 * @param {boolean} [notRun] mark the top-level commands NOT_RUN (the inside of a pattern group)
 * @returns {string[][]}
 * @throws {UnreadableShellError} when a $'…' can't be decoded, or a pattern group holds a substitution
 */
export function splitCommands(command, notRun = false) {
  /** @type {string[][]} */ const out = [];
  /** @type {string[]} */ const inner = [];
  /** @type {string[]} */ const groups = []; // the inside of pattern groups: not run, but its words count
  /** @type {string[]} */ const arith = []; // arithmetic text: not commands (its << is a shift), but its substitutions run
  /** @type {{ delim: string, quoted: boolean, stripTabs: boolean }[]} */ let heredocs = [];
  let stdin = false;
  let piped = false;
  let heredocLine = false;
  let ownHeredoc = false;
  /** @type {{ stripTabs: boolean } | null} */ let delimNext = null;
  /** @type {string[]} */ let words = [];
  /** @type {Set<string>} */ let patterns = new Set();
  /** @type {Set<string>} */ let dynamic = new Set();
  let word = '';
  let inWord = false;
  let pattern = false;
  let dyn = false;
  let quoted = false;
  let quote = '';
  let dropNext = false;
  let depth = 0;
  const endWord = () => {
    if (inWord) {
      if (dropNext) {
        dropNext = false;
        if (delimNext) heredocs.push({ delim: word, quoted, ...delimNext });
        delimNext = null;
      } else {
        words.push(word);
        if (pattern && PATTERN_SYNTAX.test(word)) patterns.add(word);
        if (dyn || (pattern && EXPANDS.test(word))) dynamic.add(word);
      }
    }
    word = '';
    inWord = false;
    pattern = false;
    dyn = false;
    quoted = false;
  };
  const endCommand = (/** @type {boolean} */ caseItem = false) => {
    endWord();
    dropNext = false;
    if (words.length) {
      out.push(words);
      PATTERN_WORDS.set(words, patterns);
      DYNAMIC_WORDS.set(words, dynamic);
      if (ownHeredoc) OWN_HEREDOC.add(words);
      if (notRun || caseItem) NOT_RUN.set(words, caseItem ? 'case' : 'text');
    }
    words = [];
    patterns = new Set();
    dynamic = new Set();
    ownHeredoc = false;
  };
  /**
   * Skip the here-document bodies that start after the newline at `nl`; returns the new index.
   * A body is data; with an unquoted delimiter the shell still runs its substitutions.
   */
  const skipBodies = (/** @type {number} */ nl) => {
    let k = nl + 1;
    for (const h of heredocs) {
      let body = '';
      while (k < command.length) {
        const e = command.indexOf('\n', k);
        const line = command.slice(k, e === -1 ? command.length : e);
        k = e === -1 ? command.length : e + 1;
        if ((h.stripTabs ? line.replace(/^\t+/, '') : line) === h.delim) break;
        body += `${line}\n`;
      }
      if (!h.quoted) inner.push(...substitutions(body));
    }
    heredocs = [];
    return k - 1;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote === "'") {
      if (c === "'") quote = '';
      else word += c;
      continue;
    }
    if (quote === '' && !inWord && c === '(' && command[i + 1] === '(') {
      // An arithmetic command (( … )): its << is a shift, not a here-document.
      const end = substEnd(command, i + 1);
      arith.push(command.slice(i + 2, end - 2));
      i = end - 1;
      continue;
    }
    if (c === '$' && command[i + 1] === '[') {
      // Old-style arithmetic $[ … ].
      const end = substEnd(command, i + 2, '[', ']');
      arith.push(command.slice(i + 2, end - 1));
      word += '$[…]';
      inWord = true;
      dyn = true;
      i = end - 1;
      continue;
    }
    const procSubst = quote === '' && (c === '<' || c === '>' || (c === '=' && !inWord)) && command[i + 1] === '(';
    if ((c === '$' && command[i + 1] === '(') || procSubst) {
      const end = substEnd(command, i + 2);
      const closed = command[end - 1] === ')';
      (command[i + 2] === '(' ? arith : inner).push(command.slice(i + 2, closed ? end - 1 : end)); // $(( … )) is arithmetic
      word += '$(…)';
      inWord = true;
      dyn = true;
      i = end - 1;
      continue;
    }
    if (c === '`') {
      const j = command.indexOf('`', i + 1);
      const end = j === -1 ? command.length : j;
      inner.push(command.slice(i + 1, end));
      word += '$(…)';
      inWord = true;
      dyn = true;
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
      dyn = true;
      continue;
    }
    if (c === '$' && command[i + 1] !== "'" && command[i + 1] !== '"' && EXPANDED_AFTER_DOLLAR.test(command[i + 1] ?? '')) dyn = true;
    if (quote === '"') {
      if (c === '"') quote = '';
      else if (c === '\\' && i + 1 < command.length) word += command[++i];
      else word += c;
      continue;
    }
    if (c === '$' && command[i + 1] === "'") {
      const d = decodeAnsiC(command, i + 2);
      if (!d) throw new UnreadableShellError("the $'…' quoting");
      if (d.text !== command.slice(i + 2, d.end)) dyn = true;
      word += d.text;
      inWord = true;
      quoted = true;
      i = d.end;
      continue;
    }
    if (c === '$' && command[i + 1] === '"') continue;
    if (c === '"' || c === "'") { quote = c; inWord = true; quoted = true; continue; }
    if (c === '\\' && i + 1 < command.length) { word += command[++i]; inWord = true; quoted = true; continue; }
    if (c === '#' && !inWord) {
      endCommand();
      while (i + 1 < command.length && command[i + 1] !== '\n') i++;
      continue;
    }
    if (c === '>' || c === '<') {
      if (inWord && /^\d+$/.test(word)) { word = ''; inWord = false; }
      endWord();
      if (c === '<') stdin = true;
      if (c === '<' && command[i + 1] === '<') heredocLine = ownHeredoc = true; // << or <<<
      const heredoc = c === '<' && command[i + 1] === '<' && command[i + 2] !== '<';
      while (command[i + 1] === '>' || command[i + 1] === '<') i++;
      if (heredoc) {
        const stripTabs = command[i + 1] === '-';
        if (stripTabs) i++;
        delimNext = { stripTabs };
        dropNext = true;
        continue;
      }
      if (command[i + 1] === '&') {
        i++;
        while (/\d/.test(command[i + 1] ?? '')) i++;
        continue;
      }
      dropNext = true;
      continue;
    }
    if (c === '(' && inWord && command[i + 1] !== ')' && !/^[A-Za-z_][A-Za-z0-9_]*\+?=$/.test(word)) {
      // A pattern group inside a word: zsh s(f|x), bash extglob @(sf). (name=( starts an array.)
      const end = substEnd(command, i + 1);
      if (/[$`]/.test(command.slice(i, end))) throw new UnreadableShellError('a pattern group with $ or ` in it');
      word += command.slice(i, end);
      groups.push(command.slice(i + 1, end - 1)); // its words still count as sf mentions
      pattern = true;
      i = end - 1;
      continue;
    }
    const standsAlone = !inWord && (c === '}' || /\s/.test(command[i + 1] ?? ' '));
    if (c === ')' && depth === 0) { endCommand(true); continue; } // closes a case pattern
    if (';&|\n\r()'.includes(c) || ((c === '{' || c === '}') && standsAlone)) {
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (c === '|') {
        if (command[i + 1] === '|') i++;
        else stdin = piped = true;
      }
      endCommand();
      if (c === '\n' && heredocs.length) i = skipBodies(i);
      continue;
    }
    if (/\s/.test(c)) { endWord(); continue; }
    if ('*?[{'.includes(c) || (c === '=' && !inWord)) pattern = true;
    if (c === '~' && !inWord && !/[/\s;&|()<>]/.test(command[i + 1] ?? ' ')) dyn = true; // ~user, ~+, ~-
    word += c;
    inWord = true;
  }
  endCommand();
  if (heredocs.length) skipBodies(command.length);
  for (const [text, run, isArith] of [...groups.map((t) => [t, false, false]), ...arith.map((t) => [t, false, true]), ...inner.map((t) => [t, true, false])]) {
    const part = splitCommands(/** @type {string} */ (text), !run);
    if (isArith) for (const c of part) OWN_HEREDOC.delete(c);
    else if (HEREDOC_LINE.has(part)) heredocLine = true;
    if (STDIN_FED.has(part)) stdin = true;
    if (PIPED_LINE.has(part)) piped = true;
    out.push(...part);
  }
  if (stdin) STDIN_FED.add(out);
  if (piped) PIPED_LINE.add(out);
  if (heredocLine) HEREDOC_LINE.add(out);
  return out;
}

const PASS_THROUGH = new Set([
  'env', 'sudo', 'time', 'nice', 'nohup', 'command', 'exec', 'npx', 'builtin',
  'timeout', 'stdbuf', 'ionice', 'caffeinate', 'unbuffer', 'chronic',
  'setsid', 'doas', 'coproc', 'strace', 'ltrace', 'flock',
]);
const EXEC_STYLE = new Set(['find', 'parallel']);
const KEYWORDS = new Set(['if', 'then', 'do', 'else', 'elif', 'while', 'until', '!', '{']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh']);
const SCRIPT_FILE = /^\.\.?\/|\.(sh|bash|zsh)$/;

/** A word that is the sf/sfdx program name, also with a path or a .cmd/.exe/.js ending. @param {string} w */
const isSfWord = (w) => {
  const b = baseName(w).toLowerCase().replace(/\.(cmd|exe|js)$/, '');
  return b === 'sf' || b === 'sfdx';
};

const SF_FILE_NAMES = ['sf', 'sfdx'].flatMap((n) => ['', '.cmd', '.exe', '.js'].map((e) => n + e));

/**
 * The words a brace expansion makes ({a,b}c → ac bc). A range {x..y} becomes *, which can only
 * match more. Null when there are too many to check.
 * @param {string} w
 * @returns {string[] | null}
 */
function braceWords(w) {
  /** @type {string[]} */ const done = [];
  const todo = [w.replace(/\{[^{},]*\.\.[^{},]*\}/g, '*')];
  while (todo.length) {
    if (done.length + todo.length > 256) return null;
    const x = /** @type {string} */ (todo.pop());
    const m = /\{([^{}]*,[^{}]*)\}/.exec(x);
    if (!m) { done.push(x); continue; }
    for (const alt of m[1].split(',')) todo.push(x.slice(0, m.index) + alt + x.slice(m.index + m[0].length));
  }
  return done;
}

/**
 * A regular expression for one glob path segment: * ? [..], and pattern groups (zsh (a|b), bash
 * extglob such as +(a)) matching anything. Null when it can't be built.
 * @param {string} seg
 * @returns {RegExp | null}
 */
function globRegex(seg) {
  let re = '';
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if ('?*+@!'.includes(c) && seg[i + 1] === '(') continue;
    if (c === '(') { i = substEnd(seg, i + 1) - 1; re += '.*'; continue; }
    if (c === '*') { re += '.*'; continue; }
    if (c === '?') { re += '.'; continue; }
    if (c === '[') {
      // A bracket expression; a POSIX class such as [:alpha:] inside it matches any character here.
      let j = i + 1;
      if ('!^'.includes(seg[j])) j++;
      if (seg[j] === ']') j++;
      let posix = false;
      while (j < seg.length && seg[j] !== ']') {
        const k = /^\[[:=.]/.test(seg.slice(j)) ? seg.indexOf(`${seg[j + 1]}]`, j + 2) : -1;
        if (k !== -1) { posix = true; j = k + 2; } else j++;
      }
      if (j < seg.length) {
        const body = seg.slice(i + 1, j).replace(/^[!^]/, '^').replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
        re += posix ? '.' : `[${body}]`;
        i = j;
        continue;
      }
    }
    re += c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }
  try { return new RegExp(`^${re}$`, 'i'); } catch { return null; }
}

/**
 * True when a word with a shell pattern could expand to sf or sfdx, also with a path or a
 * .cmd/.exe/.js ending. It only errs towards yes.
 * @param {string} w
 */
function couldBeSf(w) {
  const all = braceWords(w.replace(/^=/, ''));
  if (all === null) return true;
  return all.some((x) => {
    const re = globRegex(x.split('/').filter(Boolean).pop() ?? x);
    return re === null || SF_FILE_NAMES.some((n) => re.test(n));
  });
}

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
  if (NOT_RUN.has(words)) return null;
  const patterns = PATTERN_WORDS.get(words);
  let w = words.filter((x) => x !== '');
  for (;;) {
    while (w.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]) || KEYWORDS.has(w[0]))) w = w.slice(1);
    if (w.length === 0) return null;
    if (/[$`{]/.test(w[0])) return { kind: 'opaque', what: 'a computed command name', text: fullText, always: true };
    if (patterns?.has(w[0])) return { kind: 'opaque', what: 'a pattern in the command name', text: fullText, always: true };
    const prog = baseName(w[0]);
    if (prog === 'su' || prog === 'script' || prog === 'flock') {
      const c = w.findIndex((x, idx) => idx > 0 && (/^-[A-Za-z]*c[A-Za-z]*$/.test(x) || x === '--command'));
      if (c !== -1) return { kind: 'inline', text: w[c + 1] ?? '' };
    }
    // trap's first argument, and watch's arguments joined, are run by a shell later.
    if (prog === 'trap') {
      const a = w.slice(1).filter((x) => x !== '--');
      if (a[0] && !a[0].startsWith('-')) return { kind: 'inline', text: a[0] };
    }
    if (prog === 'watch') {
      let k = 1;
      for (; k < w.length && w[k].startsWith('-'); k++) if (['-n', '--interval', '-q', '--equexit'].includes(w[k])) k++;
      return { kind: 'inline', text: w.slice(k).join(' ') };
    }
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
    if (prog === 'source' || prog === '.') return w[1] ? { kind: 'script', file: w[1] } : null;
    // An alias's text is read as a command later, with its quotes gone (alias x='/usr/local/bin/s?').
    if (prog === 'alias' && w.length > 1) return { kind: 'opaque', what: 'alias', text: fullText, always: true };
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
 * @property {() => string | null} defaultOrg the default target org (environment, project, then global)
 * @property {() => string | null} [defaultDevHub] the default Dev Hub, found the same way; null when none
 * @property {(alias: string) => string | null} instanceUrl the org's instance URL, or null when unknown
 * @property {(file: string) => string | null} readScript a script's text, or null when unreadable
 * @property {string | null} [mustNameOrg] set when the default org can't be trusted here: the reason
 *   to block sf org commands that have no org flag
 * @property {boolean} [stdinFed] set by the walk when a command on the line reads a pipe or redirect
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

/** Config keys that set the default org or Dev Hub, including the legacy sfdx names. */
const CONFIG_ORG_KEY = (/** @type {string} */ w) => /target-org|target-dev-hub|defaultusername|defaultdevhubusername|targetusername|targetdevhubusername/i.test(w);

const URL_ONLY = (/** @type {string[]} */ f) => f.includes('--url-only') || f.includes('-r');
const QUICK = 'Quick deploys are for production releases. Jimmy deploys to production himself with change sets.';
const LOGIN = 'Jimmy authorises orgs himself.';
const LOGOUT = 'Jimmy manages org logins himself.';
const TOKEN = 'This command prints an access token, password or auth URL. Use "sf org list" to see orgs.';
const DEFAULT_ORG = "Changing the default org is Jimmy's job. Pass -o <sandbox alias> instead.";
const ALIAS = 'Jimmy manages org aliases.';

/**
 * Commands that are always blocked. Each word list is a topic or a whole command id (canonical
 * or alias, from the manifests of the plugins bundled with @salesforce/cli), in any order. The
 * whole ids are listed too, so an incomplete command that sf would offer to finish as one of them
 * (sf show-access-token) is caught.
 * @type {{ topics: string[][], when?: (flags: string[], args: string[]) => boolean, reason: string }[]}
 */
const FORBIDDEN = [
  { topics: [['project', 'deploy', 'quick'], ['project', 'deploy', 'pipeline', 'quick'], ['deploy', 'metadata', 'quick']], reason: QUICK },
  { topics: [['org', 'display', 'user'], ['user', 'display'], ['org', 'auth', 'show-access-token'], ['org', 'auth', 'show-sfdx-auth-url'],
    ['org', 'auth', 'show-user-password']], reason: TOKEN },
  { topics: [['org', 'display']], reason: 'sf org display prints an access token. Use "sf org list" to see orgs.' },
  { topics: [['org', 'open'], ['org', 'open', 'agent'], ['org', 'open', 'authoring-bundle'], ['source', 'open']], when: URL_ONLY,
    reason: 'sf org open --url-only prints a login URL with a session token.' },
  { topics: [['doctor']], when: (f) => f.some((x) => /^--command(=|$)/.test(x) || /^-[A-Za-z]*c/.test(x)),
    reason: "sf doctor --command runs another sf command the guard can't check. Run that command directly." },
  { topics: [['org', 'list']], when: (f) => f.includes('--json'), reason: 'sf org list --json can include access tokens. Run it without --json.' },
  { topics: [['org', 'login', 'access-token'], ['org', 'login', 'jwt'], ['org', 'login', 'sfdx-url'], ['org', 'login', 'web'],
    ['auth', 'accesstoken', 'store'], ['auth', 'jwt', 'grant'], ['auth', 'sfdxurl', 'store'], ['auth', 'web', 'login'], ['auth'], ['login']], reason: LOGIN },
  { topics: [['org', 'logout'], ['auth', 'logout'], ['logout']], reason: LOGOUT },
  { topics: [['config', 'set'], ['config', 'unset']], when: (_f, a) => a.some(CONFIG_ORG_KEY), reason: DEFAULT_ORG },
  { topics: [['alias', 'set'], ['alias', 'unset']], reason: ALIAS },
];

/**
 * Topics whose commands never touch an org unless an org flag is given, and single commands that
 * don't (their topic has org commands, for example org list metadata). Checked against the
 * manifests of the plugins bundled with @salesforce/cli: no command that uses an org has these
 * topic words.
 */
const NO_ORG_TOPICS = [['plugins'], ['autocomplete'], ['config'], ['alias'], ['info'], ['which'],
  ['project', 'generate'], ['apex', 'generate'], ['lightning', 'generate'], ['static-resource', 'generate'],
  ['visualforce', 'generate'], ['analytics', 'generate'], ['code-analyzer'], ['scanner']];
const NO_ORG_COMMANDS = [['version'], ['update'], ['doctor'], ['search'], ['commands'], ['org', 'list']];

const ORG_FLAGS = new Set(['-o', '--target-org', '-v', '--target-dev-hub', '--from-org', '--source-org',
  '-u', '--targetusername', '--targetdevhubusername', '--fromorg', '--target-hub-org', '--dev-hub-org',
  '--devops-center-username', '--sourceorg']);

/** Short org flags that only some commands have (from the installed plugins' manifests). */
const TOPIC_ORG_CHARS = [
  { topic: ['package', 'bundle', 'install'], char: 'd' }, // -d = --dev-hub-org
  { topic: ['agent', 'generate', 'template'], char: 's' }, // -s = --source-org
  { topic: ['project', 'deploy', 'pipeline'], char: 'c' }, // -c = --devops-center-username (JIT plugin-devops-center)
];

/** Commands whose Dev Hub flag falls back to the default Dev Hub while they also take -o (JIT plugin-signups). */
const HUB_FALLBACK = [['org', 'create', 'snapshot'], ['org', 'snapshot', 'create']];
const HUB_FLAGS = ['-v', '--target-dev-hub', '--targetdevhubusername', '--target-hub-org'];
/** @param {string[]} flags */
const hasHubFlag = (flags) => flags.some((f) => HUB_FLAGS.some((h) => f === h || f.startsWith(`${h}=`)) || /^-v./.test(f));

/**
 * Long flags whose names mention org, hub or username but do not name an org, found in the
 * oclif manifests of the plugins bundled with @salesforce/cli. Any other such flag is blocked.
 */
const NON_ORG_FLAGS = new Set([
  'base-username', // org create agent-user: the new user's name
  'error-notification-username', 'errornotificationusername', // package create/update
  'org-dependent', 'orgdependent', // package create
  'org-file', 'org-list', // package push-upgrade schedule: subscriber org ids
  'set-default-dev-hub', 'setdefaultdevhub', 'setdefaultdevhubusername', 'setdefaultusername', // org login (blocked anyway)
  'set-unique-username', 'setuniqueusername', // org create user
  'org-type', // devops stage environment add (JIT): Production or Sandbox, not an org
]);

const wordsKey = (/** @type {string[]} */ w) => [...w].sort().join(' ');
/** Every sf command id and alias as its sorted words, and whether it takes positional arguments. */
const COMMANDS = new Map(SF_COMMAND_IDS.map((e) => [wordsKey(e.replace(/\*$/, '').split(':')), e.endsWith('*')]));
/** The ids' leading parts in their own order, which oclif keeps reading as command words. */
const ID_PREFIXES = new Set(SF_COMMAND_IDS.flatMap((e) => {
  const w = e.replace(/\*$/, '').split(':');
  return w.map((_, k) => w.slice(0, k + 1).join(':'));
}));

/**
 * True when the leading words name a whole sf command, read the way oclif does
 * (help/util.js collateSpacedCmdIDFromArgs): a word joins the command while the words so far are
 * an id prefix, or are not yet a command that takes arguments; any word order names the same
 * command. When they don't, sf offers a prompt to finish the command (hooks/incomplete.js).
 * @param {string[]} lead the arguments before the first flag or word with "="
 */
function isWholeCommand(lead) {
  if (lead.length === 0) return true;
  if (lead[0].includes(':')) return COMMANDS.has(wordsKey(lead[0].split(':')));
  /** @type {string[]} */ const id = [];
  for (const a of lead) {
    if (!ID_PREFIXES.has([...id, a].join(':')) && id.length > 0 && COMMANDS.get(wordsKey(id)) === true) break;
    id.push(a);
  }
  return COMMANDS.has(wordsKey(id));
}

/**
 * True when every word of `part` is in `whole`, counting repeats. sf (oclif flexibleTaxonomy)
 * runs a command whose words are typed in any order, so command rules compare word multisets.
 * @param {string[]} whole
 * @param {string[]} part
 */
function containsWords(whole, part) {
  const left = [...whole];
  return part.every((w) => {
    const k = left.indexOf(w);
    if (k !== -1) left.splice(k, 1);
    return k !== -1;
  });
}

/**
 * Every org named by an org flag (-o x, --target-org x, --target-org=x, -ox, ...). oclif reads a
 * short group like -to as -t -o, so an org char after the first one in a group can't be read
 * reliably: `grouped` is then true.
 * @param {string[]} flags
 * @param {string[]} [extraChars] command-specific short org flags
 * @returns {{ values: string[], grouped: boolean }}
 */
function orgFlagValues(flags, extraChars = []) {
  const chars = ['o', 'v', 'u', ...extraChars];
  /** @type {string[]} */ const values = [];
  let grouped = false;
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i];
    const eq = f.indexOf('=');
    if (f.startsWith('-') && eq > 0 && ORG_FLAGS.has(f.slice(0, eq))) values.push(f.slice(eq + 1));
    else if (/^-[A-Za-z]./.test(f) && chars.includes(f[1])) values.push(f.slice(2).replace(/^=/, ''));
    else if (ORG_FLAGS.has(f) || (f.length === 2 && f[0] === '-' && chars.includes(f[1]))) { values.push(flags[i + 1] ?? ''); i++; }
    else if (/^-[^-]/.test(f) && f.length > 2 && [...f.slice(2)].some((ch) => chars.includes(ch))) grouped = true;
  }
  return { values, grouped };
}

/**
 * The first long flag that mentions org, hub or username and is neither an org flag nor known.
 * @param {string[]} flags
 * @returns {string | null}
 */
function unknownOrgFlag(flags) {
  for (const f of flags) {
    if (!f.startsWith('--') || f === '--') continue;
    const name = f.slice(2).split('=')[0];
    if (/org|hub|username/i.test(name) && !ORG_FLAGS.has(`--${name}`) && !NON_ORG_FLAGS.has(name)) return `--${name}`;
  }
  return null;
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
  if (args.some((a) => a === '--flags-dir' || a.startsWith('--flags-dir='))) {
    return deny("The guard can't read --flags-dir files. Pass -o <sandbox alias> on the command instead.");
  }
  let i = 0;
  while (i < args.length && !args[i].startsWith('-')) i++;
  const flags = args.slice(i);
  // The command words, as oclif reads them: the leading words up to the first one with "=",
  // split on ":", without the legacy "force" prefix.
  const end = args.slice(0, i).findIndex((a) => a.includes('='));
  const words = args.slice(0, end === -1 ? i : end).flatMap((a) => a.toLowerCase().split(/[:\s]+/)).filter((w) => w && w !== 'force');
  const helpOnly = flags.length > 0 && flags.every((f) => f === '--help' || f === '-h');
  if (i === 0 || words[0] === 'help' || helpOnly) return ALLOW;
  // A rule may name this command when its words are among the typed words, or when the typed
  // words are an incomplete command that sf would offer to finish as the rule's command.
  const mayBe = (/** @type {string[]} */ rule) => containsWords(words, rule) || (words.length > 0 && containsWords(rule, words));
  // An org-free rule needs its words first: a topic plus one more command word, or the exact command.
  const orgFree = (/** @type {string[]} */ rule, /** @type {boolean} */ exact) => containsWords(words.slice(0, rule.length + (exact ? 0 : 1)), rule)
    && (!exact || words.length === rule.length);
  for (const f of FORBIDDEN) {
    if (f.topics.some(mayBe) && (!f.when || f.when(flags, args))) return deny(f.reason);
  }
  if (ctx.stdinFed && !isWholeCommand(args.slice(0, end === -1 ? i : end))) {
    return deny("Type the whole sf command; the guard can't check one finished by a prompt.");
  }
  const unknown = unknownOrgFlag(flags);
  if (unknown) return deny(`The guard doesn't know the flag ${unknown}. Use -o <sandbox alias> or ask Jimmy.`);
  const { values: named, grouped } = orgFlagValues(flags, TOPIC_ORG_CHARS.filter((t) => mayBe(t.topic)).map((t) => t.char));
  if (grouped) return deny("Write -o <sandbox alias> as its own flag; the guard can't read grouped short flags.");
  if (named.length === 0 && (NO_ORG_TOPICS.some((t) => orgFree(t, false)) || NO_ORG_COMMANDS.some((c) => orgFree(c, true)))) return ALLOW;
  if (ctx.sandboxes === null) {
    return deny(`The guard can't read .team/team.json (${ctx.teamError ?? 'unknown error'}), so sf org commands are blocked until it is fixed.`);
  }
  let orgs = named;
  if (orgs.length === 0) {
    if (ctx.mustNameOrg) return deny(ctx.mustNameOrg);
    const d = ctx.defaultOrg();
    if (!d) return deny('This sf command has no target org. Add -o <alias> with an alias from orgs.sandbox in .team/team.json.');
    orgs = [d];
    const hub = ctx.defaultDevHub?.() ?? null;
    if (hub && !ctx.sandboxes.includes(hub)) {
      return deny(`The default Dev Hub "${hub}" is not listed as a sandbox in .team/team.json, so sf commands without an org flag are blocked. Pass -o <sandbox alias>.`);
    }
    if (hub) orgs.push(hub);
  } else if (HUB_FALLBACK.some(mayBe) && !hasHubFlag(flags)) {
    const hub = ctx.defaultDevHub?.() ?? null;
    if (hub && !ctx.sandboxes.includes(hub)) {
      return deny(`The default Dev Hub "${hub}" is not listed as a sandbox in .team/team.json, and this command uses it. Pass -v <sandbox alias>.`);
    }
    if (hub) orgs = [...orgs, hub];
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

/** An SF_/SFDX_ assignment word (also VAR+=x, and the VAR:=x body of ${VAR:=x}). */
const SF_ASSIGN = /^(?:SF|SFDX)_[A-Za-z0-9_]*[:+]?=/i;
/** A bare SF_/SFDX_ variable name (export NAME, read NAME, declare -n ref=NAME). */
const SF_NAME = /(?:^|=)(?:SF|SFDX)_[A-Z0-9_]+$/;
/** The same names anywhere in a script's text ($NAME reads don't count). */
const SF_NAME_IN_TEXT = /(?<![A-Za-z0-9_${])(?:SF|SFDX)_[A-Z0-9_]+(?![A-Za-z0-9_]*[a-z])/;
const HOME_ASSIGN = /^(?:HOME|USERPROFILE|XDG_CONFIG_HOME|XDG_DATA_HOME)(?:[:+]?=|$)/;
/** Commands that can export variables, and wrappers that take VAR=value words. */
const EXPORTERS = new Set(['export', 'declare', 'typeset', 'readonly', 'local']);
const ENV_SETTERS = new Set(['env', 'sudo', 'doas']);
const ASSIGN_WORD = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SF_VAR_REASON = 'Setting SF_/SFDX_ variables can change the target org. Pass -o <sandbox alias> instead.';
const CHANGES_DIR = new Set(['cd', 'pushd', 'popd']);
const SCRIPT_CHANGES_DIR = /(?:^|[\s;&|(){}])(?:cd|pushd|popd)(?:\s|$)/m;
const MOVED_REASON = 'This line changes folder, so pass -o <sandbox alias>.';
const ENV_REASON = 'This line changes the environment sf reads. Pass -o <sandbox alias>.';

/**
 * True when a simple command runs env with -i/--ignore-environment/- or -u/--unset, which can
 * remove variables the guard read the default org from.
 * @param {string[]} words
 */
function clearsEnv(words) {
  const j = words.findIndex((w) => baseName(w) === 'env');
  if (j === -1) return false;
  const rest = words.slice(j + 1);
  const end = rest.findIndex(isInterpreter);
  return rest.slice(0, end === -1 ? rest.length : end).some((w) => w === '-' || w === '--ignore-environment' || w === '--unset'
    || w.startsWith('--unset=') || (/^-[A-Za-z0-9]+/.test(w) && !w.startsWith('--') && /^-[A-Za-z0-9]*[iu]/.test(w)));
}

/**
 * True when a simple command may change folder: a cd, pushd or popd word anywhere, or the
 * chdir option of env (-C, --chdir) or sudo (-D, --chdir).
 * @param {string[]} words
 */
function changesDir(words) {
  if (words.some((w) => CHANGES_DIR.has(baseName(w)))) return true;
  let k = 0;
  while (k < words.length && (ASSIGN_WORD.test(words[k]) || KEYWORDS.has(words[k]))) k++;
  const prog = baseName(words[k] ?? '');
  const opt = prog === 'env' ? /^-[A-Za-z]*C/ : prog === 'sudo' ? /^-[A-Za-z]*D/ : null;
  return opt !== null && words.slice(k + 1).some((w) => w === '--chdir' || w.startsWith('--chdir=') || (!w.startsWith('--') && opt.test(w)));
}

/** A word whose variable name is computed at run time (export $(cat .env), env "$V" sf …). @param {string} w */
const computedName = (w) => /[$`]/.test(w) && !ASSIGN_WORD.test(w);

/**
 * True when a simple command sets, exports or may set at run time an SF_/SFDX_ variable.
 * @param {string[]} words
 */
function setsSfVar(words) {
  if (words.some((w) => SF_ASSIGN.test(w) || SF_NAME.test(w))) return true;
  let k = 0;
  while (k < words.length && (ASSIGN_WORD.test(words[k]) || KEYWORDS.has(words[k]))) k++;
  const prog = baseName(words[k] ?? '');
  if (EXPORTERS.has(prog)) return words.slice(k + 1).some(computedName);
  if (ENV_SETTERS.has(prog)) {
    const rest = words.slice(k + 1);
    const end = rest.findIndex(isInterpreter);
    return rest.slice(0, end === -1 ? rest.length : end).some(computedName);
  }
  return false;
}

/**
 * True when a simple command sets or exports HOME, which moves sf's global config and aliases.
 * @param {string[]} words
 */
function setsHome(words) {
  let k = 0;
  while (k < words.length && (ASSIGN_WORD.test(words[k]) || KEYWORDS.has(words[k]))) {
    if (HOME_ASSIGN.test(words[k])) return true;
    k++;
  }
  const prog = baseName(words[k] ?? '');
  return (EXPORTERS.has(prog) || ENV_SETTERS.has(prog)) && words.slice(k + 1).some((w) => HOME_ASSIGN.test(w));
}

const MAX_DEPTH = 3;

/**
 * Ruling L-1. Programs that never run another program named by their arguments, so their
 * arguments are data: patterns and $… in them are fine, and quoted text is not re-read for
 * patterns. Every other program (arch, screen, xargs, node, make, …) may run what its words name,
 * so a word the shell computes (DYNAMIC_WORDS) behind it is blocked. The reason for each entry is
 * in the round 6 report. Shell builtins here only read, set or test variables and folders.
 */
const KNOWN_SAFE = new Set(['ls', 'cat', 'echo', 'printf', 'grep', 'wc', 'head', 'tail', 'cp', 'mv', 'rm', 'mkdir', 'touch', 'ln',
  'chmod', 'diff', 'uniq', 'cut', 'tr', 'jq', 'tee', 'pwd', 'basename', 'dirname', 'realpath', 'which', 'cd', 'pushd', 'popd',
  'true', 'false', ':', 'test', '[', '[[', 'for', 'export', 'declare', 'typeset', 'local', 'readonly', 'unset', 'set', 'shift',
  'read', 'exit', 'return', 'wait', 'sleep']);

/**
 * A dynamic word that could become an option (it starts with a computed part, a pattern or a
 * dash), so a program's option checks can't see it (tar czf x *, with a file named --to-command=…).
 * @param {string} w
 * @param {(w: string) => boolean} dyn
 */
const mayBeOption = (w, dyn) => dyn(w) && /^[-$*?[{(=~@!+]/.test(w);

/**
 * True when an option word names one of the long `names` (also abbreviated, as git, GNU tar and
 * GNU sort accept) or, in a short group, one of the `chars`.
 * @param {string[]} args
 * @param {string[]} names
 * @param {string} [chars]
 */
const hasOpt = (args, names, chars = '') => args.some((a) => (a.startsWith('--')
  ? a.length > 2 && names.some((n) => n.startsWith(a.slice(2).split('=')[0]))
  : /^-[^-]/.test(a) && [...a.slice(1)].some((c) => chars.includes(c))));

/** git options before the subcommand that take a value. */
const GIT_VALUE_OPTS = new Set(['-C', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--list-cmds', '--attr-source']);
/** git subcommands that run programs from config, arguments or scripts (config writes the config they read). */
const GIT_RUNS = new Set(['config', 'bisect', 'submodule', 'filter-branch', 'send-email', 'instaweb', 'mergetool']);
/** Options that make a git subcommand run a program: [short chars, ...long names] (git-scm.com docs). */
const GIT_EXEC_OPTS = /** @type {Record<string, string[]>} */ ({
  rebase: ['x', 'exec'], grep: ['O', 'open-files-in-pager'], clone: ['uc', 'upload-pack', 'config', 'template'],
  'ls-remote': ['u', 'upload-pack'], fetch: ['', 'upload-pack'], pull: ['', 'upload-pack'], push: ['', 'receive-pack', 'exec'],
  archive: ['', 'exec'], difftool: ['x', 'extcmd'],
});
/** GNU and BSD tar options that run a program. */
const TAR_RUNS = ['to-command', 'use-compress-program', 'checkpoint-action', 'info-script', 'new-volume-script', 'rsh-command', 'rmt-command'];

/** @param {string} what */
const runsText = (what) => `${what} runs a command the guard can't check. Run that command directly.`;

/**
 * Programs that are known-safe only in some forms: true when this form never runs a program
 * named by its arguments, false when it may (so Ruling L-1 applies), or a reason to block when it
 * takes a command as text (the shell reads that text later, unchecked).
 * @type {Record<string, (args: string[], dyn: (w: string) => boolean) => boolean | string>}
 */
const SAFE_WHEN = {
  git: (args, dyn) => {
    let k = 0;
    for (; k < args.length && args[k].startsWith('-'); k++) {
      if (/^(-c|--config-env|--exec-path)/.test(args[k]) || dyn(args[k])) return false;
      if (GIT_VALUE_OPTS.has(args[k])) k++;
    }
    const sub = args[k];
    if (sub === undefined) return true;
    if (dyn(sub)) return false; // a computed subcommand may be any git-<name> program
    const opts = GIT_EXEC_OPTS[sub];
    const rest = args.slice(k + 1);
    if (sub === 'filter-branch' || (sub === 'bisect' && rest.includes('run')) || (sub === 'submodule' && rest.includes('foreach'))) return runsText(`git ${sub}`);
    if (opts && hasOpt(rest, opts.slice(1), opts[0])) return runsText(`git ${sub} with this option`);
    return !GIT_RUNS.has(sub) && !(opts && rest.some((a) => mayBeOption(a, dyn)));
  },
  tar: (args, dyn) => {
    const a = args[0] && !args[0].startsWith('-') ? [`-${args[0]}`, ...args.slice(1)] : args; // tar czf …
    return hasOpt(a, TAR_RUNS, 'IF') ? runsText('tar with this option') : !args.some((x) => mayBeOption(x, dyn));
  },
  sort: (args, dyn) => (hasOpt(args, ['compress-program']) ? runsText('sort --compress-program') : !args.some((x) => mayBeOption(x, dyn))),
  rg: (args, dyn) => (args.some((x) => x === '--pre' || x.startsWith('--pre=')) ? runsText('rg --pre') : !args.some((x) => mayBeOption(x, dyn))),
  // find's -exec targets are checked by unsafeTarget.
  find: (args, dyn) => !args.some((x) => mayBeOption(x, dyn)) && unsafeTarget('find', args) === null,
  // vitest's arguments are filters on the test files its config includes, not files to run.
  vitest: (args, dyn) => !args.some((x) => mayBeOption(x, dyn)),
};

/** A program word that names the program itself: found on PATH, or in a system bin folder. @param {string} w */
const plainProgram = (w) => !w.includes('/') || /^\/(usr\/(local\/)?|opt\/homebrew\/)?s?bin\/[^/]+$/.test(w);

/**
 * True when a program unit is KNOWN_SAFE in this form: no assignment before it (which can name a
 * program it runs, such as GIT_PAGER=…), a plain program word, and a safe form. A string is a
 * reason to block (SAFE_WHEN).
 * @param {{ program: string, args: string[] }} u
 * @param {string[]} words
 * @returns {boolean | string}
 */
function knownSafe(u, words) {
  const w = words.filter((x) => x !== '');
  const at = w.length - u.args.length - 1;
  const dyn = DYNAMIC_WORDS.get(words);
  const form = KNOWN_SAFE.has(u.program) || (SAFE_WHEN[u.program]?.(u.args, (x) => dyn?.has(x) ?? false) ?? false);
  if (typeof form === 'string') return form;
  return form && !w.slice(0, at).some((x) => ASSIGN_WORD.test(x)) && plainProgram(w[at] ?? '');
}

/** find actions that run a program. */
const FIND_EXEC = new Set(['-exec', '-execdir', '-ok', '-okdir']);
/** xargs options (GNU and BSD) whose value may be the next word. */
const XARGS_VALUE = 'adEIJLnPRsS';
const XARGS_LONG_VALUE = new Set(['--arg-file', '--delimiter', '--max-args', '--max-procs', '--max-chars', '--process-slot-var']);

/**
 * xargs, parallel and find -exec run a program with arguments taken from their input or from
 * found file names, which the guard can't see. Returns the program when it is not KNOWN_SAFE
 * (any form of it could take those arguments), else null.
 * @param {string} prog
 * @param {string[]} args
 * @returns {string | null}
 */
function unsafeTarget(prog, args) {
  /** @type {string[]} */ let targets = [];
  if (prog === 'parallel') return 'commands from its input';
  if (prog === 'find') targets = args.filter((_, k) => k > 0 && FIND_EXEC.has(args[k - 1]));
  if (prog === 'xargs') {
    let k = 0;
    for (; k < args.length; k++) {
      const a = args[k];
      if (a === '--') { k++; break; }
      if (!a.startsWith('-') || a === '-') break;
      if (a.startsWith('--')) { if (XARGS_LONG_VALUE.has(a)) k++; continue; }
      if ([...a.slice(1)].findIndex((c) => XARGS_VALUE.includes(c)) === a.length - 2) k++;
    }
    targets = [args[k] ?? 'echo'];
  }
  return targets.find((t) => !plainProgram(t) || !KNOWN_SAFE.has(baseName(t))) ?? null;
}

/**
 * Why the guard can't see what a unit outside KNOWN_SAFE runs, or null (Ruling L-1): a word the
 * shell computes, a here-document fed to it, or arguments from data given to a program.
 * @param {NonNullable<ReturnType<typeof unwrap>>} u
 * @param {string[]} words
 * @param {boolean} heredoc a here-document or here-string reaches this command's stdin
 * @returns {string | null}
 */
function unseenReason(u, words, heredoc) {
  if (u.kind === 'inline' || (u.kind === 'program' && (u.program === 'sf' || u.program === 'sfdx'))) return null;
  const name = u.kind === 'program' ? u.program : u.kind === 'script' ? u.file : u.what;
  const dyn = DYNAMIC_WORDS.get(words);
  if (words.some((w) => dyn?.has(w))) return `The guard can't see what ${name} will run. Write the command out in full.`;
  if (heredoc) return `The guard can't see what ${name} does with the here-document. Write the command out in full.`;
  const w = words.filter((x) => x !== '');
  const args = u.kind === 'program' ? u.args : w.slice(w.findIndex((x) => baseName(x) === name) + 1);
  const target = unsafeTarget(name, args);
  return target === null ? null : `${name} runs ${target} with arguments the guard can't see. Run the command on each file directly.`;
}

/** Command-like sf/sfdx words anywhere in raw text, used to catch what the parser could not see. */
const SF_TOKEN = /(?:^|[\s;&|(){}`'"=$!<>/])(?:sf|sfdx)\s+[A-Za-z-]/gi;

/** Other ways to start the same CLI (npx @salesforce/cli, node .../sfdx-cli/...). */
const SF_LAUNCHER = /@salesforce\/cli\b|\bsfdx-cli\b/gi;

/**
 * sf mentions in quote-removed words: words that are sf or a pattern that could expand to sf, and
 * sf commands or launchers packed inside one word (sh -c 's''f data query …').
 * @param {string[]} words
 * @param {(w: string) => boolean} [patternIsSf] whether a pattern word may become sf; default couldBeSf
 * @param {number} [depth] how many words deep this is
 */
function sfMentionsInWords(words, patternIsSf = couldBeSf, depth = 0) {
  // Case patterns are matched, not expanded.
  const patterns = NOT_RUN.get(words) === 'case' ? undefined : PATTERN_WORDS.get(words);
  let n = words.filter((w) => isSfWord(w) || (patterns?.has(w) && patternIsSf(w))).length;
  for (const w of words) {
    n += (w.match(SF_TOKEN) ?? []).length + (w.match(SF_LAUNCHER) ?? []).length;
    // A word that is itself a command line (arch zsh -c '/usr/local/bin/s? …') counts what it holds.
    if (/\s/.test(w) && depth < MAX_DEPTH) {
      try {
        n += splitCommands(w).reduce((sum, inner) => sum + sfMentionsInWords(inner, patternIsSf, depth + 1), 0);
      } catch (e) {
        if (!(e instanceof UnreadableShellError)) throw e;
        n++;
      }
    }
  }
  return n;
}

/**
 * True when a command mentions sf in its raw text or in any quote-removed word. Used by the hook
 * to decide whether to block when the guard itself fails.
 * @param {string} command
 */
export function mentionsSfWords(command) {
  if ((command.match(SF_TOKEN) ?? []).length + (command.match(SF_LAUNCHER) ?? []).length > 0) return true;
  try {
    return splitCommands(command).some((words) => sfMentionsInWords(words) > 0);
  } catch (e) {
    if (e instanceof UnreadableShellError) return true;
    throw e;
  }
}

/**
 * Walk one command string. `counter.checked` counts sf/sfdx invocations the walk examined.
 * @param {string} command
 * @param {GuardCtx} ctx
 * @param {number} depth
 *   `counter.unseen` holds the first Ruling L-1 reason, reported after the sf-mention backstop.
 * @param {{ checked: number, words: number, home?: boolean, unseen?: string }} counter
 * @param {boolean} [cdOuter] an outer line runs cd, pushd or popd
 * @param {boolean} [envOuter] an outer line clears or unsets environment variables
 * @param {boolean} [fedOuter] an outer line feeds stdin through a pipe or redirect
 * @param {boolean} [heredocOuter] an outer here-document or here-string reaches this text's stdin
 * @returns {Decision}
 */
function walk(command, ctx, depth, counter, cdOuter = false, envOuter = false, fedOuter = false, heredocOuter = false) {
  if (depth > MAX_DEPTH) return deny('The command nests shells too deeply for the guard to check. Run the sf command directly.');
  const commands = splitCommands(command);
  const units = commands.map((words) => unwrap(words, command));
  // Any cd word on the line (before or after the sf call, behind a wrapper, to keep it simple)
  // means sf may not run in the folder the guard read the default org from. A script that runs
  // cd counts too, since it may be sourced into this shell.
  const cd = cdOuter || commands.some(changesDir);
  const moved = cd || units.some((u) => u?.kind === 'script' && SCRIPT_CHANGES_DIR.test(ctx.readScript(u.file) ?? ''));
  const envChanged = envOuter || commands.some(clearsEnv);
  const reason = moved ? MOVED_REASON : envChanged ? ENV_REASON : null;
  const fed = fedOuter || STDIN_FED.has(commands);
  const sfCtx = { ...ctx, mustNameOrg: reason ?? ctx.mustNameOrg, stdinFed: fed };
  // A here-document piped somewhere on the line may reach any command on it (kept simple).
  const heredocLine = heredocOuter || (HEREDOC_LINE.has(commands) && PIPED_LINE.has(commands));
  for (const [n, words] of commands.entries()) {
    if (setsSfVar(words)) return deny(SF_VAR_REASON);
    if (setsHome(words)) counter.home = true;
    const u = units[n];
    const form = u?.kind === 'program' ? knownSafe(u, words) : false;
    const safe = form === true;
    if (typeof form === 'string') counter.unseen ??= form;
    // Words that are sf (after quote removal) count for the backstop, unless the words are an
    // inline shell text that the nested walk counts itself. A known-safe program's patterns are data.
    if (u?.kind !== 'inline') counter.words += sfMentionsInWords(words, safe ? () => false : couldBeSf);
    if (!u) continue;
    const heredoc = heredocLine || OWN_HEREDOC.has(words);
    if (!safe) counter.unseen ??= unseenReason(u, words, heredoc) ?? undefined;
    if (u.kind === 'inline') {
      const r = walk(u.text, ctx, depth + 1, counter, moved, envChanged, fed, heredoc);
      if (!r.allow) return r;
      continue;
    }
    if (u.kind === 'opaque') {
      if (u.always) return deny(`${u.what} hides the command from the guard. Run the command directly.`);
      if (/\bsf(dx)?\b/i.test(u.text)) return deny(`${u.what} hides the sf command's arguments from the guard. Run the sf command directly.`);
      continue;
    }
    if (u.kind === 'script') {
      if (cd && !path.isAbsolute(u.file) && !u.file.startsWith('~')) {
        return deny(`This line changes folder, so the guard can't tell which ${u.file} runs. Run it without cd on the same line.`);
      }
      const text = ctx.readScript(u.file);
      if (text === null) return deny(`The guard can't read ${u.file} to check it for sf commands. Run the sf commands directly.`);
      if (SCRIPT_RUNS_SF.test(text)) {
        return deny(`${u.file} runs sf commands the guard can't check one by one. Run those sf commands directly.`);
      }
      if (SF_NAME_IN_TEXT.test(text)) return deny(SF_VAR_REASON);
      continue;
    }
    if (u.program === 'sfdx') {
      counter.checked++;
      return deny('Use sf instead of the legacy sfdx command, so the guard can check the target org.');
    }
    if (u.program === 'sf') {
      counter.checked++;
      const r = checkSf(u.args, sfCtx);
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
  /** @type {{ checked: number, words: number, home?: boolean, unseen?: string }} */ const counter = { checked: 0, words: 0 };
  let r;
  try {
    r = walk(command, ctx, 0, counter);
  } catch (e) {
    if (e instanceof UnreadableShellError) return deny(`The guard can't read ${e.message} in this line. Write it out plainly.`);
    throw e;
  }
  if (!r.allow) return r;
  const tokens = (command.match(SF_TOKEN) ?? []).length + (command.match(SF_LAUNCHER) ?? []).length;
  if (tokens > counter.checked || counter.words > counter.checked) {
    return deny('The guard could not find every sf command in this line. Run each sf command on its own, and name files instead of using a wildcard that could match sf.');
  }
  if (counter.home && counter.checked > 0) {
    return deny('Changing HOME or the XDG config and data folders changes where sf finds its orgs, aliases and plugins. Run the sf command without changing them.');
  }
  return counter.unseen ? deny(counter.unseen) : ALLOW;
}

/** @param {unknown[]} values @returns {string[]} the distinct non-empty strings, trimmed */
const distinct = (values) => [...new Set(values.filter((v) => typeof v === 'string' && v.trim()).map((v) => String(v).trim()))];

/**
 * @typedef {{ projectDir: string | null, homeDir: string, readFile: (file: string) => string | null, env?: Record<string, string | undefined>, hub?: boolean }} DefaultOrgSources
 */

/**
 * The default target org (or, with `hub`, the default Dev Hub) in sf's order: the environment,
 * the SFDX project's config, then the config in the home folder. `projectDir` is the SFDX
 * project root; null skips the project config. sf merges the legacy name into the new one in
 * each place (SFDX_DEFAULTUSERNAME into SF_TARGET_ORG, .sfdx/sfdx-config.json into
 * .sf/config.json) and the newer value wins, so when the two disagree in the place that
 * decides, the default can't be trusted: `conflict` says where.
 * @param {DefaultOrgSources} o
 * @returns {{ org: string | null, conflict: 'env' | 'config' | null }}
 */
export function resolveDefaultOrg({ projectDir, homeDir, readFile, env = {}, hub = false }) {
  const names = hub ? ['SF_TARGET_DEV_HUB', 'SFDX_DEFAULTDEVHUBUSERNAME', 'SF_DEFAULTDEVHUBUSERNAME']
    : ['SF_TARGET_ORG', 'SFDX_DEFAULTUSERNAME', 'SF_DEFAULTUSERNAME'];
  const fromEnv = distinct(names.map((n) => env[n]));
  if (fromEnv.length > 1) return { org: null, conflict: 'env' };
  if (fromEnv.length === 1) return { org: fromEnv[0], conflict: null };
  const [key, legacy] = hub ? ['target-dev-hub', 'defaultdevhubusername'] : ['target-org', 'defaultusername'];
  /** @param {string} file @param {string} k */
  const read = (file, k) => {
    const text = readFile(file);
    if (text === null) return null;
    try {
      return JSON.parse(text)?.[k] ?? null;
    } catch {
      return null; // A broken config file is skipped.
    }
  };
  for (const dir of projectDir === null ? [homeDir] : [projectDir, homeDir]) {
    // sf translates legacy keys only in .sfdx/sfdx-config.json, and Org.init reads only the new
    // key, so a legacy key in .sf/config.json is ignored by sf. The guard can't trust a place
    // that holds one, so it counts as a conflict there.
    const sfFile = path.join(dir, '.sf', 'config.json');
    const sfdxFile = path.join(dir, '.sfdx', 'sfdx-config.json');
    if (distinct([read(sfFile, legacy)]).length > 0) return { org: null, conflict: 'config' };
    const values = distinct([read(sfFile, key), read(sfdxFile, key), read(sfdxFile, legacy)]);
    if (values.length > 1) return { org: null, conflict: 'config' };
    if (values.length === 1) return { org: values[0], conflict: null };
  }
  return { org: null, conflict: null };
}

/**
 * The default org from resolveDefaultOrg, or null when there is none or the sources disagree.
 * @param {DefaultOrgSources} o
 * @returns {string | null}
 */
export function readDefaultOrg(o) {
  return resolveDefaultOrg(o).org;
}

/**
 * The nearest folder at or above `dir` that holds sfdx-project.json (where sf reads the project
 * config), or null when there is none.
 * @param {string} dir
 * @param {(file: string) => boolean} exists
 * @returns {string | null}
 */
export function findSfdxProject(dir, exists) {
  let d = path.resolve(dir);
  for (;;) {
    if (exists(path.join(d, 'sfdx-project.json'))) return d;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The username an alias points to, from the sf alias files (~/.sfdx/alias.json, and
 * ~/.sf/alias.json when it exists). These files hold usernames only, no tokens. sf treats a
 * name with no alias entry as a username. Null when the file can't be read or the two disagree.
 * @param {string} alias
 * @param {{ homeDir: string, readFile: (file: string) => string | null }} o
 * @returns {string | null}
 */
export function aliasUsername(alias, { homeDir, readFile }) {
  /** @param {string} file @returns {string | null | undefined} undefined when the file is missing */
  const read = (file) => {
    const text = readFile(file);
    if (text === null) return undefined;
    try {
      const orgs = JSON.parse(text)?.orgs ?? {};
      const u = Object.hasOwn(orgs, alias) ? orgs[alias] : alias;
      return typeof u === 'string' ? u : null;
    } catch {
      return null;
    }
  };
  const main = read(path.join(homeDir, '.sfdx', 'alias.json'));
  const other = read(path.join(homeDir, '.sf', 'alias.json'));
  if (!main || other === null || (other !== undefined && other !== main)) return null;
  return main;
}

/** @typedef {Record<string, { url: string, at: string, username?: string }>} UrlCache */

/**
 * Instance URL for an alias, from a cache that is trusted for one day and only while the alias
 * still points to the username it pointed to when the URL was looked up.
 * @param {string} alias
 * @param {{ cache: UrlCache, now: Date, lookup: (alias: string) => string | null, username?: string | null }} o
 *   username: what the alias points to now; null or missing always looks up
 * @returns {{ url: string | null, cache: UrlCache }} the same cache object when unchanged
 */
export function cachedInstanceUrl(alias, { cache, now, lookup, username = null }) {
  const hit = Object.hasOwn(cache, alias) ? cache[alias] : undefined;
  const fresh = (/** @type {{ at: string }} */ h) => { const age = now.getTime() - Date.parse(h.at); return age >= 0 && age < CACHE_TTL_MS; };
  if (hit && typeof hit.url === 'string' && username !== null && hit.username === username && fresh(hit)) return { url: hit.url, cache };
  const url = lookup(alias);
  if (url === null) return { url: null, cache };
  return { url, cache: { ...cache, [alias]: username === null ? { url, at: now.toISOString() } : { url, at: now.toISOString(), username } } };
}
