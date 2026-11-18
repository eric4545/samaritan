import assert from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { defaultLintConfig, type LintConfig } from '../../src/lib/lint/config';
import { lintOperation } from '../../src/lib/lint/engine';
import { BUILTIN_PRESETS, RULES } from '../../src/lib/lint/rules';
import { isShellcheckAvailable } from '../../src/lib/shell-lint';
import type { Operation } from '../../src/models/operation';
import { parseOperation } from '../../src/operations/parser';

/** Every rule on, at its samaritan:all level. */
const ALL: LintConfig = {
  ...defaultLintConfig(),
  rules: { ...BUILTIN_PRESETS['samaritan:all'] },
  banned: [{ pattern: 'git add -A', message: 'stage explicit paths' }],
  required: [{ pattern: 'kubectl *', flags: ['--context'] }],
  identities: ['alice'],
};

type Sample = { steps: unknown[]; extra?: Record<string, unknown> };
const cmd = (command: string, more: Record<string, unknown> = {}): Sample => ({
  steps: [{ name: 'S', type: 'manual', command, ...more }],
});
const steps = (list: unknown[], extra?: Record<string, unknown>): Sample => ({
  steps: list,
  extra,
});

/** One operation per rule that must make that rule fire. */
const SAMPLES: Record<string, Sample> = {
  'shell/exit-verbs': cmd('exit 1'),
  'shell/errexit': cmd('set -e'),
  'shell/password-on-cmdline': cmd('mysql -psecret'),
  'shell/env-echo': cmd('env | sort'),
  'shell/unguarded-rm-rf': cmd('rm -rf "$DIR/cache"'),
  'tmux/kill-commands': cmd('tmux killp'),
  'tmux/input-injection': cmd('tmux send-keys -t ops ls Enter'),
  'ssh/one-shot': cmd("ssh web.example.com 'uptime'"),
  'curl/require-fail': cmd('curl https://example.com/health'),
  'git/protected-push': cmd('git push origin HEAD:main'),
  'git/explicit-staging': cmd('git add .'),
  'git/no-verify': cmd('git commit --no-verify -m x'),
  'aws/no-pager': cmd('aws s3 ls'),
  'aws/max-results': cmd('aws ec2 describe-instances --max-results 5'),
  'aws/region-required': cmd('aws s3 ls --no-cli-pager'),
  'aws/cli-create-managed': cmd(
    'aws ec2 create-security-group --group-name web',
  ),
  'kubectl/delete-ns': cmd('kubectl delete ns web'),
  'var/colon-unresolved': cmd('echo "${CLUSTER:?}"'),
  'cmd/unknown-binary': cmd('kubeclt get pods'),
  'style/full-width-space': cmd('echo　hi'),
  'cmd/banned': cmd('git add -Av'),
  'cmd/required-flag': cmd('kubectl get pods'),
  'analysis/unsupported': cmd('echo `date`'),
  'flow/forward-var': steps([
    { name: 'A', type: 'manual', command: 'echo ${IMG}' },
    {
      name: 'B',
      type: 'manual',
      command: 'x',
      capture: { IMG: { line: 'last' } },
    },
  ]),
  'flow/unproduced-capture': cmd('x', { expect: { equals_captured: 'NOPE' } }),
  'flow/capture-group-oob': cmd('x', {
    capture: { V: { pattern: 'v(\\d+)', group: 2 } },
  }),
  'flow/session-undeclared': steps(
    [{ name: 'S', type: 'manual', command: 'x', session: 'db' }],
    { sessions: { app: {} } },
  ),
  'flow/mutate-without-verify': steps([
    { name: 'A', type: 'manual', command: 'kubectl apply -f web.yaml' },
    { name: 'B', type: 'manual', command: 'echo done' },
  ]),
  'flow/no-rollback-on-mutate': cmd('kubectl apply -f web.yaml'),
  'flow/sts-before-mutate': cmd(
    'aws ec2 terminate-instances --instance-ids i-1',
  ),
  'flow/wait-after-async': steps([
    {
      name: 'A',
      type: 'manual',
      command: 'aws cloudformation create-stack --stack-name web',
    },
    {
      name: 'B',
      type: 'manual',
      command: 'aws cloudformation describe-stacks --stack-name web',
    },
  ]),
  'flow/backup-before-delete': cmd(
    'aws rds delete-db-instance --db-instance-identifier db',
  ),
  'shell/crontab-mutation': cmd('crontab -r'),
  'flow/restore-after-sed': cmd("sed -i 's/a/b/' config/app.conf"),
  'flow/chmod-600-credentials': cmd('echo "$T" > deploy-token'),
  'flow/checksum-before-exec': steps([
    {
      name: 'A',
      type: 'manual',
      command: 'curl -fsSL -o install.sh https://example.com/install.sh',
    },
    { name: 'B', type: 'manual', command: 'bash install.sh' },
  ]),
  'flow/cwd-lost': steps(
    [
      { name: 'A', type: 'manual', command: 'cd /srv/app', session: 'a' },
      { name: 'B', type: 'manual', command: './deploy.sh', session: 'b' },
    ],
    { sessions: { a: {}, b: {} } },
  ),
  'flow/aws-local-session': steps(
    [{ name: 'S', type: 'manual', command: 'aws s3 ls' }],
    { sessions: { ops: { host: 'bastion.example.com' } } },
  ),
  'expect/contains-vs-matches': cmd('x', { expect: { contains: 'Running.*' } }),
  'expect/json-shape': cmd('kubectl get pod web -o json', {
    expect: { contains: '"phase": "Running"' },
  }),
  'expect/multiline-contains': cmd('x', { expect: { contains: 'a\nb' } }),
  'steps/duplicate-id': steps([
    { id: 'a', name: 'A', type: 'manual' },
    { id: 'a', name: 'B', type: 'manual' },
  ]),
  'expect/invalid-regex': cmd('x', { expect: { matches: '[' } }),
  'expect/redos-prone': cmd('x', { expect: { matches: '(a+)+$' } }),
  'expect/shell-var-never-resolves': cmd('x', {
    expect: { contains: '$SOME_HOST' },
  }),
  'expect/token-from-command': cmd('echo ready', {
    expect: { contains: 'ready' },
  }),
  'expect/bare-number': cmd('x', { expect: { contains: '2' } }),
  'deps/cycle': steps([
    { id: 'a', name: 'A', type: 'manual', needs: ['b'] },
    { id: 'b', name: 'B', type: 'manual', needs: ['a'] },
  ]),
  'deps/self-ref': steps([
    { id: 'a', name: 'A', type: 'manual', needs: ['a'] },
  ]),
  'deps/forward-ref': steps([
    { id: 'a', name: 'A', type: 'manual', needs: ['b'] },
    { id: 'b', name: 'B', type: 'manual' },
  ]),
  'deps/unknown-ref': steps([{ name: 'A', type: 'manual', needs: ['nope'] }]),
  'deps/ambiguous-ref': steps([
    { name: 'X', type: 'manual' },
    { name: 'X', type: 'manual' },
    { name: 'C', type: 'manual', needs: ['X'] },
  ]),
  'deps/sub-step-needs': steps([
    { name: 'A', type: 'manual' },
    {
      name: 'P',
      type: 'manual',
      sub_steps: [{ name: 'Q', type: 'manual', needs: ['A'] }],
    },
  ]),
  'evidence/results': cmd('x', {
    evidence: { results: { nope: [{ type: 'text', content: 'x' }] } },
  }),
  'evidence/no-types': cmd('x', { evidence: { required: true } }),
  'vars/undefined': cmd('echo ${NOPE}'),
  'vars/shadows-builtin': steps([{ name: 'S', type: 'manual' }], {
    common_variables: { CURRENT_DATE: 'x' },
  }),
  'rollback/empty': cmd('x', { rollback: [{ name: 'Nothing' }] }),
  'style/hardcoded-env': cmd('kubectl -n staging get pods --context c'),
  'style/hardcoded-identity': cmd(
    'aws iam get-role --role-arn arn:aws:iam::123456789012:role/web',
  ),
  'shell/shellcheck': cmd('rm -rf $TARGET'),
};

