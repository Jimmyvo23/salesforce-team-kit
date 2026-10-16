import { describe, test, expect } from 'vitest';
import { decide, checkSf, isSandboxUrl, readDefaultOrg, cachedInstanceUrl, CACHE_TTL_MS } from '../lib/guard.mjs';

const URLS = {
  uat: 'https://acme--uat.sandbox.my.salesforce.com',
  dev: 'https://acme--dev.sandbox.my.salesforce.com',
  sneaky: 'https://acme.my.salesforce.com',
};
const ctx = (o = {}) => ({
  sandboxes: ['uat', 'dev', 'sneaky'],
  defaultOrg: () => 'uat',
  instanceUrl: (a) => URLS[a] ?? null,
  readScript: () => null,
  ...o,
});
const allowed = (cmd, c = ctx()) => expect(decide(cmd, c)).toEqual({ allow: true });
const blocked = (cmd, msg, c = ctx()) => {
  const r = decide(cmd, c);
  expect(r.allow).toBe(false);
  expect(r.reason).toMatch(msg);
};

describe('sandbox URLs', () => {
  test('recognises sandbox domains', () => {
    for (const u of ['https://acme--uat.sandbox.my.salesforce.com', 'https://acme--uat.my.salesforce.com',
      'https://acme--uat.cs42.my.salesforce.com', 'https://cs42.salesforce.com']) expect(isSandboxUrl(u)).toBe(true);
  });
  test('rejects production and junk', () => {
    for (const u of ['https://acme.my.salesforce.com', 'https://na42.salesforce.com', 'https://login.salesforce.com', 'not a url', '']) {
      expect(isSandboxUrl(u)).toBe(false);
    }
  });
});

