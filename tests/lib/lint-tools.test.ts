import assert from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { parseCommands } from '../../src/lib/lint/command-model';
import {
  defaultLintConfig,
  LintConfigError,
  loadLintConfig,
  toolProfile,
} from '../../src/lib/lint/config';
import { lintOperation } from '../../src/lib/lint/engine';
import { BUILTIN_PRESETS, LINT_REGISTRY } from '../../src/lib/lint/rules';
import { BUILTIN_PROFILES } from '../../src/lib/lint/tools/index';
import { verbMatches } from '../../src/lib/lint/tools/match';
import { BUILTIN_TOOLS, ToolRegistry } from '../../src/lib/lint/tools/registry';
import type { Verb } from '../../src/lib/lint/tools/types';
import type { Operation } from '../../src/models/operation';

const cmd = (text: string, tools = BUILTIN_TOOLS) =>
  parseCommands(text, tools.specOf).commands[0];

describe('tool profiles: verb matching', () => {
  const cases: [Verb, string, boolean][] = [
    ['apply', 'kubectl apply -f x.yaml', true],
    ['apply', 'kubectl get pods', false],
    ['rollout restart|undo', 'kubectl rollout undo deploy/web', true],
    ['* create-*', 'aws ec2 create-volume --size 1', true],
    ['* create-*', 'aws ec2 describe-volumes', false],
    ['* *snapshot*', 'aws rds create-db-snapshot --x y', true],
    ['delete pvc|pv', 'kubectl delete pvc/data-0', true],
    ['delete pvc|pv', 'kubectl delete pod web-0', false],
    ['', 'rm file', true],
    ['*', 'crontab', false],
    ['*', 'crontab my.cron', true],
    [{ option: '-r' }, 'crontab -r', true],
    [{ option: '-c', matches: '\\bdrop\\b' }, "psql -c 'DROP TABLE t'", true],
    [{ option: '-c', matches: '\\bdrop\\b' }, "psql -c 'select 1'", false],
    [{ anyOperand: ['FLUSHALL'] }, 'redis-cli flushall', true],
    [{ option: '-l', redirect: true }, 'crontab -l > /tmp/cron.bak', true],
    [{ option: '-l', redirect: true }, 'crontab -l', false],
    [{ verb: 's3 rm', option: '--recursive' }, 'aws s3 rm s3://b/x', false],
  ];
  for (const [verb, text, expected] of cases) {
    it(`${JSON.stringify(verb)} vs ${JSON.stringify(text)} → ${expected}`, () => {
      assert.strictEqual(verbMatches(verb, cmd(text)), expected);
    });
  }
});

describe('tool registry', () => {
  it('describes every built-in program once, with no duplicate verbs', () => {
    const kubectl = BUILTIN_TOOLS.profile('kubectl');
    assert.strictEqual(kubectl, BUILTIN_TOOLS.profile('oc'));
    const again = BUILTIN_TOOLS.with([]).with(BUILTIN_PROFILES.slice(0, 0));
    assert.deepStrictEqual(
      again.profile('kubectl')?.mutating,
      kubectl?.mutating,
    );
    // with() rebuilds from the original list: kubectl+oc is not merged into itself.
    const extended = BUILTIN_TOOLS.with([{ id: 'x', binaries: ['x'] }]);
    assert.deepStrictEqual(
      extended.profile('kubectl')?.mutating,
      kubectl?.mutating,
    );
  });

  it('a team profile extends a built-in one: lists add, unset settings keep', () => {
    const tools = BUILTIN_TOOLS.with([
      toolProfile({
        binaries: ['git'],
        mutating: ['tag'],
        value_options: ['--x'],
      }),
    ]);
    assert.ok(tools.isMutating(cmd('git tag v1', tools)));
    assert.ok(tools.isMutating(cmd('git push origin main', tools)));
    // git's combined short flags survive a profile that does not mention them.
    assert.deepStrictEqual(
      cmd('git add -Av', tools).options.map((o) => o.name),
      ['-A', '-v'],
    );
  });

  it('reads output formats from profiles', () => {
    assert.strictEqual(
      BUILTIN_TOOLS.outputFormat(cmd('kubectl get pod -o json')),
      'json',
    );
    assert.strictEqual(
      BUILTIN_TOOLS.outputFormat(cmd("kubectl get pod -o jsonpath='{.x}'")),
      'jsonpath',
    );
    assert.strictEqual(BUILTIN_TOOLS.outputFormat(cmd('jq -r .x')), 'text');
    assert.strictEqual(BUILTIN_TOOLS.outputFormat(cmd('jq .x')), 'json');
    assert.strictEqual(BUILTIN_TOOLS.outputFormat(cmd('cat x')), undefined);
  });

  it('names resources through generic options, profile options and operands', () => {
    assert.deepStrictEqual(
      BUILTIN_TOOLS.resourceIds(
        cmd('aws rds delete-db-instance --db-instance-identifier db'),
      ),
      ['db'],
    );
    assert.deepStrictEqual(
      BUILTIN_TOOLS.resourceIds(cmd('kubectl delete pvc data-0')),
      ['data-0'],
    );
    assert.deepStrictEqual(
      BUILTIN_TOOLS.resourceIds(cmd('kubectl delete pvc/data-0')),
      ['data-0'],
    );
    const tools = new ToolRegistry([
      toolProfile({ binaries: ['web-ctl'], resource_options: ['--app'] }),
    ]);
    assert.deepStrictEqual(
      tools.resourceIds(cmd('web-ctl purge --app web', tools)),
      ['web'],
    );
  });
});

