import { describe, test, expect } from 'vitest';
import { decide, checkSf, isSandboxUrl, readDefaultOrg, cachedInstanceUrl, CACHE_TTL_MS, findSfdxProject } from '../lib/guard.mjs';

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
    expect(readDefaultOrg({ projectDir: '/p', homeDir: '/h', readFile: cfg, env: { SF_TARGET_ORG: 'prod', SFDX_DEFAULTUSERNAME: 'old' } })).toBe('prod');
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
    allowed('env -i sf data query -q x');
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
