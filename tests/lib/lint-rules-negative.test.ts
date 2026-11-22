import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { defaultLintConfig, type LintConfig } from '../../src/lib/lint/config';
import { lintOperation } from '../../src/lib/lint/engine';
import { BUILTIN_PRESETS } from '../../src/lib/lint/rules';
import type { Operation } from '../../src/models/operation';

const ALL: LintConfig = {
  ...defaultLintConfig(),
  rules: { ...BUILTIN_PRESETS['samaritan:all'] },
};

function lint(
  steps: unknown[],
  extra: Record<string, unknown> = {},
  config: Partial<LintConfig> = {},
) {
  const operation = {
    name: 'neg',
    version: '1.0.0',
    description: 'x',
    environments: [
      {
        name: 'staging',
        description: 's',
        variables: { DIR: '/srv/a', SESSION: 'app' },
      },
      {
        name: 'production',
        description: 'p',
        variables: { DIR: '/srv/b', SESSION: 'db' },
      },
    ],
    variables: {
      staging: { DIR: '/srv/a', SESSION: 'app' },
      production: { DIR: '/srv/b', SESSION: 'db' },
    },
    ...extra,
    steps,
  } as unknown as Operation;
  return lintOperation(operation, {
    operationFile: join(tmpdir(), 'neg.yaml'),
    config: { ...ALL, ...config },
  });
}
const s = (command: string, more: Record<string, unknown> = {}) => ({
  name: more.name ?? 'S',
  type: 'manual',
  command,
  ...more,
});
const fired = (rule: string, findings: { ruleId: string }[]) =>
  findings.some((f) => f.ruleId === rule);
const silent = (rule: string, steps: unknown[], extra = {}, config = {}) =>
  assert.ok(!fired(rule, lint(steps, extra, config)), `${rule} fired`);

describe('family A: cases that must not fire', () => {
  it('shell/unguarded-rm-rf: guards and SAMARITAN variables', () => {
    silent('shell/unguarded-rm-rf', [s('[ -n "$TMPD" ] && rm -rf "$TMPD/x"')]);
    silent('shell/unguarded-rm-rf', [s('rm -rf "${TMPD:?}/x"')]);
    silent('shell/unguarded-rm-rf', [s('rm -rf ${DIR}/cache')]);
    silent('shell/unguarded-rm-rf', [s('rm -r "$TMPD"')]);
    assert.ok(
      fired('shell/unguarded-rm-rf', lint([s('true && rm -rf "$TMPD"')])),
    );
  });
  it('curl, git, ssh, tmux, env: ordinary uses', () => {
    silent('curl/require-fail', [s('curl -fsSL https://example.com')]);
    silent('git/explicit-staging', [s('git add src/app.ts')]);
    silent('git/no-verify', [s('git commit -am "msg"')]);
    silent('ssh/one-shot', [s('ssh -p 22 web.example.com')]);
    silent('tmux/input-injection', [s('tmux list-panes')]);
    silent('shell/env-echo', [s('env FOO=1 ./run.sh')]);
    silent('shell/env-echo', [s('printenv HOME')]);
  });
  it('aws: allowlisted creates, CloudFormation, region by assignment', () => {
    silent('aws/cli-create-managed', [
      s('aws cloudformation create-stack --stack-name web'),
    ]);
    silent('aws/cli-create-managed', [
      s('aws ec2 create-snapshot --volume-id v'),
    ]);
    silent(
      'aws/cli-create-managed',
      [s('aws sns create-topic --name t')],
      {},
      {
        aws_create_allowlist: ['create-topic'],
      },
    );
    silent('aws/region-required', [s('AWS_REGION=us-east-1 aws s3 ls')]);
    silent('kubectl/delete-ns', [s('kubectl delete pod web-0')]);
  });
});

