import { test, expect } from 'vitest';
import { splitCommands, unwrap } from '../lib/guard.mjs';

test('splits on control operators outside quotes', () => {
  expect(splitCommands('cd x && sf org list; git status | head -5 & echo "a && b"')).toEqual([
    ['cd', 'x'], ['sf', 'org', 'list'], ['git', 'status'], ['head', '-5'], ['echo', 'a && b'],
  ]);
});

test('keeps quoted words whole and handles escapes', () => {
  expect(splitCommands(`sf data query -q "SELECT Id FROM Account WHERE Name = 'A;B'" -o uat`)).toEqual([
    ['sf', 'data', 'query', '-q', "SELECT Id FROM Account WHERE Name = 'A;B'", '-o', 'uat'],
  ]);
  expect(splitCommands('echo a\\ b')).toEqual([['echo', 'a b']]);
});

test('subshells and groups split; redirect targets are dropped', () => {
  expect(splitCommands('(cd x && sf org list) > out.txt 2>&1')).toEqual([['cd', 'x'], ['sf', 'org', 'list']]);
  expect(splitCommands('{ sf org list; }')).toEqual([['sf', 'org', 'list']]);
});

test('command substitution is returned as extra commands', () => {
  expect(splitCommands('echo $(sf org list -o prod) `sf alias list`')).toEqual([
    ['echo', '$(…)', '$(…)'], ['sf', 'org', 'list', '-o', 'prod'], ['sf', 'alias', 'list'],
  ]);
});

test('${VAR} stays inside its word', () => {
  expect(splitCommands('sf project deploy start -o ${ORG}')).toEqual([['sf', 'project', 'deploy', 'start', '-o', '${ORG}']]);
});

test('unwrap skips env assignments and pass-through wrappers', () => {
  expect(unwrap(['FOO=1', 'sf', 'org', 'list'])).toEqual({ kind: 'program', program: 'sf', args: ['org', 'list'] });
  expect(unwrap(['env', '-i', 'npx', 'sf', 'org', 'list'])).toEqual({ kind: 'program', program: 'sf', args: ['org', 'list'] });
  expect(unwrap(['time', '/usr/local/bin/sf', 'org', 'list'])).toEqual({ kind: 'program', program: 'sf', args: ['org', 'list'] });
  expect(unwrap(['A=1'])).toBeNull();
});

test('unwrap finds inline shells, eval, scripts and xargs', () => {
  expect(unwrap(['bash', '-c', 'sf org list -o prod'])).toEqual({ kind: 'inline', text: 'sf org list -o prod' });
  expect(unwrap(['eval', 'sf', 'org', 'list'])).toEqual({ kind: 'inline', text: 'sf org list' });
  expect(unwrap(['bash', 'scripts/deploy.sh'])).toEqual({ kind: 'script', file: 'scripts/deploy.sh' });
  expect(unwrap(['./deploy.sh', 'uat'])).toEqual({ kind: 'script', file: './deploy.sh' });
  expect(unwrap(['source', 'env.sh'])).toEqual({ kind: 'script', file: 'env.sh' });
  expect(unwrap(['xargs', 'sf', 'org', 'list'])).toEqual({ kind: 'opaque', what: 'xargs', text: 'sf org list', always: false });
  expect(unwrap(['/usr/bin/git', 'status'])).toEqual({ kind: 'program', program: 'git', args: ['status'] });
});

const SF = ['sf', 'org', 'list', '-o', 'prod'];
const hasSf = (cmd) => splitCommands(cmd).some((w) => unwrap(w)?.kind === 'program' && unwrap(w).program === 'sf');
const sfArgs = (words) => {
  const u = unwrap(words);
  expect(u.kind).toBe('program');
  expect(u.program).toBe('sf');
  expect(u.args.slice(0, 2)).toEqual(['org', 'list']);
};

test('wrapper option values are skipped', () => {
  sfArgs(['sudo', '-u', 'root', ...SF]);
  sfArgs(['nice', '-n', '10', ...SF]);
  sfArgs(['env', '-u', 'X', ...SF]);
  sfArgs(['timeout', '5', ...SF]);
  expect(unwrap(['SF', 'org']).program).toBe('sf');
});

test('exec-style programs are opaque when they mention sf', () => {
  expect(unwrap(['find', '.', '-exec', ...SF, ';'])).toMatchObject({ kind: 'opaque', what: 'find', always: false });
  expect(unwrap(['find', '.', '-name', 'x'])).toMatchObject({ kind: 'program', program: 'find' });
});

test('shell keywords are skipped', () => {
  expect(hasSf('if true; then sf org list -o prod; fi')).toBe(true);
  expect(hasSf('for i in 1; do sf org list -o prod; done')).toBe(true);
  expect(hasSf('! sf org list -o prod')).toBe(true);
  expect(hasSf('while sf org list -o prod; do :; done')).toBe(true);
});

