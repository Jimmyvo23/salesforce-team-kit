// @ts-check
// Decision logic for the org guard (hooks/guard-org.mjs). Pure functions: all I/O comes in
// through the GuardCtx functions, so every rule can be tested without Salesforce.

/** @param {string} w */
const baseName = (w) => (w.includes('/') ? w.split('/').filter(Boolean).pop() || w : w);

/**
 * Index just after the ")" that closes a substitution whose body starts at `from`.
 * Parentheses inside quotes or after a backslash do not count.
 * @param {string} s
 * @param {number} from
 */
function substEnd(s, from) {
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
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
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
    if (c === '$' && command[i + 1] === '{' && /^\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(command.slice(i))) {
      const j = command.indexOf('}', i);
      const end = j === -1 ? command.length - 1 : j;
      word += command.slice(i, end + 1);
      inWord = true;
      i = end;
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
  return isSf(x) || SHELLS.has(b) || INTERPRETERS.has(b) || PASS_THROUGH.has(b);
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
    if (/[$`]/.test(w[0])) return { kind: 'opaque', what: 'a computed command name', text: fullText, always: false };
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
      const first = rest.findIndex((x) => !x.startsWith('-'));
      const opts = first === -1 ? rest : rest.slice(0, first);
      const c = opts.findIndex((x) => /^-[A-Za-z]*c[A-Za-z]*$/.test(x));
      if (c !== -1) return { kind: 'inline', text: rest[c + 1] ?? '' };
      if (first !== -1) return { kind: 'script', file: rest[first] };
      return { kind: 'opaque', what: `${prog} reading stdin`, text: '', always: true };
    }
    if (prog === 'source' || prog === '.') return w[1] ? { kind: 'script', file: w[1] } : null;
    if (prog === 'xargs') return { kind: 'opaque', what: 'xargs', text: w.slice(1).join(' '), always: false };
    if (EXEC_STYLE.has(prog) && w.slice(1).some(isSf)) {
      return { kind: 'opaque', what: prog, text: w.slice(1).join(' '), always: false };
    }
    const lower = prog.toLowerCase();
    const sfLike = lower === 'sf' || lower === 'sfdx';
    if (!sfLike && SCRIPT_FILE.test(w[0])) return { kind: 'script', file: w[0] };
    return { kind: 'program', program: sfLike ? lower : prog, args: w.slice(1) };
  }
}