describe('family B: cases that must not fire', () => {
  it('flow/forward-var: captured earlier, own expect, declared', () => {
    const producer = s('x', { name: 'P', capture: { IMG: { line: 'last' } } });
    silent('flow/forward-var', [producer, s('echo ${IMG}', { name: 'C' })]);
    silent('flow/forward-var', [
      s('x', {
        capture: { IMG: { line: 'last' } },
        expect: { contains: '${IMG}' },
      }),
    ]);
    silent('flow/forward-var', [
      s('echo ${DIR}'),
      s('x', { capture: { DIR: { line: 'last' } } }),
    ]);
  });
  it('flow/unproduced-capture: producer runs where the consumer runs', () => {
    const findings = lint([
      s('x', {
        name: 'P',
        when: ['staging'],
        capture: { IMG: { line: 'last' } },
      }),
      s('echo ${IMG}', { name: 'C' }),
    ]);
    const f = findings.find((x) => x.ruleId === 'flow/unproduced-capture');
    assert.ok(f, 'consumer in both envs, producer only in staging');
    assert.match(f.message, /may not execute in 'production'/);
    silent('flow/unproduced-capture', [
      s('x', {
        name: 'P',
        when: ['staging'],
        capture: { IMG: { line: 'last' } },
      }),
      s('echo ${IMG}', { name: 'C', when: ['staging'] }),
    ]);
  });
  it('flow/capture-group-oob: groups that exist', () => {
    silent('flow/capture-group-oob', [
      s('x', { capture: { V: { pattern: 'v(\\d+)' } } }),
    ]);
    silent('flow/capture-group-oob', [
      s('x', { capture: { V: { pattern: '(?:a)(?<n>b)', group: 1 } } }),
    ]);
    silent('flow/capture-group-oob', [
      s('x', { capture: { V: { pattern: 'ok', group: 0 } } }),
    ]);
  });
  it('flow/session-undeclared: resolved per environment', () => {
    silent('flow/session-undeclared', [s('x', { session: 'app' })], {
      sessions: { app: {} },
    });
    const f = lint([s('x', { session: '${SESSION}' })], {
      sessions: { app: {} },
    }).find((x) => x.ruleId === 'flow/session-undeclared');
    assert.ok(f);
    assert.match(f.message, /`db` in 'production'/);
  });
  it('flow/mutate-without-verify / no-rollback-on-mutate: covered steps', () => {
    silent('flow/mutate-without-verify', [
      s('kubectl apply -f web.yaml'),
      s('kubectl rollout status deploy/web', {
        expect: { contains: 'rolled out' },
      }),
    ]);
    silent('flow/mutate-without-verify', [
      s('kubectl apply -f web.yaml', {
        evidence: { required: true, types: ['text'] },
      }),
    ]);
    silent('flow/no-rollback-on-mutate', [s('kubectl apply -f web.yaml')], {
      rollback: { steps: [{ command: 'kubectl delete -f web.yaml' }] },
    });
    silent('flow/no-rollback-on-mutate', [
      s('kubectl apply -f web.yaml', {
        rollback: [{ command: 'kubectl delete -f web.yaml' }],
      }),
    ]);
    silent('flow/mutate-without-verify', [s('kubectl get pods')]);
  });
  it('flow/sts-before-mutate: distinct "may not execute" finding', () => {
    silent('flow/sts-before-mutate', [
      s('aws sts get-caller-identity'),
      s('aws ec2 terminate-instances --instance-ids i-1'),
    ]);
    const f = lint([
      s('aws sts get-caller-identity', { when: ['staging'] }),
      s('aws ec2 terminate-instances --instance-ids i-1'),
    ]).find((x) => x.ruleId === 'flow/sts-before-mutate');
    assert.ok(f);
    assert.match(f.message, /may not execute in 'production'/);
  });
  it('ordering heuristics: the prerequisite is there', () => {
    silent('flow/wait-after-async', [
      s('aws cloudformation create-stack --stack-name web'),
      s('aws cloudformation wait stack-create-complete --stack-name web'),
      s('aws cloudformation describe-stacks --stack-name web'),
    ]);
    silent('flow/backup-before-delete', [
      s(
        'aws rds create-db-snapshot --db-instance-identifier db --db-snapshot-identifier snap',
      ),
      s('aws rds delete-db-instance --db-instance-identifier db'),
    ]);
    silent('shell/crontab-mutation', [
      s('crontab -l > /tmp/cron.bak'),
      s('crontab -r'),
    ]);
    silent('shell/crontab-mutation', [s('crontab -l')]);
    silent('flow/restore-after-sed', [
      s("sed -i 's/a/b/' config/app.conf"),
      s('git restore config/app.conf'),
    ]);
    silent('flow/restore-after-sed', [s("sed -i 's/a/b/' /tmp/app.conf")]);
    silent('flow/chmod-600-credentials', [
      s('echo "$T" > deploy-token && chmod 600 deploy-token'),
    ]);
    silent('flow/chmod-600-credentials', [
      s('umask 077'),
      s('echo "$T" > deploy-token'),
    ]);
    silent('flow/checksum-before-exec', [
      s('curl -fsSL -o install.sh https://example.com/install.sh'),
      s('sha256sum -c install.sh.sha256'),
      s('bash install.sh'),
    ]);
    silent('flow/aws-local-session', [s('aws s3 ls', { session: 'ops' })], {
      sessions: { ops: { host: 'bastion.example.com' } },
    });
    silent(
      'flow/aws-local-session',
      [s('aws s3 ls', { session: 'tools' })],
      {},
      {
        aws_sessions: ['tools'],
      },
    );
  });
});

