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
  expect(splitCommands('(cd x && sf org list) > out.txt 2>&1')).toEqual([['cd', 'x'], ['sf', 'org', 'list'], ['2']]);
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
  expect(unwrap(['xargs', 'sf', 'org', 'list'])).toEqual({ kind: 'opaque', what: 'xargs', text: 'sf org list' });
  expect(unwrap(['/usr/bin/git', 'status'])).toEqual({ kind: 'program', program: 'git', args: ['status'] });
});
