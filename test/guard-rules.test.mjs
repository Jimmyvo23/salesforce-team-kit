import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decide, checkSf, isSandboxUrl, readDefaultOrg, resolveDefaultOrg, cachedInstanceUrl, CACHE_TTL_MS, findSfdxProject, aliasUsername, globPaths } from '../lib/guard.mjs';

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
    for (const c of ['sf --version', 'sf help', 'sf project deploy start --help', 'sf config set org-api-version=62.0',
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
    blocked('S=sf; $S org list -o prod', /hides the command from the guard/);
    blocked('$EDITOR notes.txt', /hides the command from the guard/);
    blocked('$SFBIN data query -o prod -q x', /hides the command from the guard/);
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
  test('help alone means no org is touched', () => {
    expect(checkSf(['project', 'deploy', 'start', '--help'], ctx())).toEqual({ allow: true });
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
    const cache = { uat: { url: URLS.uat, at: new Date(now.getTime() - 1000).toISOString(), username: 'u@sb.com' } };
    const r = cachedInstanceUrl('uat', { cache, now, username: 'u@sb.com', lookup: () => { throw new Error('should not look up'); } });
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

describe('fix round 1 (Ruling T7-c)', () => {
  test('attached org flag values name an org', () => {
    blocked('sf data query -oprod -q x', /"prod"/);
    blocked('sf data query -o"prod" -q x', /"prod"/);
    blocked("sf data query -o'prod' -q x", /"prod"/);
    blocked('sf org create scratch -vprod -f c.json', /"prod"/);
    blocked('sf data query -o=prod -q x', /"prod"/);
    allowed('sf data query -ouat -q x');
  });

  test('arguments computed at run time are blocked', () => {
    for (const c of ['sf data query $(echo -o prod)', 'sf data query $ARGS', 'sf $ARGS', 'sf data query "$@"',
      'sf data query `cat flags`', 'sf data query -o uat $ARGS']) blocked(c, /at run time/);
  });

  test('default org and alias changes are blocked', () => {
    blocked('sf config set target-org=prod && sf data query -q x', /Changing the default org/);
    blocked('sf config set target-org prod --global', /Changing the default org/);
    blocked('sf config unset target-org', /Changing the default org/);
    blocked('sf alias set uat=prod-user; sf data query -o uat -q x', /manages org aliases/);
    allowed('sf config set org-api-version=62.0');
    allowed('sf config list');
    allowed('sf alias list');
  });

  test('other launchers of the same CLI are blocked', () => {
    blocked('npx --yes @salesforce/cli data query -o prod', /./);
    blocked('node /usr/local/lib/node_modules/@salesforce/cli/bin/run.js data query -o prod', /./);
    blocked('sf.cmd data query -o prod -q x', /"prod"/);
    blocked('s${x}f data query -o prod', /./);
  });

  test('legacy and alias topics are blocked', () => {
    blocked('sf force:org:display -o uat', /access token/);
    blocked('sf deploy metadata quick --job-id 0Af -o uat', /Jimmy deploys/);
    blocked('sf force:auth:web:login', /Jimmy authorises/);
    blocked('sf auth web login', /Jimmy authorises/);
    blocked('sf login org', /Jimmy authorises/);
  });

  test('help counts only when it is the whole request', () => {
    blocked('sf data query -o prod -q "--help"', /"prod"/);
    blocked('sf data query -o prod -- --help', /"prod"/);
    blocked('sf data query -q -h -o prod', /"prod"/);
    allowed('sf project deploy start --help');
    allowed('sf help');
  });

  test('a cache entry from the future is not trusted', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    const cache = { uat: { url: 'stale', at: new Date(now.getTime() + 3600000).toISOString() } };
    const r = cachedInstanceUrl('uat', { cache, now, lookup: () => URLS.uat });
    expect(r.url).toBe(URLS.uat);
  });

  test('script check is case-insensitive', () => {
    blocked('./x.sh', /runs sf commands/, ctx({ readScript: () => '\n  SF org list -o prod\n' }));
  });
});

describe('final fix F-1: the org is found everywhere sf looks', () => {
  test('deprecated org flag aliases name an org, in every form', () => {
    for (const c of ['sf data query -u prod -q "SELECT Id FROM User"', 'sf data query --targetusername prod -q x',
      'sf data query --targetusername=prod -q x', 'sf data query -uprod -q x', 'sf data query -u=prod -q x',
      'sf org create scratch --targetdevhubusername prod -f c.json', 'sf org create scratch --targetdevhubusername=prod -f c.json']) {
      blocked(c, /"prod" is not listed/);
    }
    allowed('sf data query -u uat -q x');
    allowed('sf data query --targetusername=dev -q x');
  });

  test('--flags-dir is blocked in any form', () => {
    for (const c of ['sf data query --flags-dir flags -q x', 'sf data query --flags-dir=flags -q x', 'sf data query -o uat --flags-dir ./f -q x']) {
      blocked(c, /can't read --flags-dir files\. Pass -o <sandbox alias> on the command instead/);
    }
  });

  test('SF_ and SFDX_ variable assignments on the line are blocked', () => {
    for (const c of ['SF_TARGET_ORG=prod sf data query -q "SELECT Id FROM User"', 'env SF_TARGET_ORG=prod sf data query -q x',
      'export SF_TARGET_ORG=prod; sf data query -q x', 'declare -x SF_TARGET_ORG=prod; sf data query -q x',
      'typeset -x SFDX_DEFAULTUSERNAME=prod && sf data query -q x', 'SF_TARGET_ORG=prod; export SF_TARGET_ORG; sf data query -q x',
      'sudo SF_TARGET_ORG=prod sf data query -q x', 'env -i SF_TARGET_DEV_HUB=prod sf org create scratch -f c.json',
      'SF_TARGET_ORG=prod env sf data query -q x', 'bash -c "SF_TARGET_ORG=prod sf data query -q x"',
      'SF_TARGET_ORG+=prod sf data query -q x', ': ${SF_TARGET_ORG:=prod}; export SF_TARGET_ORG; sf data query -q x',
      'sf_target_org=prod sf data query -q x', 'export $(cat .env); sf data query -q x', 'env $(cat .env) sf data query -q x',
      'SF_TARGET_ORG=prod sf data query -o uat -q x']) {
      blocked(c, /Setting SF_\/SFDX_ variables can change the target org\. Pass -o <sandbox alias> instead/);
    }
    allowed('FOO=1 sf data query -o uat -q x');
    allowed('export PATH=/opt/bin:$PATH; sf org list');
    allowed('env PATH=$HOME/bin:$PATH sf data query -o uat -q x');
    allowed('echo $SF_TARGET_ORG');
    allowed('sf data query -o uat -q "SELECT SF_Field__c FROM Account"');
  });

  test('a sourced script that sets SF_ variables is blocked', () => {
    blocked('source env.sh; sf data query -q x', /Setting SF_\/SFDX_ variables/, ctx({ readScript: () => 'export SF_TARGET_ORG=prod\n' }));
  });

  test('changing HOME on a line that runs sf is blocked', () => {
    blocked('HOME=/tmp/h sf data query -o uat -q x', /HOME/);
    blocked('export HOME=/tmp/h; sf data query -o uat -q x', /HOME/);
    allowed('HOME=/tmp/h npm test');
  });

  test('a default Dev Hub must be a listed sandbox too', () => {
    blocked('sf org create scratch -f c.json', /default Dev Hub "prod-hub"/, ctx({ defaultDevHub: () => 'prod-hub' }));
    allowed('sf org create scratch -f c.json', ctx({ defaultDevHub: () => 'dev' }));
    allowed('sf data query -o uat -q x', ctx({ defaultDevHub: () => 'prod-hub' }));
  });
});

describe('final fix F-1: readDefaultOrg reads the environment first', () => {
  const files = (map) => (f) => map[f] ?? null;
  const cfg = files({ '/p/.sf/config.json': '{"target-org":"uat","target-dev-hub":"hub"}' });
  test('SF_TARGET_ORG, then SFDX_DEFAULTUSERNAME, then config', () => {
    expect(readDefaultOrg({ projectDir: '/p', homeDir: '/h', readFile: cfg, env: { SF_TARGET_ORG: 'prod' } })).toBe('prod');
    // Round 2 G-1: SF_ and SFDX_ values that disagree are a conflict, so there is no trusted default.
    expect(readDefaultOrg({ projectDir: '/p', homeDir: '/h', readFile: cfg, env: { SF_TARGET_ORG: 'prod', SFDX_DEFAULTUSERNAME: 'old' } })).toBeNull();
    expect(readDefaultOrg({ projectDir: '/p', homeDir: '/h', readFile: cfg, env: { SFDX_DEFAULTUSERNAME: 'old' } })).toBe('old');
    expect(readDefaultOrg({ projectDir: '/p', homeDir: '/h', readFile: cfg, env: { SF_TARGET_ORG: ' ' } })).toBe('uat');
  });
  test('the dev hub: SF_TARGET_DEV_HUB, then SFDX_DEFAULTDEVHUBUSERNAME, then config', () => {
    expect(readDefaultOrg({ hub: true, projectDir: '/p', homeDir: '/h', readFile: cfg, env: { SF_TARGET_DEV_HUB: 'prod' } })).toBe('prod');
    expect(readDefaultOrg({ hub: true, projectDir: '/p', homeDir: '/h', readFile: cfg, env: { SFDX_DEFAULTDEVHUBUSERNAME: 'old' } })).toBe('old');
    expect(readDefaultOrg({ hub: true, projectDir: '/p', homeDir: '/h', readFile: cfg, env: {} })).toBe('hub');
    expect(readDefaultOrg({ hub: true, projectDir: null, homeDir: '/h', readFile: files({ '/h/.sfdx/sfdx-config.json': '{"defaultdevhubusername":"x"}' }) })).toBe('x');
  });
  test('without an SFDX project only the global config counts', () => {
    expect(readDefaultOrg({ projectDir: null, homeDir: '/h', readFile: files({ '/h/.sf/config.json': '{"target-org":"prod"}' }) })).toBe('prod');
  });
});

describe('final fix F-2: folder changes and scripts', () => {
  test('a line that changes folder needs an explicit org', () => {
    for (const c of ['cd ../other && sf data query -q "SELECT Id FROM User"', 'pushd ../other; sf data query -q x', 'popd; sf data query -q x',
      '(cd ../other && sf data query -q x)', 'cd ../other; bash -c "sf data query -q x"', 'sf data query -q x; cd ..']) {
      blocked(c, /This line changes folder, so pass -o <sandbox alias>\./);
    }
    // unwrap resumes at the script-looking "../other" behind builtin (T6-c), so the reason differs.
    blocked('builtin cd ../other && sf data query -q x', /This line changes folder/);
    for (const c of ['env -C ../other sf data query -q x', 'env --chdir=../other sf data query -q x', 'sudo -D ../other sf data query -q x',
      'env -C /tmp/other sf data query -q x']) {
      blocked(c, /This line changes folder/);
    }
    allowed('env -i sf data query -o uat -q x');
    allowed('cd force-app && sf project deploy start -o uat -m ApexClass:Foo');
    allowed('cd force-app && sf project generate manifest --source-dir .');
  });

  test('a sourced script that changes folder counts as a folder change', () => {
    const c = ctx({ readScript: (f) => (f === 'go.sh' ? 'cd ../other\n' : null) });
    blocked('source go.sh; sf data query -q x', /This line changes folder/, c);
  });

  test('a relative script after cd is blocked; the guard cannot tell which file runs', () => {
    blocked('cd force-app && bash ../x.sh', /changes folder, so the guard can't tell which \.\.\/x\.sh runs/, ctx({ readScript: () => 'echo hi\n' }));
    allowed('cd force-app && bash /opt/tools/x.sh', ctx({ readScript: () => 'echo hi\n' }));
  });

  test('a script the guard cannot read is blocked', () => {
    for (const [c, f] of [['bash missing.sh', 'missing.sh'], ['./missing.sh', './missing.sh'], ['source nothere.sh', 'nothere.sh'], ['bash ~/x.sh', '~/x.sh']]) {
      blocked(c, new RegExp(`The guard can't read ${f.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} to check it for sf commands\\. Run the sf commands directly\\.`));
    }
  });

  test('when the hook says the folder is outside the project, the default org is not used', () => {
    const c = ctx({ mustNameOrg: 'Pass -o <sandbox alias>; this folder is outside the project.' });
    blocked('sf data query -q x', /this folder is outside the project/, c);
    allowed('sf data query -o uat -q x', c);
    allowed('sf --version', c);
  });
});

describe('final fix F-2: findSfdxProject', () => {
  const has = (set) => (f) => set.includes(f);
  test('the nearest folder with sfdx-project.json, from the folder up', () => {
    expect(findSfdxProject('/a/b/c', has(['/a/sfdx-project.json', '/a/b/sfdx-project.json']))).toBe('/a/b');
    expect(findSfdxProject('/a/b/c', has(['/a/b/c/sfdx-project.json']))).toBe('/a/b/c');
    expect(findSfdxProject('/a/b/c', has(['/a/sfdx-project.json']))).toBe('/a');
    expect(findSfdxProject('/a/b/c', has([]))).toBeNull();
  });
});

describe('round 2 G-1: new and legacy config that disagree', () => {
  const files = (map) => (f) => map[f] ?? null;
  const r = (map, o = {}) => resolveDefaultOrg({ projectDir: '/p', homeDir: '/h', readFile: files(map), ...o });
  test('different values in one place are a conflict', () => {
    expect(r({ '/p/.sf/config.json': '{"target-org":"uat"}', '/p/.sfdx/sfdx-config.json': '{"defaultusername":"prod"}' })).toEqual({ org: null, conflict: 'config' });
    expect(r({ '/h/.sf/config.json': '{"target-org":"uat"}', '/h/.sfdx/sfdx-config.json': '{"defaultusername":"prod"}' })).toEqual({ org: null, conflict: 'config' });
    expect(r({ '/p/.sf/config.json': '{"target-dev-hub":"a"}', '/p/.sfdx/sfdx-config.json': '{"defaultdevhubusername":"b"}' }, { hub: true })).toEqual({ org: null, conflict: 'config' });
  });
  test('the same value in both files, or values in different places, are fine', () => {
    expect(r({ '/h/.sf/config.json': '{"target-org":"uat"}', '/h/.sfdx/sfdx-config.json': '{"defaultusername":"uat"}' })).toEqual({ org: 'uat', conflict: null });
    expect(r({ '/p/.sf/config.json': '{"target-org":"uat"}', '/h/.sfdx/sfdx-config.json': '{"defaultusername":"prod"}' })).toEqual({ org: 'uat', conflict: null });
    expect(r({ '/p/.sfdx/sfdx-config.json': '{"defaultusername":"dev"}' })).toEqual({ org: 'dev', conflict: null });
  });
  test('SF_ and SFDX_ variables that disagree are a conflict', () => {
    expect(r({}, { env: { SF_TARGET_ORG: 'uat', SFDX_DEFAULTUSERNAME: 'prod' } })).toEqual({ org: null, conflict: 'env' });
    expect(r({}, { env: { SF_TARGET_DEV_HUB: 'a', SFDX_DEFAULTDEVHUBUSERNAME: 'b' }, hub: true })).toEqual({ org: null, conflict: 'env' });
    expect(r({}, { env: { SF_TARGET_ORG: 'uat', SFDX_DEFAULTUSERNAME: 'uat' } })).toEqual({ org: 'uat', conflict: null });
  });
  test('readDefaultOrg gives null on a conflict', () => {
    expect(readDefaultOrg({ projectDir: '/p', homeDir: '/h', readFile: files({ '/p/.sf/config.json': '{"target-org":"uat"}', '/p/.sfdx/sfdx-config.json': '{"defaultusername":"prod"}' }) })).toBeNull();
  });
});

describe('round 2 G-2: obfuscated sf names behind unknown wrappers', () => {
  test('every word that is sf counts for the backstop', () => {
    blocked('caffeinate "s"f data query -q x -o prod', /"prod"/); // caffeinate is a known wrapper, so sf is checked
    for (const c of ['arch -x86_64 s\\f data query -q x -o prod', "screen -dm s''f data query -q x -o prod",
      'arch -x86_64 /usr/local/bin/s\\f data query -o prod', 'arch sf.cmd data query -o prod', 'grep sf notes.txt', 'bash -c "arch s\\f data query -o prod"']) {
      blocked(c, /could not find every sf command/);
    }
    for (const c of ['echo salesforce', 'git status', 'eval sf org list', 'bash -c "sf org list"', 'sudo -u root sf org list',
      'sf org list && /usr/local/bin/sf project deploy start -o uat']) allowed(c);
  });
});

describe('round 2 G-3: legacy config keys', () => {
  test('setting or unsetting a legacy default org key is blocked', () => {
    for (const c of ['sf config set defaultusername=prod', 'sf config set defaultusername prod', 'sf config set targetusername=prod',
      'sf force:config:set defaultusername=prod', 'sf config set defaultdevhubusername=prod', 'sf config set targetdevhubusername prod',
      'sf config unset defaultusername', 'sf config set DefaultUsername=prod']) blocked(c, /Changing the default org/);
    allowed('sf config set org-api-version=62.0');
  });
});

describe('round 2 G-4: org flag aliases and unknown org-like flags', () => {
  test('aliases from the installed plugins name an org', () => {
    for (const c of ['sf project generate manifest --fromorg prod', 'sf project generate manifest --fromorg=prod',
      'sf package version create -p x --target-hub-org prod', 'sf package version create -p x --target-hub-org=prod',
      'sf package bundle install -b x -o uat --dev-hub-org prod', 'sf package bundle install -b x -o uat --dev-hub-org=prod',
      'sf package bundle install -b x -o uat -d prod', 'sf package bundle install -b x -o uat -dprod',
      'sf agent generate template -s prod --agent-file a.json', 'sf agent generate template -sprod --agent-file a.json']) blocked(c, /"prod" is not listed/);
    allowed('sf project deploy start -o uat -d force-app');
    allowed('sf org create user -o uat -s');
  });
  test('other long flags that mention org, hub or username are blocked unless known', () => {
    for (const [c, f] of [['sf data query -o uat --org-alias prod -q x', '--org-alias'], ['sf data query -q x --hub prod', '--hub'],
      ['sf data query -q x --some-username=a', '--some-username'], ['sf org create scratch -v uat --username a@b.c -f x.json', '--username'],
      ['sf data query -q x --TargetOrg prod', '--TargetOrg']]) {
      blocked(c, new RegExp(`The guard doesn't know the flag ${f}\\. Use -o <sandbox alias> or ask Jimmy\\.`));
    }
    for (const c of ['sf package create -n x -v uat --org-dependent', 'sf package create -n x -v uat --orgdependent',
      'sf org create user -o uat --set-unique-username', 'sf org create user -o uat --setuniqueusername',
      'sf package update -p x -v uat --error-notification-username a@b.c', 'sf package update -p x -v uat --errornotificationusername=a@b.c',
      'sf package push-upgrade schedule -v uat -p x --org-list 00D1,00D2', 'sf package push-upgrade schedule -v uat -p x --org-file orgs.csv',
      'sf org create agent-user -o uat --base-username a@b.c']) allowed(c);
  });
});

describe('round 2 G-5: clearing the environment', () => {
  test('env -i, env -u and changing XDG folders need an explicit org', () => {
    for (const c of ['env -i sf data query -q x', 'env --ignore-environment sf data query -q x', 'env - sf data query -q x',
      'env -u FOO sf data query -q x', 'env --unset=FOO sf data query -q x', 'env -uFOO sf data query -q x', 'sudo env -i sf data query -q x']) {
      blocked(c, /This line changes the environment sf reads\. Pass -o <sandbox alias>\./);
    }
    allowed('env -i sf data query -o uat -q x');
    allowed('env -u FOO sf data query -o uat -q x');
    blocked('unset SF_TARGET_ORG; sf data query -q x', /SF_\/SFDX_ variables/);
    for (const c of ['XDG_CONFIG_HOME=/tmp/h sf data query -q x', 'XDG_DATA_HOME=/tmp/h sf data query -o uat -q x',
      'export XDG_CONFIG_HOME=/tmp/h; sf data query -o uat -q x']) blocked(c, /XDG/);
    allowed('XDG_CONFIG_HOME=/tmp/h npm test');
  });
});

describe('round 3 H-1: grouped short flags', () => {
  const GROUPED = /Write -o <sandbox alias> as its own flag; the guard can't read grouped short flags\./;
  test('an org char inside a short flag group is blocked', () => {
    for (const c of ['sf data query -to prod -q x', 'sf project deploy start -co prod -d force-app', 'sf project deploy start -coprod',
      'sf project deploy start -co=prod', 'sf data query -tu prod -q x', 'sf org create scratch -dv prod -f c.json',
      'sf project deploy pipeline start -ac prod -p P -b main', 'sf package bundle install -b x -o uat -wd prod']) blocked(c, GROUPED);
  });
  test('separate short flags and an attached value after an org char still work', () => {
    allowed('sf data query -o uat -t -q x');
    allowed('sf project deploy start -c -o uat');
    allowed('sf data query -ouat -q x');
    blocked('sf data query -oprod -q x', /"prod" is not listed/);
    allowed('sf apex run test -o uat -w 20 -l RunLocalTests');
  });
});

describe('round 3 H-2: an sf command packed into one word', () => {
  test('sf commands inside a single word count for the backstop', () => {
    for (const c of ["arch -x86_64 sh -c 's''f data query -q x -o prod'", 'env -S "s""f data query -q x -o prod"',
      "printf 's''f data query -q x -o prod' | xargs -0 sh -c", "arch zsh -c 'npx @salesforce/cli data query -o prod'"]) {
      blocked(c, /could not find every sf command/);
    }
    for (const c of ['bash -c "sf org list"', 'eval "sf org list"', 'sudo -u root bash -c "sf data query -o uat -q x"', 'git status']) allowed(c);
  });
});

describe('round 3 H-3: JIT plugin commands', () => {
  test('the DevOps Center org flag names an org', () => {
    for (const c of ['sf project deploy pipeline start -c prod -p P -b main', 'sf project deploy pipeline start -cprod -p P -b main',
      'sf project deploy pipeline validate --devops-center-username prod -p P -b main', 'sf project deploy pipeline report --devops-center-username=prod -i 0Af',
      'sf org create snapshot --sourceorg prod -n x', 'sf org create snapshot --sourceorg=prod -n x']) blocked(c, /"prod" is not listed/);
    allowed('sf project deploy pipeline start -c uat -p P -b main');
  });
  test('pipeline quick deploys are forbidden', () => {
    blocked('sf project deploy pipeline quick -c uat -i 0Af', /Jimmy deploys to production himself/);
  });
  test('org create snapshot also checks the default Dev Hub when no hub flag is given', () => {
    const c = ctx({ defaultDevHub: () => 'prod-hub' });
    blocked('sf org create snapshot -o uat -n x', /default Dev Hub "prod-hub"/, c);
    blocked('sf force:org:snapshot:create -o uat -n x', /default Dev Hub "prod-hub"/, c);
    allowed('sf org create snapshot -o uat -v dev -n x', c);
    allowed('sf org create snapshot -o uat -n x', ctx({ defaultDevHub: () => 'dev' }));
    allowed('sf data query -o uat -q x', c);
  });
  test('--org-type is a known non-org flag', () => {
    allowed('sf devops stage environment add -o uat --org-type Sandbox -n x');
  });
});

describe('round 3 H-4: both key names in both files', () => {
  const files = (map) => (f) => map[f] ?? null;
  const r = (map, o = {}) => resolveDefaultOrg({ projectDir: '/p', homeDir: '/h', readFile: files(map), ...o });
  test('a new-style key in the legacy file counts', () => {
    expect(r({ '/p/.sfdx/sfdx-config.json': '{"target-org":"prod"}', '/h/.sf/config.json': '{"target-org":"uat"}' })).toEqual({ org: 'prod', conflict: null });
    expect(r({ '/p/.sf/config.json': '{"target-org":"uat"}', '/p/.sfdx/sfdx-config.json': '{"target-org":"prod"}' })).toEqual({ org: null, conflict: 'config' });
    expect(r({ '/p/.sf/config.json': '{"defaultusername":"prod"}' })).toEqual({ org: null, conflict: 'config' }); // round 4 J-4
    expect(r({ '/p/.sfdx/sfdx-config.json': '{"target-dev-hub":"hub"}' }, { hub: true })).toEqual({ org: 'hub', conflict: null });
    expect(r({ '/p/.sf/config.json': '{"target-org":"uat","defaultusername":"prod"}' })).toEqual({ org: null, conflict: 'config' });
  });
  test('SF_DEFAULTUSERNAME and SF_DEFAULTDEVHUBUSERNAME count', () => {
    expect(r({}, { env: { SF_DEFAULTUSERNAME: 'prod' } })).toEqual({ org: 'prod', conflict: null });
    expect(r({}, { env: { SF_TARGET_ORG: 'uat', SF_DEFAULTUSERNAME: 'prod' } })).toEqual({ org: null, conflict: 'env' });
    expect(r({}, { env: { SF_DEFAULTDEVHUBUSERNAME: 'hub' }, hub: true })).toEqual({ org: 'hub', conflict: null });
  });
});

describe('round 4 J-1: sf command words in any order', () => {
  test('forbidden commands are blocked in every word order', () => {
    for (const [c, msg] of [
      ['sf set alias uat=someone@prod.com', /aliases/], ['sf unset alias uat', /aliases/],
      ['sf display org -o uat', /access token/], ['sf display:org -o uat', /access token/],
      ['sf deploy project quick -i 0Af -o uat', /Jimmy deploys to production himself/],
      ['sf quick deploy project pipeline -c uat -i 0Af', /Jimmy deploys to production himself/],
      ['sf quick metadata deploy -i 0Af -o uat', /Jimmy deploys to production himself/],
      ['sf open org -o uat -r', /login URL/], ['sf list org --json', /--json/], ['sf web login org', /authorises/],
      ['sf set config target-org prod', /Changing the default org/], ['sf unset config target-org', /Changing the default org/],
      ['sf org force:display -o uat', /access token/],
    ]) blocked(c, msg);
  });
  test('an incomplete command that sf would offer to finish counts as the forbidden one', () => {
    for (const [c, msg] of [['sf display -o uat', /access token/], ['sf alias x=prod', /aliases/], ['sf config target-org=prod', /Changing the default org/],
      ['sf quick -i 0Af -o uat', /Jimmy deploys/]]) blocked(c, msg);
  });
  test('more commands that print tokens or login URLs are blocked', () => {
    for (const c of ['sf org auth show-access-token -o uat', 'sf show-access-token auth org -o uat', 'sf org auth show-sfdx-auth-url -o uat',
      'sf user display -o uat', 'sf force:user:display -o uat', 'sf org display user -o uat']) blocked(c, /token|login URL/);
    blocked('sf force:source:open -o uat -r', /login URL/);
    blocked('sf source open -o uat --url-only', /login URL/);
  });
  test('per-command org flags and the snapshot Dev Hub apply in every word order', () => {
    blocked('sf pipeline deploy project start -c prod -p P -b main', /"prod" is not listed/);
    blocked('sf start pipeline deploy project -cprod -p P -b main', /"prod" is not listed/);
    blocked('sf install bundle package -b x -o uat -d prod', /"prod" is not listed/);
    blocked('sf generate template agent -s prod --agent-file x', /"prod" is not listed/);
    blocked('sf create snapshot org -o uat -n x', /default Dev Hub "prod-hub"/, ctx({ defaultDevHub: () => 'prod-hub' }));
  });
  test('org-free commands pass in any word order', () => {
    const c = ctx({ defaultOrg: () => null });
    for (const s of ['sf list org', 'sf list alias', 'sf alias list', 'sf org list', 'sf get config target-org', 'sf generate manifest project --source-dir force-app',
      'sf generate class apex --name Foo', 'sf help org display']) allowed(s, c);
    allowed('sf query data -o uat -q x');
    allowed('sf deploy start project -c -o uat');
  });
  test('org-free rules match the whole command, so org commands that share their words use the default org', () => {
    const c = ctx({ defaultOrg: () => 'nitro-prod' });
    for (const s of ['sf org list metadata -m ApexClass', 'sf list metadata org -m ApexClass', 'sf update data record -s Account -i 001 --values "Name=x"',
      'sf data update record -s Account -i 001 --values "Name=x"', 'sf version package list', 'sf search data -q x', 'sf org create user config',
      'sf api request rest help']) blocked(s, /"nitro-prod" is not listed/, c);
  });
});

describe('round 4 J-2: shell patterns in words', () => {
  test('a pattern in the command name is opaque', () => {
    for (const c of ['/usr/local/bin/s[f] data query -q x -o prod', '/usr/local/bin/s? data query -q x -o prod', '/usr/local/bin/s* data query -o prod',
      '/usr/local/bin/{sf,x} data query -o prod', '{sf,data,query} -q x -o prod', '/usr/local/bin/s(f) data query -o prod',
      '/usr/local/bin/@(sf) data query -o prod', 'env /usr/local/bin/s? data query -o prod', '=sf data query -q x -o prod']) {
      blocked(c, /hides the command from the guard/);
    }
  });
  test('a pattern that expands to sf counts for the backstop', () => {
    // Round 5 K-1: argument patterns are expanded for real; this expander models a folder holding sf.
    const c = ctx({ expandGlob: (w) => [w.replace(/[^/]*$/, 'sf')] });
    for (const s of ['arch /usr/local/bin/s? data query -o prod', 'arch /usr/local/bin/s[f] data query -o prod', 'arch {s,x}f data query -o prod',
      'arch /usr/local/bin/s{f,x} data query -o prod', 'arch /usr/local/bin/s(f) data query -o prod', 'arch =sf data query -o prod',
      'screen -dm ./bin/sf* data query -o prod', 'arch s{f..g} data query -o prod']) blocked(s, /could not find every sf command/, c);
  });
  test('test brackets, quoted patterns and patterns that cannot be sf pass', () => {
    for (const c of ['[ -f x ] && echo y', '[[ -f x ]] && echo y', "find . -name '*'", 'ls test/*.test.mjs', 'echo "s?"', 'echo s\\?',
      'ls src/{a,b}.ts', 'find . -exec echo {} \\;', 'f() { echo hi; }; f', 'git log --format=%h -n 1']) allowed(c);
  });
});

describe('round 4 J-3: ANSI-C and locale quoting', () => {
  test("$'…' is decoded the way bash does", () => {
    for (const c of ["arch $'s\\x66' data query -q x -o prod", "screen -dm $'s\\x66' data query -q x -o prod", "arch $'\\163f' data query -o prod",
      "arch $'s\\u0066' data query -o prod", "arch $'s\\U00000066' data query -o prod", "arch $'s\\146' data query -o prod"]) {
      blocked(c, /could not find every sf command/);
    }
    blocked("$'s\\x66' data query -q x -o prod", /"prod" is not listed/);
    blocked("sf data query -q x -o $'pr\\x6fd'", /"prod" is not listed/);
    blocked('sf data query -q x -o $"prod"', /"prod" is not listed/);
    allowed("echo $'a\\tb'");
    allowed("sf data query -o $'u\\x61t' -q x");
  });
  test("a $'…' the guard can't decode is blocked", () => {
    for (const c of ["arch $'s\\x66 data query -o prod", "echo $'a\\0b'", "echo $'\\c'"]) blocked(c, /can't read/);
  });
});

describe('round 4 J-4: legacy keys only count in the legacy file', () => {
  const files = (map) => (f) => map[f] ?? null;
  const r = (map, o = {}) => resolveDefaultOrg({ projectDir: '/p', homeDir: '/h', readFile: files(map), ...o });
  test('a legacy key in .sf/config.json is never trusted', () => {
    expect(r({ '/p/.sf/config.json': '{"defaultusername":"uat"}', '/h/.sf/config.json': '{"target-org":"prod"}' })).toEqual({ org: null, conflict: 'config' });
    expect(r({ '/p/.sf/config.json': '{"target-org":"uat","defaultusername":"uat"}' })).toEqual({ org: null, conflict: 'config' });
    expect(r({ '/h/.sf/config.json': '{"defaultdevhubusername":"hub"}' }, { hub: true })).toEqual({ org: null, conflict: 'config' });
  });
  test('both names still count in .sfdx/sfdx-config.json', () => {
    expect(r({ '/p/.sfdx/sfdx-config.json': '{"defaultusername":"dev"}' })).toEqual({ org: 'dev', conflict: null });
    expect(r({ '/p/.sfdx/sfdx-config.json': '{"target-org":"dev"}' })).toEqual({ org: 'dev', conflict: null });
  });
});

describe('round 4 J-5: the cache is keyed by the alias and its username', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  const fresh = new Date(now.getTime() - 1000).toISOString();
  test('a fresh entry for the same username is used', () => {
    const cache = { uat: { url: URLS.uat, at: fresh, username: 'u@sb.com' } };
    expect(cachedInstanceUrl('uat', { cache, now, username: 'u@sb.com', lookup: () => { throw new Error('should not look up'); } })).toEqual({ url: URLS.uat, cache });
  });
  test('a different or unknown username looks up again and stores the new username', () => {
    const cache = { uat: { url: URLS.uat, at: fresh, username: 'u@sb.com' } };
    const r = cachedInstanceUrl('uat', { cache, now, username: 'someone@prod.com', lookup: () => URLS.sneaky });
    expect(r.url).toBe(URLS.sneaky);
    expect(r.cache.uat).toEqual({ url: URLS.sneaky, at: now.toISOString(), username: 'someone@prod.com' });
    expect(cachedInstanceUrl('uat', { cache, now, username: null, lookup: () => URLS.sneaky }).url).toBe(URLS.sneaky);
    expect(cachedInstanceUrl('uat', { cache: { uat: { url: URLS.uat, at: fresh } }, now, username: 'u@sb.com', lookup: () => URLS.sneaky }).url).toBe(URLS.sneaky);
  });
  test('aliasUsername reads the sf alias files', () => {
    const files = (map) => (f) => map[f] ?? null;
    const u = (map) => aliasUsername('uat', { homeDir: '/h', readFile: files(map) });
    expect(u({ '/h/.sfdx/alias.json': '{"orgs":{"uat":"u@sb.com"}}' })).toBe('u@sb.com');
    expect(u({ '/h/.sfdx/alias.json': '{"orgs":{}}' })).toBe('uat');
    expect(u({})).toBeNull();
    expect(u({ '/h/.sfdx/alias.json': '{oops' })).toBeNull();
    expect(u({ '/h/.sfdx/alias.json': '{"orgs":{"uat":"u@sb.com"}}', '/h/.sf/alias.json': '{"orgs":{"uat":"someone@prod.com"}}' })).toBeNull();
    expect(u({ '/h/.sfdx/alias.json': '{"orgs":{"uat":"u@sb.com"}}', '/h/.sf/alias.json': '{"orgs":{"uat":"u@sb.com"}}' })).toBe('u@sb.com');
  });
});

describe('round 4 J-2: pattern groups', () => {
  test('a pattern group that holds a substitution is blocked; arrays still split', () => {
    blocked("ls s($(s''f data query -o prod)|x)", /can't read a pattern group/);
    for (const c of ["arr=($(s''f data query -q x -o prod))", 'arr=($(sf data query -q x -o prod))']) blocked(c, /hides the command|"prod" is not listed/);
    allowed('arr=(a b); echo ok');
  });
});

describe('round 4 J-1: whole command ids catch incomplete commands; doctor --command', () => {
  test('an incomplete login or token command is blocked', () => {
    for (const c of ['sf jwt grant --client-id x --jwt-key-file k --username a@b.c', 'sf sfdx-url login -f auth.txt', 'sf show-access-token -o uat',
      'sf show-user-password -o uat', 'sf accesstoken store']) blocked(c, /authorises|access token, password/);
  });
  test('sf doctor --command is blocked; plain sf doctor is org-free', () => {
    for (const c of ['sf doctor --command "data query -q x -o prod"', 'sf doctor -c "data query"', 'sf doctor --command=x', 'sf doctor -ic x']) blocked(c, /doctor --command/);
    allowed('sf doctor', ctx({ defaultOrg: () => null }));
  });
});

describe('round 4: here-documents, case patterns and patterns packed in a word', () => {
  test('here-document bodies and case patterns are not commands', () => {
    allowed("git commit -m \"$(cat <<'EOF'\nWhy?\n- fix [x] (see notes)\nEOF\n)\"");
    allowed('cat <<-EOF > notes.txt\n\t- item\n\tEOF\necho done');
    allowed("cat << 'EOF'\nWhy? [x] (a|b)\nEOF");
    allowed('echo $((1 << 2)); (( x = 1 << 2 )); echo $[1 << 2]\necho done\n2');
    allowed('case $f in *.js) echo js;; *) echo other;; esac');
  });
  test('what a here-document hides is still found', () => {
    blocked('cat <<EOF\n$(sf data query -q x -o prod)\nEOF', /"prod" is not listed/);
    blocked('cat <<EOF; sf data query -q x -o prod\nbody\nEOF', /"prod" is not listed/);
    blocked("bash <<'EOF'\nsf data query -q x -o prod\nEOF", /hides the command/);
    blocked('(( x = 1 << 2 ))\nx=sf; $x data query -q x -o prod\n2', /computed command name/);
    blocked('echo $[1<<2]\nx=sf; $x data query -q x -o prod\n2]', /computed command name/);
  });
  test('patterns inside a word that is a command line, POSIX classes, and spaces inside command words', () => {
    const c = ctx({ expandGlob: (w) => [w.replace(/[^/]*$/, 'sf')] });
    blocked("arch zsh -c '/usr/local/bin/s? data query -o prod'", /could not find every sf command/, c);
    blocked('arch /usr/local/bin/s[[:alpha:]] data query -o prod', /could not find every sf command/, c);
    blocked('sf display\\ org -o uat', /access token/);
  });
});

const finds = (names) => ({ expandGlob: (w) => names.filter((n) => new RegExp(`^${w.replace(/[.]/g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.')}$`).test(n)) });

describe('round 5 K-1: argument patterns are checked by what they expand to', () => {
  test('everyday patterns pass when nothing they match is sf', () => {
    const c = ctx(finds(['a.txt', 'b.js', 'dist/x.js', 'README.md']));
    for (const s of ['ls *', 'rm -rf dist/*', 'wc -l *.js', 'ls [a-z]*', 'npx vitest run test/*.test.mjs', 'git add force-app/**/*.xml']) allowed(s, c);
  });
  test('a pattern that matches a file named sf is a mention', () => {
    const c = ctx(finds(['sf', 'a.txt']));
    blocked('arch ./s? data query -o prod', /could not find every sf command/, ctx(finds(['./sf'])));
    blocked('ls *', /could not find every sf command/, c);
    blocked('arch s* data query -o prod', /could not find every sf command/, c);
  });
  test('a pattern the guard could not expand is a mention', () => {
    blocked('arch ./s? data query -o prod', /could not find every sf command/, ctx({ expandGlob: () => null }));
  });
  test('braces and zsh =name do not need the file system', () => {
    const c = ctx(finds([]));
    blocked('arch {s,x}f data query -o prod', /could not find every sf command/, c);
    blocked('arch =sf data query -o prod', /could not find every sf command/, c);
    allowed('ls src/{a,b}.ts', c);
  });
  test('a line that changes folder keeps the could-match rule', () => {
    const c = ctx(finds([]));
    blocked('cd x && arch s? data query -o prod', /could not find every sf command/, c);
    blocked('cd dist && ls *', /could not find every sf command/, c);
    allowed('cd dist && ls *.cls', c);
  });
  test('a pattern in the command name is still opaque', () => {
    blocked('/usr/local/bin/s? data query -o prod', /hides the command from the guard/, ctx(finds([])));
  });
});

describe('round 5 K-1: globPaths, the built-in expander', () => {
  test('expands *, ?, [..] and ** against real folders', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sftk-glob-'));
    try {
      fs.mkdirSync(path.join(dir, 'bin', 'deep'), { recursive: true });
      for (const f of ['bin/sf', 'bin/x.txt', 'bin/deep/sfdx.cmd', '.hidden']) fs.writeFileSync(path.join(dir, f), '');
      expect(globPaths('bin/s?', { cwd: dir, homeDir: dir })).toEqual([path.join(dir, 'bin', 'sf')]);
      expect(globPaths('bin/[r-t]f', { cwd: dir, homeDir: dir })).toEqual([path.join(dir, 'bin', 'sf')]);
      expect(globPaths('*', { cwd: dir, homeDir: dir })).toEqual([path.join(dir, 'bin')]);
      expect(globPaths('~/bin/*.txt', { cwd: '/', homeDir: dir })).toEqual([path.join(dir, 'bin', 'x.txt')]);
      expect(globPaths('**/sfdx*', { cwd: dir, homeDir: dir })).toEqual([path.join(dir, 'bin', 'deep', 'sfdx.cmd')]);
      expect(globPaths('nope/*', { cwd: dir, homeDir: dir })).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('round 5 K-2: here-document bodies are data', () => {
  test('bodies are not words', () => {
    const c = ctx(finds(['sf']));
    allowed("git commit -m \"$(cat <<'EOF'\nAdd flow\n\n* bullet one\n* bullet two\nEOF\n)\"", c);
    allowed('cat <<EOF > x.txt\nhello *\nEOF', c);
    allowed("cat <<'EOF' > notes.md\n/usr/local/bin/s? and s\\f are data here\nEOF", c);
  });
  test('the raw backstop, substitutions in unquoted bodies, and shells reading a body still block', () => {
    blocked("cat <<'EOF'\nrun sf data query later\nEOF", /could not find every sf command/);
    blocked("cat <<EOF\n$(s''f data query -q x -o prod)\nEOF", /"prod" is not listed/);
    blocked("bash <<'EOF'\nsf data query -q x -o prod\nEOF", /hides the command/);
    blocked("sh <<EOF\nls\nEOF", /hides the command/);
  });
});

describe('round 5 K-3: an incomplete command sf would finish with a prompt', () => {
  test('incomplete commands with stdin from a pipe or redirect are blocked', () => {
    for (const c of ["printf '\\r' | sf start -c prod -p P -b main", 'sf start -c prod -p P -b main < keys.txt', 'sf start -c prod -p P -b main <<< y',
      "printf '\\r' | bash -c 'sf start -c prod -p P -b main'", "yes | (sf start -c prod -p P -b main)", 'echo $(printf x | sf start -c prod -p P -b main)',
      "printf '\\r' | sf retrieve -o uat"]) blocked(c, /Type the whole sf command/);
    // Whole, so no prompt: sf runs pipeline start, and -c is read as its org.
    blocked("printf '\\r' | sf project deploy start pipeline -c prod -p P -b main", /"prod" is not listed/);
  });
  test('complete commands, in any order, may read stdin or feed a pipe', () => {
    for (const c of ["echo 'System.debug(1);' | sf apex run -o uat", "echo 'System.debug(1);' | sf run apex -o uat", 'sf org list | grep uat',
      'sf data query -o uat -q x | head', 'echo x | sf config get target-org', 'sf force:org:list | cat', 'sf start -c x -o uat']) allowed(c);
  });
});

describe('round 5 K-1: a line that may create files keeps the could-match rule', () => {
  test('files written earlier on the line could be what a pattern matches', () => {
    const c = ctx({ expandGlob: () => [] });
    for (const s of ['printf x > sf; arch s? data query -q x -o prod', 'cp /usr/local/bin/s?? .; arch s? data query -o prod',
      'ln -s /usr/local/bin/sf ./x && arch ./x data query -o prod; arch ./? data query -o prod']) blocked(s, /could not find every sf command/, c);
    allowed('ls *', c);
    allowed('wc -l *.js | sort', c);
    allowed('git add force-app/**/*.xml', c);
  });
});