describe('family C and style: cases that must not fire', () => {
  it('expect/contains-vs-matches: literal brackets and real regexes', () => {
    silent('expect/contains-vs-matches', [
      s('x', { expect: { contains: '[ERROR]' } }),
    ]);
    silent('expect/contains-vs-matches', [
      s('x', { expect: { matches: '^Running$' } }),
    ]);
    assert.ok(
      fired(
        'expect/contains-vs-matches',
        lint([s('x', { expect: { matches: 'Running' } })]),
      ),
    );
  });
  it('expect/json-shape: jsonpath on JSON, text on text', () => {
    silent('expect/json-shape', [
      s('kubectl get pod web -o json', {
        expect: { jsonpath: '$.status.phase', equals: 'Running' },
      }),
    ]);
    silent('expect/json-shape', [
      s('kubectl get pod web -o json', { expect: { contains: 'Running' } }),
    ]);
    silent('expect/json-shape', [
      s("kubectl get pod web -o jsonpath='{.status.phase}'", {
        expect: { equals: 'Running' },
      }),
    ]);
    assert.ok(
      fired(
        'expect/json-shape',
        lint([
          s("kubectl get pod web -o jsonpath='{.status.phase}'", {
            expect: { jsonpath: '$.x' },
          }),
        ]),
      ),
    );
  });
  it('expect/multiline-contains: a trailing newline is one line', () => {
    silent('expect/multiline-contains', [
      s('x', { expect: { contains: 'ok\n' } }),
    ]);
  });
  it('style rules: variables and image tags', () => {
    silent('style/hardcoded-env', [s('kubectl -n ${NS} get pods')]);
    silent('style/hardcoded-env', [s('kubectl get deploy web-staging')]);
    silent('style/hardcoded-identity', [
      s('docker pull example/web:202601010000'),
    ]);
    silent('vars/undefined', [
      s('x', { name: 'P', capture: { IMG: { line: 'last' } } }),
      s('echo ${IMG}', { name: 'C' }),
    ]);
  });
  it('instruction/vague-decision: concrete conditionals, other fields, pastes', () => {
    silent('instruction/vague-decision', [
      s('echo "retry as needed"', {
        description: 'Consider pausing if errors appear.',
        instruction:
          'If 5xx responses exceed 1% after the switch, ask the web-server owners to redeploy; STOP if they continue for 5 minutes.',
        expect: { contains: 'as needed' },
      }),
      s('x', {
        name: 'T',
        instruction: 'STOP only if no one on call has acknowledged the page.',
      }),
      s('x', {
        name: 'U',
        instruction: 'Paste:\n~~~text\nRetry as needed.\n~~~',
      }),
    ]);
  });
});

