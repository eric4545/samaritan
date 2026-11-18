import assert from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  findConfigFile,
  LintConfigError,
  loadLintConfig,
} from '../../src/lib/lint/config';
import { LINT_REGISTRY as RULE_IDS } from '../../src/lib/lint/rules';

function tree(config?: string): { root: string; op: string } {
  const root = mkdtempSync(join(tmpdir(), 'samaritan-lint-config-'));
  mkdirSync(join(root, 'ops', 'web'), { recursive: true });
  const op = join(root, 'ops', 'web', 'op.yaml');
  writeFileSync(op, 'name: x\n');
  if (config !== undefined)
    writeFileSync(join(root, 'samaritan.config.yaml'), config);
  return { root, op };
}

describe('lint config', () => {
  it('finds the nearest samaritan.config.yaml above the operation file', () => {
    const { root, op } = tree('lint: {}\n');
    assert.strictEqual(findConfigFile(op), join(root, 'samaritan.config.yaml'));
    writeFileSync(join(root, 'ops', 'samaritan.config.yaml'), 'lint: {}\n');
    assert.strictEqual(
      findConfigFile(op),
      join(root, 'ops', 'samaritan.config.yaml'),
    );
  });

  it('uses defaults without a file or without a lint: section', () => {
    const none = loadLintConfig(tree().op, RULE_IDS);
    assert.deepStrictEqual(none.protected_branches, ['main', 'master']);
    assert.strictEqual(none.source, undefined);
    const { op } = tree('project:\n  name: x\n');
    assert.deepStrictEqual(loadLintConfig(op, RULE_IDS).rules, {});
  });

  it('reads rules, banned, required and protected_branches', () => {
    const { op } = tree(`lint:
  rules:
    shell/exit-verbs: warning
    aws/no-pager: off
  banned:
    - pattern: 'git add -A'
      message: stage explicit paths
  required:
    - pattern: 'aws *'
      flags: ['--region']
  protected_branches: [staging]
`);
    const config = loadLintConfig(op, RULE_IDS);
    assert.deepStrictEqual(config.rules, {
      'shell/exit-verbs': 'warning',
      'aws/no-pager': 'off',
    });
    assert.strictEqual(config.banned[0].pattern, 'git add -A');
    assert.deepStrictEqual(config.required[0].flags, ['--region']);
    assert.deepStrictEqual(config.protected_branches, ['staging']);
  });

  const rejects: [string, RegExp][] = [
    [
      'lint:\n  rules:\n    no/such-rule: error\n',
      /unknown rule 'no\/such-rule'/,
    ],
    [
      'lint:\n  rules:\n    shell/exit-verbs: warn\n',
      /lint\.rules\.shell\/exit-verbs/,
    ],
    ['lint:\n  presets: [team]\n', /additional properties 'presets'/],
    ['lint:\n  extends: [samaritan:nope]\n', /unknown preset 'samaritan:nope'/],
    [
      'lint:\n  extends: [./missing.yaml]\n',
      /file not found: \.\/missing\.yaml/,
    ],
    ['lint:\n  banned:\n    - pattern: "a && b"\n', /one simple command/],
    [
      'lint:\n  required:\n    - pattern: aws\n      flags: [region]\n',
      /flags/,
    ],
    ['lint: [\n', /cannot read config/],
  ];
  for (const [yaml, message] of rejects) {
    it(`rejects ${JSON.stringify(yaml.split('\n')[1] || yaml)}`, () => {
      const { op } = tree(yaml);
      assert.throws(
        () => loadLintConfig(op, RULE_IDS),
        (e: unknown) => e instanceof LintConfigError && message.test(e.message),
      );
    });
  }

  it('an explicit config path wins and must exist', () => {
    const { root, op } = tree('lint:\n  protected_branches: [a]\n');
    const other = join(root, 'other.yaml');
    writeFileSync(other, 'lint:\n  protected_branches: [b]\n');
    assert.deepStrictEqual(
      loadLintConfig(op, RULE_IDS, other).protected_branches,
      ['b'],
    );
    assert.throws(
      () => loadLintConfig(op, RULE_IDS, join(root, 'missing.yaml')),
      LintConfigError,
    );
  });
});

describe('lint config: extends and profiles', () => {
  it('applies built-in presets, then the file’s own rules', () => {
    const { op } = tree(`lint:
  extends: [samaritan:all]
  rules:
    git/no-verify: warning
`);
    const config = loadLintConfig(op, RULE_IDS);
    assert.strictEqual(config.rules['cmd/unknown-binary'], 'warning');
    assert.strictEqual(config.rules['git/explicit-staging'], 'error');
    assert.strictEqual(config.rules['git/no-verify'], 'warning');
  });

  it('reads a local preset relative to the config, merging lists', () => {
    const { root, op } = tree(`lint:
  extends: [./presets/team.yaml]
  banned:
    - pattern: 'git add -A'
  protected_branches: [release]
`);
    mkdirSync(join(root, 'presets'));
    writeFileSync(
      join(root, 'presets', 'team.yaml'),
      `lint:
  rules:
    aws/region-required: error
  banned:
    - pattern: 'tmux send-keys *'
  protected_branches: [main]
`,
    );
    const config = loadLintConfig(op, RULE_IDS);
    assert.strictEqual(config.rules['aws/region-required'], 'error');
    assert.deepStrictEqual(
      config.banned.map((b) => b.pattern),
      ['tmux send-keys *', 'git add -A'],
    );
    assert.deepStrictEqual(config.protected_branches, ['release']);
  });

  it('accepts a preset file that is a bare lint section', () => {
    const { root, op } = tree('lint:\n  extends: [./bare.yaml]\n');
    writeFileSync(join(root, 'bare.yaml'), 'rules:\n  ssh/one-shot: error\n');
    assert.strictEqual(
      loadLintConfig(op, RULE_IDS).rules['ssh/one-shot'],
      'error',
    );
  });

  it('rejects an extends cycle', () => {
    const { root, op } = tree('lint:\n  extends: [./a.yaml]\n');
    writeFileSync(join(root, 'a.yaml'), 'lint:\n  extends: [./b.yaml]\n');
    writeFileSync(join(root, 'b.yaml'), 'lint:\n  extends: [./a.yaml]\n');
    assert.throws(
      () => loadLintConfig(op, RULE_IDS),
      (e: unknown) =>
        e instanceof LintConfigError && /cycle through/.test(e.message),
    );
  });

  it('applies a profile (lint --strict) under the file, with or without one', () => {
    const none = loadLintConfig(tree().op, RULE_IDS, undefined, [
      'samaritan:strict',
    ]);
    assert.strictEqual(none.rules['deps/unknown-ref'], 'error');
    assert.strictEqual(none.rules['style/hardcoded-env'], 'warning');
    const { op } = tree('lint:\n  rules:\n    deps/unknown-ref: warning\n');
    const config = loadLintConfig(op, RULE_IDS, undefined, [
      'samaritan:strict',
    ]);
    assert.strictEqual(config.rules['deps/unknown-ref'], 'warning');
  });
});
