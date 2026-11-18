import assert from 'node:assert';
import { describe, it } from 'node:test';
import { RULES, resolveTmuxCommand } from '../../src/lib/lint/rules';
import { ids, lintCommand } from './lint-helpers';

const PROTECTED = { protected_branches: ['staging', 'master'] };
const fires = (rule: string, command: string, config = {}) =>
  ids(lintCommand(command, config)).includes(rule);

describe('git/protected-push: the FR conformance matrix', () => {
  const positive = [
    'git push origin HEAD:refs/heads/staging',
    'git push origin HEAD:staging',
    'git push origin +HEAD:staging',
    'git push origin :staging',
    'git push --delete origin staging',
    'git push --all origin',
    'git push --mirror origin',
    'git push -x origin HEAD:staging',
    'git -C /w push --force origin HEAD:staging',
    'git push origin feature\n git push origin HEAD:staging',
    '# force push\ngit push origin HEAD:staging',
    "bash -c 'git push origin HEAD:master'",
    "ssh deploy@example.com 'git push origin HEAD:master'",
    'echo "$(git push origin HEAD:staging)"',
  ];
  const negative = [
    'echo git push origin HEAD:staging',
    'git -C staging push origin feature',
    'git push master feature',
    'git log --grep push master',
    'git push origin feature',
    'git push origin HEAD:refs/tags/staging',
    // Documented limitation: interpolated destinations are not resolved.
    'git push origin HEAD:${TARGET}',
  ];
  for (const command of positive) {
    it(`fires: ${JSON.stringify(command)}`, () => {
      assert.ok(fires('git/protected-push', command, PROTECTED));
    });
  }
  for (const command of negative) {
    it(`does not fire: ${JSON.stringify(command)}`, () => {
      assert.ok(!fires('git/protected-push', command, PROTECTED));
    });
  }

  it('defaults protected branches to main and master', () => {
    assert.ok(fires('git/protected-push', 'git push origin HEAD:main'));
    assert.ok(!fires('git/protected-push', 'git push origin HEAD:staging'));
  });

  it('reports multi-line commands with the line of the push only', () => {
    const [f] = lintCommand(
      'git push origin feature\ngit push origin HEAD:staging',
      PROTECTED,
    ).filter((x) => x.ruleId === 'git/protected-push');
    assert.match(f.message, /\(line 2\)/);
  });
});