/** Rules whose sample needs a real file (positions, raw YAML). */
const FILE_SAMPLES: Record<string, string> = {
  'compat/discarded-verify': `name: x
version: 1.0.0
description: x
environments: [{ name: staging, description: s }]
steps:
  - name: S
    type: manual
    command: echo ok
    verify:
      command: echo ok
      expect: { contains: ok }
`,
  'lint/invalid-directive': `name: x
version: 1.0.0
description: x
environments: [{ name: staging, description: s }]
steps:
  - name: S
    type: manual
    # samaritan-lint-disable-next-line no/such-rule
    command: echo ok
`,
};

function operationOf(sample: Sample): Operation {
  return {
    name: 'conformance',
    version: '1.0.0',
    description: 'x',
    environments: [
      {
        name: 'staging',
        description: 's',
        variables: { CLUSTER: 'web-staging' },
      },
    ],
    variables: { staging: { CLUSTER: 'web-staging' } },
    ...sample.extra,
    steps: sample.steps,
  } as unknown as Operation;
}

describe('rule conformance: every registered rule has a sample that fires', () => {
  it('covers the whole registry', () => {
    const covered = new Set([
      ...Object.keys(SAMPLES),
      ...Object.keys(FILE_SAMPLES),
    ]);
    const missing = RULES.map((r) => r.id).filter((id) => !covered.has(id));
    assert.deepStrictEqual(missing, [], 'rules without a conformance sample');
  });

  for (const [ruleId, sample] of Object.entries(SAMPLES)) {
    const skip = ruleId === 'shell/shellcheck' && !isShellcheckAvailable();
    it(
      `${ruleId} fires`,
      { skip: skip ? 'shellcheck not installed' : false },
      () => {
        const findings = lintOperation(operationOf(sample), {
          operationFile: join(tmpdir(), 'conformance.yaml'),
          config: ALL,
        });
        assert.ok(
          findings.some((f) => f.ruleId === ruleId),
          `${ruleId} did not fire; got ${findings.map((f) => f.ruleId).join(', ')}`,
        );
      },
    );
  }

  for (const [ruleId, yaml] of Object.entries(FILE_SAMPLES)) {
    it(`${ruleId} fires`, async () => {
      const file = join(
        mkdtempSync(join(tmpdir(), 'samaritan-conf-')),
        'op.yaml',
      );
      writeFileSync(file, yaml);
      const findings = lintOperation(await parseOperation(file), {
        operationFile: file,
        config: ALL,
      });
      assert.ok(
        findings.some((f) => f.ruleId === ruleId),
        ruleId,
      );
    });
  }

  it('the default config keeps opt-in rules off and FR registry rules on', () => {
    const defaults = Object.fromEntries(
      RULES.map((r) => [r.id, r.defaultSeverity]),
    );
    for (const id of [
      'flow/forward-var',
      'flow/unproduced-capture',
      'flow/capture-group-oob',
      'flow/session-undeclared',
      'aws/max-results',
      'aws/cli-create-managed',
    ]) {
      assert.strictEqual(defaults[id], 'error', id);
    }
    for (const id of [
      'cmd/unknown-binary',
      'shell/shellcheck',
      'style/hardcoded-env',
    ]) {
      assert.strictEqual(defaults[id], 'off', id);
    }
  });
});
