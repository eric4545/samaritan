import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import Ajv from 'ajv';
import { formatJson, lintFile } from '../../src/cli/commands/lint';
import { defaultLintConfig, type LintConfig } from '../../src/lib/lint/config';
import { lintOperation } from '../../src/lib/lint/engine';
import { BUILTIN_PRESETS } from '../../src/lib/lint/rules';
import {
  isShellcheckAvailable,
  lintOperationCommands,
  maskTemplateVars,
} from '../../src/lib/shell-lint';
import { clearRemoteTemplateCache } from '../../src/lib/template-fetcher';
import type { Operation } from '../../src/models/operation';
import { parseOperation } from '../../src/operations/parser';
import { getFixturePath } from '../fixtures/fixtures';

const ALL: LintConfig = {
  ...defaultLintConfig(),
  rules: { ...BUILTIN_PRESETS['samaritan:all'] },
};
const lintSteps = (steps: unknown[], extra: Record<string, unknown> = {}) =>
  lintOperation(
    {
      name: 'x',
      version: '1.0.0',
      description: 'x',
      environments: [{ name: 'staging', description: 's' }],
      variables: {},
      ...extra,
      steps,
    } as unknown as Operation,
    { operationFile: join(tmpdir(), 'x.yaml'), config: ALL },
  );
const s = (
  name: string,
  command: string,
  more: Record<string, unknown> = {},
) => ({
  name,
  type: 'manual',
  command,
  ...more,
});

describe('variants.<env> are linted (shared walker)', () => {
  it('reports a variant command and a variant rollback entry at their lines', async () => {
    const file = getFixturePath('lintVariants');
    const findings = lintOperation(await parseOperation(file), {
      operationFile: file,
      config: defaultLintConfig(),
    });
    const pick = (rule: string) => findings.find((f) => f.ruleId === rule);
    assert.match(
      pick('shell/exit-verbs')?.message ?? '',
      /\[variants\.production\]/,
    );
    assert.deepStrictEqual(pick('shell/exit-verbs')?.location, {
      file,
      line: 22,
      column: 11,
    });
    assert.match(
      pick('tmux/kill-commands')?.message ?? '',
      /Undo in production/,
    );
    assert.deepStrictEqual(pick('tmux/kill-commands')?.location, {
      file,
      line: 25,
      column: 22,
    });
  });

  it(
    'validate --lint runs shellcheck over variant commands too',
    { skip: isShellcheckAvailable() ? false : 'shellcheck not installed' },
    () => {
      const operation = {
        steps: [
          {
            name: 'Base',
            command: 'echo ok',
            variants: { production: { command: 'rm -rf $TARGET' } },
          },
        ],
      } as unknown as Operation;
      const names = lintOperationCommands(operation, 'examples/op.yaml').map(
        (f) => f.stepName,
      );
      assert.deepStrictEqual(names, ['Base [variants.production]']);
    },
  );
});

describe('tier-3 rules associate resource, stack and session identifiers', () => {
  const fired = (rule: string, f: { ruleId: string; message: string }[]) =>
    f.find((x) => x.ruleId === rule);

  it('flow/backup-before-delete: a backup of another resource does not count', () => {
    const other = fired(
      'flow/backup-before-delete',
      lintSteps([
        s(
          'Snapshot',
          'aws rds create-db-snapshot --db-instance-identifier reports --db-snapshot-identifier snap',
        ),
        s(
          'Delete',
          'aws rds delete-db-instance --db-instance-identifier web-db',
        ),
      ]),
    );
    assert.match(other?.message ?? '', /names another resource/);
    assert.ok(
      !fired(
        'flow/backup-before-delete',
        lintSteps([
          s(
            'Snapshot',
            'aws rds create-db-snapshot --db-instance-identifier web-db --db-snapshot-identifier snap',
          ),
          s(
            'Delete',
            'aws rds delete-db-instance --db-instance-identifier web-db',
          ),
        ]),
      ),
    );
  });

  it('flow/wait-after-async: a wait on another stack does not count', () => {
    const f = fired(
      'flow/wait-after-async',
      lintSteps([
        s('Create', 'aws cloudformation create-stack --stack-name web'),
        s(
          'Wait',
          'aws cloudformation wait stack-create-complete --stack-name db',
        ),
        s('Read', 'aws cloudformation describe-stacks --stack-name web'),
      ]),
    );
    assert.ok(f, 'waiting for stack db does not cover stack web');
    assert.ok(
      !fired(
        'flow/wait-after-async',
        lintSteps([
          s('Create', 'aws cloudformation create-stack --stack-name web'),
          s('Read other', 'aws cloudformation describe-stacks --stack-name db'),
        ]),
      ),
      'reading another stack is unrelated',
    );
  });

  it('flow/sts-before-mutate: the check must run in the same session', () => {
    const f = fired(
      'flow/sts-before-mutate',
      lintSteps(
        [
          s('Who am I', 'aws sts get-caller-identity', { session: 'local' }),
          s('Terminate', 'aws ec2 terminate-instances --instance-ids i-1', {
            session: 'ops',
          }),
        ],
        { sessions: { local: {}, ops: {} } },
      ),
    );
    assert.match(f?.message ?? '', /ran in session `local`, not `ops`/);
  });
});