test('process substitution is extracted', () => {
  expect(splitCommands('cat <(sf org list -o prod)')).toContainEqual(SF);
  expect(splitCommands('diff >(sf org list -o prod) x')).toContainEqual(SF);
});

test('${...} with an expansion is scanned for substitutions', () => {
  expect(splitCommands('echo ${X:-$(sf org list -o prod)}')).toContainEqual(SF);
  expect(splitCommands('echo "${X:-$(sf org list -o prod)}"')).toContainEqual(SF);
});

test('substitution scanning respects quotes', () => {
  expect(splitCommands('echo $(echo ")" ; sf org list -o prod)')).toContainEqual(SF);
});

test('comments end the command', () => {
  expect(splitCommands("echo hi # don't\nsf org list -o prod")).toEqual([['echo', 'hi'], SF]);
  expect(splitCommands('echo a#b')).toEqual([['echo', 'a#b']]);
});

test('shell forms: combined flags, script args, stdin, fish', () => {
  expect(unwrap(['bash', '-lc', 'sf org list -o prod'])).toEqual({ kind: 'inline', text: 'sf org list -o prod' });
  expect(unwrap(['bash', 'deploy.sh', '-c', 'x'])).toEqual({ kind: 'script', file: 'deploy.sh' });
  expect(splitCommands('echo "sf org list" | bash').map((w) => unwrap(w))).toContainEqual(
    { kind: 'opaque', what: 'bash reading stdin', text: '', always: true });
  expect(unwrap(['fish', '-c', 'sf org list'])).toEqual({ kind: 'inline', text: 'sf org list' });
});

test('computed program words are opaque', () => {
  const a = unwrap(['$sf', 'org'], "$'sf' org list -o prod");
  expect(a).toMatchObject({ kind: 'opaque', always: false });
  expect(a.text).toContain('sf');
  const b = unwrap(['$S', 'org'], 'S=sf; $S org list');
  expect(b).toMatchObject({ kind: 'opaque', always: false });
  expect(b.text).toContain('sf');
});

test('fd numbers before redirects are dropped', () => {
  expect(splitCommands('sf org list 2>&1')).toEqual([['sf', 'org', 'list']]);
  expect(splitCommands('echo hi 2>/dev/null')).toEqual([['echo', 'hi']]);
});

test('shells, eval and xargs behind wrapper options are unwrapped', () => {
  expect(unwrap(['sudo', '-u', 'root', 'bash', '-c', 'sf org list -o prod'])).toEqual({ kind: 'inline', text: 'sf org list -o prod' });
  expect(unwrap(['nice', '-n', '5', 'eval', 'sf', 'org', 'list'])).toEqual({ kind: 'inline', text: 'sf org list' });
  expect(unwrap(['sudo', '-u', 'root', 'xargs', 'sf', 'org', 'list'])).toEqual(
    { kind: 'opaque', what: 'xargs', text: 'sf org list', always: false });
});

test('brace expansions never hide later commands', () => {
  expect(splitCommands('echo ${#X}; sf org list -o prod')).toContainEqual(SF);
  expect(splitCommands('echo ${#}; sf org list -o prod')).toContainEqual(SF);
  expect(splitCommands('x=(a b); echo ${#x[@]} && sf org list -o prod')).toContainEqual(SF);
  expect(splitCommands('echo ${X:-$(sf org list -o prod)}')).toContainEqual(SF);
});

test('shell options that take a value do not hide -c', () => {
  const inl = (words) => expect(unwrap(words).kind).toBe('inline');
  inl(['bash', '-o', 'pipefail', '-c', 'sf org list -o prod']);
  inl(['bash', '-O', 'extglob', '-c', 'sf org list']);
  inl(['bash', '-e', '-o', 'pipefail', '-c', 'sf org list']);
});

test('more wrappers resume at sf', () => {
  sfArgs(['setsid', ...SF]);
  sfArgs(['doas', ...SF]);
  sfArgs(['flock', '/tmp/l', ...SF]);
});

test('su and script with -c are inline', () => {
  expect(unwrap(['su', '-c', 'sf org list -o prod'])).toEqual({ kind: 'inline', text: 'sf org list -o prod' });
  expect(unwrap(['script', '-q', '-c', 'sf org list', '/dev/null'])).toEqual({ kind: 'inline', text: 'sf org list' });
});

test('scripts behind wrappers are found', () => {
  expect(unwrap(['sudo', '-u', 'root', './deploy.sh'])).toEqual({ kind: 'script', file: './deploy.sh' });
  expect(unwrap(['timeout', '5', './deploy.sh'])).toEqual({ kind: 'script', file: './deploy.sh' });
});