describe('compat/unused-field: only fields nothing reads', () => {
  const unused = (steps: unknown[]) =>
    lint(steps).filter((f) => f.ruleId === 'compat/unused-field');

  it('names each unused field once, with what to use instead', () => {
    const found = unused([
      s('echo a', {
        retry: { attempts: 3 },
        manual_override: true,
        manual_instructions: 'do it by hand',
        approval: {
          required: true,
          approvers: ['alice'],
          timeout: '1h',
          jira: { project: 'OPS' },
        },
      }),
    ]);
    const messages = found.map((f) => f.message).join('\n');
    assert.strictEqual(found.length, 6, messages);
    assert.match(messages, /`approval\.jira` is not read/);
    assert.match(messages, /`retry:`[^\n]*`expect\.retry`/);
    assert.match(messages, /`approval\.approvers`[^\n]*`reviewer:`/);
    assert.match(messages, /`manual_instructions`[^\n]*`instruction:`/);
  });

  it('stays quiet for fields that are used', () => {
    assert.deepStrictEqual(
      unused([
        s('echo a', {
          manual_override: false,
          approval: { required: true },
          expect: { contains: 'a', retry: { interval: '5s', max: 3 } },
        }),
      ]),
      [],
    );
  });

  it('names a step `env` (never passed to the command)', () => {
    const found = unused([s('pg_dump app', { env: { PGPASSWORD: 'x' } })]);
    assert.strictEqual(found.length, 1);
    assert.match(
      found[0].message,
      /`env` on a step is not passed to the command/,
    );
  });

  it('checks rollback steps too', () => {
    const found = unused([
      s('echo a', {
        rollback: [{ command: 'echo undo', retry: { attempts: 2 } }],
      }),
    ]);
    assert.strictEqual(found.length, 1);
  });
});

describe('schema/unknown-key: top-level keys samaritan does not read', () => {
  const lintFile = async (yaml: string) => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { parseOperation } = await import('../../src/operations/parser');
    const file = join(mkdtempSync(join(tmpdir(), 'samaritan-key-')), 'op.yaml');
    writeFileSync(file, yaml);
    return lintOperation(await parseOperation(file), {
      operationFile: file,
      config: ALL,
    }).filter((f) => f.ruleId === 'schema/unknown-key');
  };
  const HEAD =
    'name: x\nversion: 1.0.0\ndescription: x\nenvironments: [{ name: staging, description: s }]\nsteps: [echo ok]\n';

  it('names a typo and the key it probably meant', async () => {
    const found = await lintFile(
      `${HEAD}variabels:\n  APP: web\nrolback:\n  steps: [echo undo]\n`,
    );
    assert.deepStrictEqual(
      found.map((f) => f.message),
      [
        'unknown top-level key `variabels` (did you mean `variables`?): samaritan ignores it',
        'unknown top-level key `rolback` (did you mean `rollback`?): samaritan ignores it',
      ],
    );
    assert.strictEqual(found[0].location?.line, 6);
  });

  it('a key unlike any known one gets no suggestion', async () => {
    const found = await lintFile(`${HEAD}owner_team: sre\n`);
    assert.deepStrictEqual(
      found.map((f) => f.message),
      [
        'unknown top-level key `owner_team`: samaritan ignores it. Prefix it with `x-` if it only holds YAML anchors or notes.',
      ],
    );
  });

  it('knows every top-level key the parser reads', async () => {
    const { readFileSync } = await import('node:fs');
    const { OPERATION_TOP_LEVEL_KEYS } = await import(
      '../../src/validation/schema-validator'
    );
    const parser = readFileSync('src/operations/parser.ts', 'utf8');
    const read = new Set(
      [...parser.matchAll(/rawOperation\.([a-z_]+)/g)].map((m) => m[1]),
    );
    assert.deepStrictEqual(
      [...read].filter((k) => !OPERATION_TOP_LEVEL_KEYS.includes(k)),
      [],
      'a key the parser reads would be reported as unknown',
    );
  });

  it('parser-read keys outside the schema are not reported', async () => {
    assert.deepStrictEqual(
      await lintFile(`${HEAD}id: deploy-web\ntags: [web]\nemergency: false\n`),
      [],
    );
  });

  it('stays quiet for known keys and `x-` keys', async () => {
    assert.deepStrictEqual(
      await lintFile(
        `${HEAD}variables: { A: 1 }\nx-anchors:\n  base: &base { a: 1 }\n`,
      ),
      [],
    );
  });
});