describe('decide', () => {
  test('non-sf commands pass', () => {
    allowed('git status && npm test');
    allowed('echo salesforce is great');
  });

  test('org-free sf commands pass without a target', () => {
    for (const c of ['sf --version', 'sf help', 'sf project deploy start --help', 'sf config set target-org=prod',
      'sf alias list', 'sf project generate manifest --source-dir force-app', 'sf code-analyzer run --target force-app',
      'sf org list', 'sf apex generate class --name Foo']) allowed(c, ctx({ defaultOrg: () => null }));
  });

  test('a listed sandbox passes', () => {
    allowed('sf project deploy start -o uat -m ApexClass:Foo');
    allowed('sf data query --target-org dev -q "SELECT Id FROM Account"');
    allowed('sf project retrieve start --target-org=uat -m Flow:X');
    allowed('sf project deploy start -m ApexClass:Foo');
  });

  test('an unlisted alias is blocked, with the alias in the reason', () => {
    blocked('sf project deploy start -o prod -m ApexClass:Foo', /"prod" is not listed as a sandbox/);
    blocked('sf data query -o prod -q "SELECT Id FROM User"', /"prod" is not listed/);
  });

  test('the default org is used when no target is given', () => {
    blocked('sf project deploy start -m ApexClass:Foo', /"nitro-prod" is not listed/, ctx({ defaultOrg: () => 'nitro-prod' }));
    blocked('sf data query -q "SELECT Id FROM Account"', /no target org/, ctx({ defaultOrg: () => null }));
  });

  test('a listed alias that points to production is blocked', () => {
    blocked('sf project deploy start -o sneaky', /acme\.my\.salesforce\.com, which is not a sandbox/);
  });

  test('an alias that cannot be looked up is blocked', () => {
    blocked('sf data query -o uat -q x', /could not look up "uat"/, ctx({ instanceUrl: () => null }));
  });

  test('every org flag is checked, including dev hub and from-org', () => {
    blocked('sf org create scratch -v prod -f config.json', /"prod"/);
    blocked('sf project generate manifest --from-org prod', /"prod"/);
  });

  test('always-forbidden commands', () => {
    blocked('sf project deploy quick --job-id 0Af', /Jimmy deploys to production himself/);
    blocked('sf org display -o uat', /access token/);
    blocked('sf org open -o uat --url-only', /session token/);
    blocked('sf org list --json', /access tokens/);
    blocked('sf org login web -a prod', /Jimmy authorises orgs/);
    blocked('sf org logout -o uat', /Jimmy manages org logins/);
    blocked('sfdx force:source:deploy -u prod', /Use sf instead of the legacy sfdx/);
  });

  test('colon topics work like spaces', () => {
    blocked('sf project:deploy:quick --job-id 0Af', /Jimmy deploys/);
  });

  test('chained, substituted and wrapped commands are all checked', () => {
    blocked('npm test && sf project deploy start -o prod', /"prod"/);
    blocked('echo $(sf data query -o prod -q x)', /"prod"/);
    blocked('bash -c "sf project deploy start -o prod"', /"prod"/);
    blocked('eval sf project deploy start -o prod', /"prod"/);
    blocked('env FOO=1 npx sf project deploy start -o prod', /"prod"/);
    allowed('bash -c "sf project deploy start -o uat"');
  });

  test('xargs hides arguments and is blocked when it runs sf', () => {
    blocked('cat aliases.txt | xargs sf org list', /xargs hides/);
    allowed('ls | xargs echo');
  });

  test('scripts that run sf are blocked; other scripts pass', () => {
    const c = ctx({ readScript: (f) => (f === './deploy.sh' ? '#!/bin/bash\nsf project deploy start -o prod\n' : 'echo hi\n') });
    blocked('./deploy.sh', /deploy\.sh runs sf commands/, c);
    allowed('bash build.sh', c);
  });

  test('without a readable team.json, sf org commands are blocked but others pass', () => {
    const c = ctx({ sandboxes: null, teamError: 'team file not found' });
    blocked('sf data query -o uat -q x', /team file not found/, c);
    allowed('sf --version', c);
    allowed('git status', c);
  });

  test('the backstop blocks sf commands the parser could not see', () => {
    blocked('echo sf is great', /could not find every sf command/);
    blocked('git commit -m "run sf org list later"', /could not find every sf command/);
    blocked('ssh build-box sf project deploy start -o prod', /could not find every sf command/);
    blocked('busybox sf org list -o prod', /could not find every sf command/);
    allowed('sf org list && /usr/local/bin/sf project deploy start -o uat');
  });

  test('stdin shells and computed names are blocked', () => {
    blocked('echo "sf org list" | bash', /hides the command from the guard/);
    blocked('S=sf; $S org list -o prod', /hides the sf command's arguments/);
    allowed('$EDITOR notes.txt');
  });

  test('wrappers and keywords reach the sf check', () => {
    blocked('sudo -u root sf project deploy start -o prod', /"prod"/);
    blocked('if true; then sf data query -o prod -q x; fi', /"prod"/);
    blocked('cat <(sf data query -o prod -q x)', /"prod"/);
    blocked('bash -o pipefail -c "sf data query -o prod -q x"', /"prod"/);
    allowed('timeout 60 sf project deploy start -o uat');
  });

  test('deep nesting is refused', () => {
    let cmd = 'sf org list -o uat';
    for (let k = 0; k < 5; k++) cmd = `bash -c ${JSON.stringify(cmd)}`;
    blocked(cmd, /nests shells too deeply/);
  });
});

describe('checkSf', () => {
  test('help anywhere means no org is touched', () => {
    expect(checkSf(['project', 'deploy', 'start', '-o', 'prod', '--help'], ctx())).toEqual({ allow: true });
  });
});

describe('readDefaultOrg', () => {
  const files = (map) => (f) => map[f] ?? null;
  test('project .sf config wins', () => {
    expect(readDefaultOrg({ projectDir: '/p', homeDir: '/h', readFile: files({
      '/p/.sf/config.json': '{"target-org":"uat"}', '/h/.sf/config.json': '{"target-org":"prod"}' }) })).toBe('uat');
  });
  test('falls back to legacy project config, then the home configs', () => {
    expect(readDefaultOrg({ projectDir: '/p', homeDir: '/h', readFile: files({ '/p/.sfdx/sfdx-config.json': '{"defaultusername":"dev"}' }) })).toBe('dev');
    expect(readDefaultOrg({ projectDir: '/p', homeDir: '/h', readFile: files({ '/h/.sf/config.json': '{"target-org":"prod"}' }) })).toBe('prod');
    expect(readDefaultOrg({ projectDir: '/p', homeDir: '/h', readFile: files({ '/h/.sfdx/sfdx-config.json': '{"defaultusername":"x"}' }) })).toBe('x');
  });
  test('broken or empty configs are skipped; none means null', () => {
    expect(readDefaultOrg({ projectDir: '/p', homeDir: '/h', readFile: files({ '/p/.sf/config.json': '{oops', '/h/.sf/config.json': '{"target-org":" "}' }) })).toBeNull();
  });
});

describe('cachedInstanceUrl', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  test('uses a fresh cache entry without looking up', () => {
    const cache = { uat: { url: URLS.uat, at: new Date(now.getTime() - 1000).toISOString() } };
    const r = cachedInstanceUrl('uat', { cache, now, lookup: () => { throw new Error('should not look up'); } });
    expect(r).toEqual({ url: URLS.uat, cache });
  });
  test('looks up when missing or older than a day, and returns a new cache', () => {
    const cache = { uat: { url: 'old', at: new Date(now.getTime() - CACHE_TTL_MS - 1).toISOString() } };
    const r = cachedInstanceUrl('uat', { cache, now, lookup: () => URLS.uat });
    expect(r.url).toBe(URLS.uat);
    expect(r.cache).not.toBe(cache);
    expect(r.cache.uat).toEqual({ url: URLS.uat, at: now.toISOString() });
  });
  test('a failed lookup returns null and leaves the cache alone', () => {
    const cache = {};
    expect(cachedInstanceUrl('x', { cache, now, lookup: () => null })).toEqual({ url: null, cache });
  });
});