describe('style/hardcoded-identity: admin. accounts', () => {
  it('flags admin.<name>, not admin words', () => {
    const hit = (command: string) =>
      lintSteps([s('S', command)]).some(
        (f) =>
          f.ruleId === 'style/hardcoded-identity' &&
          f.message.includes('admin account'),
      );
    assert.ok(hit('ssh admin.alice@bastion.example.com'));
    assert.ok(!hit('kubectl get clusterrole admin'));
    assert.ok(!hit('curl -f https://admin.example.com/health'));
  });
});

describe('shellcheck sees SAMARITAN placeholders as text', () => {
  it('masks ${NAME} with same-length underscores, keeps shell expansions', () => {
    assert.strictEqual(maskTemplateVars('rm -rf ${DIR}/x'), 'rm -rf ______/x');
    assert.strictEqual(
      maskTemplateVars('echo "${X:?}" $Y ${Z%.txt}'),
      'echo "${X:?}" $Y ${Z%.txt}',
    );
  });

  it(
    'no SC2086 on a placeholder, none on a variable set by an earlier step',
    { skip: isShellcheckAvailable() ? false : 'shellcheck not installed' },
    () => {
      const operation = {
        steps: [
          { name: 'Placeholder', command: 'rm -rf ${DIR}/cache' },
          { name: 'Earlier step', command: 'echo "$pod_name"' },
          { name: 'Real', command: 'rm -rf $TARGET' },
        ],
      } as unknown as Operation;
      const found = lintOperationCommands(operation, 'examples/op.yaml').map(
        (f) => `${f.stepName}:SC${f.code}`,
      );
      assert.deepStrictEqual(found, ['Real:SC2086']);
    },
  );
});

describe('positions inside a remote uses: file', () => {
  it('reports line:col in the fetched file, without fetching again', async () => {
    clearRemoteTemplateCache();
    const url = 'https://example.com/lint-remote-steps.yaml';
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response(
        '- name: Remote step\n  type: manual\n  command: |\n    echo remote\n    exit 1\n',
        { status: 200 },
      );
    };
    try {
      const { mkdtempSync, writeFileSync } = await import('node:fs');
      const file = join(
        mkdtempSync(join(tmpdir(), 'samaritan-remote-')),
        'op.yaml',
      );
      writeFileSync(
        file,
        `name: remote
version: 1.0.0
description: x
environments: [{ name: staging, description: s }]
steps:
  - uses: ${url}
`,
      );
      const findings = lintOperation(await parseOperation(file), {
        operationFile: file,
        config: defaultLintConfig(),
      });
      const exit = findings.find((f) => f.ruleId === 'shell/exit-verbs');
      assert.deepStrictEqual(exit?.location, { file: url, line: 5, column: 5 });
      assert.strictEqual(calls, 1);
    } finally {
      globalThis.fetch = original;
      clearRemoteTemplateCache();
    }
  });
});

describe('lint --format json matches the published schema', () => {
  it('validates against src/schemas/lint-report.schema.json', async () => {
    const schema = JSON.parse(
      readFileSync('src/schemas/lint-report.schema.json', 'utf8'),
    );
    const validate = new Ajv({ allErrors: true }).compile(schema);
    const results = [
      await lintFile(getFixturePath('lintSuppression')),
      await lintFile('no-such-file.yaml'),
    ];
    const report = JSON.parse(formatJson(results));
    assert.ok(validate(report), JSON.stringify(validate.errors));
  });
});