describe('lint.tools in samaritan.config.yaml', () => {
  function config(yaml: string) {
    const dir = mkdtempSync(join(tmpdir(), 'samaritan-tools-'));
    writeFileSync(join(dir, 'samaritan.config.yaml'), yaml);
    const op = join(dir, 'op.yaml');
    writeFileSync(op, 'name: x\n');
    return { dir, op };
  }

  for (const [yaml, message] of [
    [
      'lint:\n  tools:\n    - mutating: [deploy]\n',
      /required property 'binaries'/,
    ],
    [
      'lint:\n  tools:\n    - binaries: [x]\n      mutate: [deploy]\n',
      /additional properties 'mutate'/,
    ],
    [
      'lint:\n  tools:\n    - binaries: [x]\n      mutating: [{ option: "-c", matches: "(" }]\n',
      /not a valid regex/,
    ],
    [
      'lint:\n  tools:\n    - binaries: [x]\n      value_options: [env]\n',
      /tools/,
    ],
  ] as [string, RegExp][]) {
    it(`rejects ${JSON.stringify(yaml.split('\n').slice(2).join(' ').trim())}`, () => {
      assert.throws(
        () => loadLintConfig(config(yaml).op, LINT_REGISTRY),
        (e: unknown) => e instanceof LintConfigError && message.test(e.message),
      );
    });
  }

  it('tools from a preset and from the file add up', () => {
    const { dir, op } = config(`lint:
  extends: [./team.yaml]
  tools:
    - binaries: [db-ctl]
      deletes_data: [drop]
`);
    writeFileSync(
      join(dir, 'team.yaml'),
      'lint:\n  tools:\n    - binaries: [web-ctl]\n      mutating: [deploy]\n',
    );
    const loaded = loadLintConfig(op, LINT_REGISTRY);
    assert.deepStrictEqual(
      loaded.tools.map((t) => t.binaries),
      [['web-ctl'], ['db-ctl']],
    );
  });
});

describe('a team tool, end to end', () => {
  const config = {
    ...defaultLintConfig(),
    rules: { ...BUILTIN_PRESETS['samaritan:all'] },
    tools: [
      toolProfile({
        binaries: ['web-ctl'],
        value_options: ['--env', '-e'],
        mutating: ['deploy|rollback|scale'],
        backup: ['snapshot create'],
        deletes_data: ['app purge'],
        resource_options: ['--app'],
      }),
    ],
    banned: [{ pattern: 'web-ctl deploy --force' }],
  };
  const lint = (commands: string[]) =>
    lintOperation(
      {
        name: 'x',
        version: '1.0.0',
        description: 'x',
        environments: [{ name: 'staging', description: 's' }],
        variables: {},
        steps: commands.map((command, k) => ({
          name: `S${k}`,
          type: 'manual',
          command,
        })),
      } as unknown as Operation,
      { operationFile: join(tmpdir(), 'x.yaml'), config },
    ).map((f) => f.ruleId);

  it('its verbs drive the state-change and backup rules', () => {
    const found = lint(['web-ctl -e staging deploy --app web']);
    assert.ok(found.includes('flow/mutate-without-verify'));
    assert.ok(found.includes('flow/no-rollback-on-mutate'));
    assert.ok(
      lint(['web-ctl app purge --app web']).includes(
        'flow/backup-before-delete',
      ),
    );
    assert.ok(
      !lint([
        'web-ctl snapshot create --app web',
        'web-ctl app purge --app web',
      ]).includes('flow/backup-before-delete'),
    );
    assert.ok(
      lint([
        'web-ctl snapshot create --app other',
        'web-ctl app purge --app web',
      ]).includes('flow/backup-before-delete'),
      'a snapshot of another app does not count',
    );
  });

  it('its option spec feeds banned patterns, and it is a known program', () => {
    // `-e staging` is an option value, so `deploy` is the first operand.
    assert.ok(
      lint(['web-ctl -e staging deploy --force']).includes('cmd/banned'),
    );
    assert.ok(!lint(['web-ctl status']).includes('cmd/unknown-binary'));
    assert.ok(lint(['web-ctll status']).includes('cmd/unknown-binary'));
  });
});