describe('family A command rules', () => {
  it('shell/exit-verbs: top-level exit / logout / exec <cmd> only', () => {
    assert.ok(fires('shell/exit-verbs', 'exit 1'));
    assert.ok(fires('shell/exit-verbs', 'if [ -z "$X" ]; then exit 1; fi'));
    assert.ok(fires('shell/exit-verbs', 'logout'));
    assert.ok(fires('shell/exit-verbs', 'exec bash -l'));
    assert.ok(!fires('shell/exit-verbs', '( exit 1 )'));
    assert.ok(!fires('shell/exit-verbs', 'X=$(exit 3)'));
    assert.ok(!fires('shell/exit-verbs', "bash -c 'exit 1'"));
    assert.ok(!fires('shell/exit-verbs', 'exec >log 2>&1'));
    assert.ok(!fires('shell/exit-verbs', 'echo exit'));
  });

  it('shell/errexit: set -e / -u / -o errexit|nounset / trap EXIT', () => {
    for (const c of [
      'set -e',
      'set -euo pipefail',
      'set -u',
      'set -o errexit',
      'set -o nounset',
      "trap 'rm -f x' EXIT",
    ]) {
      assert.ok(fires('shell/errexit', c), c);
    }
    for (const c of [
      'set +e',
      'set -o pipefail',
      'set -x',
      '( set -e; false )',
      'trap - EXIT',
      "trap 'x' INT",
    ]) {
      assert.ok(!fires('shell/errexit', c), c);
    }
  });

  it('shell/password-on-cmdline: attached values only', () => {
    assert.ok(fires('shell/password-on-cmdline', 'mysql -uroot -psecret db'));
    assert.ok(fires('shell/password-on-cmdline', 'mysqldump --password=x db'));
    assert.ok(fires('shell/password-on-cmdline', 'tool --password=${PASS}'));
    assert.ok(!fires('shell/password-on-cmdline', 'mysql -p db'));
    assert.ok(!fires('shell/password-on-cmdline', 'mysql --password db'));
    assert.ok(!fires('shell/password-on-cmdline', 'ssh -p 22 host'));
  });

  it('tmux/kill-commands: names, aliases, unique prefixes, chained', () => {
    for (const c of [
      'tmux kill-pane -t ops',
      'tmux killp',
      'tmux killw',
      'tmux kill-ser',
      'tmux detach',
      'tmux -L sock kill-session -t ops',
      'tmux new-window \\; kill-pane',
    ]) {
      assert.ok(fires('tmux/kill-commands', c), c);
    }
    for (const c of [
      'tmux kill-s',
      'tmux list-panes',
      'tmux display-message x',
      'echo tmux kill-server',
    ]) {
      assert.ok(!fires('tmux/kill-commands', c), c);
    }
    assert.strictEqual(resolveTmuxCommand('kill-s'), undefined);
    assert.strictEqual(resolveTmuxCommand('det'), 'detach-client');
  });

  it('aws/no-pager: needs --no-cli-pager or AWS_PAGER=""', () => {
    assert.ok(fires('aws/no-pager', 'aws s3 ls'));
    assert.ok(fires('aws/no-pager', 'ACCOUNT=$(aws sts get-caller-identity)'));
    assert.ok(fires('aws/no-pager', 'aws s3 ls --no-cli-pager\naws s3 ls'));
    assert.ok(!fires('aws/no-pager', 'aws s3 ls --no-cli-pager'));
    assert.ok(!fires('aws/no-pager', 'AWS_PAGER="" aws s3 ls'));
    assert.ok(!fires('aws/no-pager', 'aws --version'));
    assert.ok(!fires('aws/no-pager', 'aws configure list'));
  });

  it('var/colon-unresolved: only for variables the operation declares', () => {
    const vars = { CLUSTER: 'web-staging' };
    const hit = (c: string) =>
      ids(lintCommand(c, {}, vars)).includes('var/colon-unresolved');
    assert.ok(hit('kubectl use-context "${CLUSTER:?not set}"'));
    assert.ok(hit('echo ${CLUSTER:-default}'));
    assert.ok(
      hit('echo ${CURRENT_DATE:-today}'),
      'built-ins are substituted too',
    );
    assert.ok(!hit('echo ${CLUSTER}'));
    assert.ok(!hit('kubectl delete "${POD:?no pod found}"'));
  });

  it('analysis/unsupported: once per command, listing the constructs', () => {
    const found = lintCommand('cat <<EOF\nx\nEOF\necho `date`').filter(
      (f) => f.ruleId === 'analysis/unsupported',
    );
    assert.strictEqual(found.length, 1);
    assert.match(found[0].message, /heredoc/);
  });
});

describe('team data lists', () => {
  it('cmd/banned uses the configured message', () => {
    const findings = lintCommand('git add -Av', {
      banned: [{ pattern: 'git add -A', message: 'stage explicit paths' }],
    }).filter((f) => f.ruleId === 'cmd/banned');
    assert.strictEqual(findings.length, 1);
    assert.match(findings[0].message, /stage explicit paths/);
  });

  it('cmd/required-flag names the missing flags, per command line', () => {
    const findings = lintCommand(
      'aws s3 ls --region us-east-1 --no-cli-pager\naws s3 ls --no-cli-pager',
      {
        required: [{ pattern: 'aws *', flags: ['--no-cli-pager', '--region'] }],
      },
    ).filter((f) => f.ruleId === 'cmd/required-flag');
    assert.strictEqual(findings.length, 1);
    assert.match(findings[0].message, /line 2.*missing --region/);
  });
});

describe('severity and registry', () => {
  it('config can turn a rule off or change its severity, never its tier', () => {
    assert.ok(
      !fires('shell/exit-verbs', 'exit 1', {
        rules: { 'shell/exit-verbs': 'off' },
      }),
    );
    const [f] = lintCommand('exit 1', {
      rules: { 'shell/exit-verbs': 'warning' },
    });
    assert.strictEqual(f.severity, 'warning');
    assert.strictEqual(f.tier, 1);
  });

  it('has unique ids, a tier and a description for every rule', () => {
    const seen = new Set<string>();
    for (const rule of RULES) {
      assert.ok(!seen.has(rule.id), `duplicate rule id ${rule.id}`);
      seen.add(rule.id);
      assert.match(rule.id, /^[a-z]+\/[a-z0-9-]+$/);
      assert.ok([1, 2, 3].includes(rule.tier));
      assert.ok(rule.description.length > 10);
    }
  });

  it('tier-3 rules never default to error', () => {
    for (const rule of RULES.filter((r) => r.tier === 3)) {
      assert.notStrictEqual(rule.defaultSeverity, 'error', rule.id);
    }
  });
});
