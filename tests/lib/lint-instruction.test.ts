import assert from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { formatJson, lintFile } from '../../src/cli/commands/lint';
import {
  defaultLintConfig,
  type LintConfig,
  LintConfigError,
  readLintConfig,
} from '../../src/lib/lint/config';
import { lintOperation } from '../../src/lib/lint/engine';
import { LINT_REGISTRY } from '../../src/lib/lint/rules';
import type { Operation } from '../../src/models/operation';

const RULE = 'instruction/vague-decision';

/** The shape of a vague sentence seen in a real run (mock wording). */
const VAGUE =
  'Errors during the rollout: surface them right away and consider pausing before the cutover.';

function lint(steps: unknown[], config: Partial<LintConfig> = {}) {
  const operation = {
    name: 'vague',
    version: '1.0.0',
    description: 'x',
    environments: [
      { name: 'staging', description: 's' },
      { name: 'production', description: 'p' },
    ],
    steps,
  } as unknown as Operation;
  return lintOperation(operation, {
    operationFile: join(tmpdir(), 'vague.yaml'),
    config: { ...defaultLintConfig(), ...config },
  }).filter((f) => f.ruleId === RULE);
}

const step = (more: Record<string, unknown>) => ({
  name: 'Watch the rollout',
  type: 'manual',
  ...more,
});

function tempFile(name: string, text: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'samaritan-vague-')), name);
  writeFileSync(file, text);
  return file;
}

describe('instruction/vague-decision', () => {
  it('flags a decision handed to the operator in an instruction', () => {
    const findings = lint([step({ instruction: VAGUE })]);
    assert.strictEqual(findings.length, 2, JSON.stringify(findings));
    assert.match(findings[0].message, /step "Watch the rollout"/);
    assert.match(findings[0].message, /"surface them"/);
    assert.match(findings[1].message, /"consider pausing"/);
    assert.strictEqual(findings[0].severity, 'warning');
    assert.strictEqual(findings[0].tier, 3);
  });

  it('flags consider stopping / aborting, any case', () => {
    assert.strictEqual(
      lint([step({ instruction: 'Consider Stopping the rollout.' })]).length,
      1,
    );
    assert.strictEqual(
      lint([step({ instruction: 'consider aborting' })]).length,
      1,
    );
  });

  it('flags "as needed" / "as appropriate" / "if necessary" next to an action', () => {
    for (const text of [
      'Re-run the health check as needed.',
      'Retry as needed.',
      'Restart the pods as appropriate.',
      'If necessary, roll back the release.',
      'Scale up if necessary',
    ]) {
      assert.strictEqual(lint([step({ instruction: text })]).length, 1, text);
    }
  });

  it('leaves the qualifiers alone without an action on the line', () => {
    for (const text of [
      'The dashboard groups errors as needed by the on-call team.',
      'Tag the release; labels as appropriate are added by CI.',
    ]) {
      assert.deepStrictEqual(lint([step({ instruction: text })]), [], text);
    }
  });

  it('does not read description, command or expect', () => {
    assert.deepStrictEqual(
      lint([
        step({
          description: VAGUE,
          command: 'echo "retry as needed; consider pausing"',
          expect: { contains: 'surface them' },
        }),
      ]),
      [],
    );
  });

  it('passes concrete conditionals', () => {
    for (const text of [
      'If 5xx responses exceed 1% after the switch, ask the web-server owners to redeploy; STOP if they continue for 5 minutes.',
      'STOP only if no one on call has acknowledged the page.',
      'Surface them to the #ops-incident channel with the request id.',
    ]) {
      assert.deepStrictEqual(lint([step({ instruction: text })]), [], text);
    }
  });

  it('skips fenced paste blocks and inline code spans', () => {
    const instruction = [
      'Paste this into the incident channel:',
      '~~~text',
      'Retry as needed; consider pausing if errors repeat.',
      '~~~',
      '```',
      'retry as needed',
      '```',
      'Run `retry --as-needed` as written; STOP if it exits non-zero.',
    ].join('\n');
    assert.deepStrictEqual(lint([step({ instruction })]), []);
  });

  it('checks sub-steps, rollback steps and variants.<env> instructions', () => {
    const findings = lint([
      step({
        instruction: 'Watch the error rate.',
        variants: { production: { instruction: 'Consider pausing.' } },
        sub_steps: [
          { name: 'Child', type: 'manual', instruction: 'Retry as needed.' },
        ],
        rollback: [{ name: 'Undo', instruction: 'Consider aborting.' }],
      }),
    ]);
    const messages = findings.map((f) => f.message).sort();
    assert.strictEqual(messages.length, 3, messages.join('\n'));
    assert.ok(messages.some((m) => m.startsWith('step "Child"')));
    assert.ok(messages.some((m) => m.startsWith('step "Undo"')));
    assert.ok(
      messages.some((m) =>
        m.startsWith('step "Watch the rollout [variants.production]"'),
      ),
    );
  });

  it('adds the team phrases from lint.vague_phrases, word-bounded', () => {
    const config = { vague_phrases: ['use your judgement'] };
    assert.strictEqual(
      lint(
        [step({ instruction: 'Use your judgement on the cutover.' })],
        config,
      ).length,
      1,
    );
    assert.deepStrictEqual(
      lint([step({ instruction: 'Do not misuse your judgement.' })], config),
      [],
    );
  });

  it('is off when the config turns it off', () => {
    assert.deepStrictEqual(
      lint([step({ instruction: VAGUE })], { rules: { [RULE]: 'off' } }),
      [],
    );
  });
});

describe('instruction/vague-decision from a file', () => {
  const OP = `name: Vague decision
version: 1.0.0
description: mock
environments:
  - name: staging
    description: s
steps:
  - name: Watch the rollout
    type: manual
    instruction: |
      Watch the error rate on the dashboard.
      ${VAGUE}
  - name: Described
    type: manual
    description: "${VAGUE}"
    command: echo ok
`;

  it('reports the line inside the instruction and the step in JSON', async () => {
    const file = tempFile('op.yaml', OP);
    writeFileSync(
      join(file, '..', 'samaritan.config.yaml'),
      `lint:\n  rules:\n    ${RULE}: error\n`,
    );
    const result = await lintFile(file);
    const hits = result.findings.filter((f) => f.ruleId === RULE);
    assert.strictEqual(hits.length, 2);
    assert.deepStrictEqual(
      hits.map((f) => f.location?.line),
      [12, 12],
    );
    const json = JSON.parse(formatJson([result]));
    const finding = json.files[0].findings.find(
      (f: { ruleId: string }) => f.ruleId === RULE,
    );
    assert.strictEqual(finding.ruleId, RULE);
    assert.strictEqual(finding.severity, 'error');
    assert.match(finding.message, /step "Watch the rollout" \(line 2\)/);
  });

  it('honours a suppression comment above the instruction', async () => {
    const file = tempFile(
      'op.yaml',
      OP.replace(
        '    instruction: |',
        `    # samaritan-lint-disable-next-line ${RULE} -- reviewed\n    instruction: |`,
      ),
    );
    const result = await lintFile(file);
    assert.deepStrictEqual(
      result.findings.filter((f) => f.ruleId === RULE),
      [],
    );
  });
});

describe('lint.vague_phrases config', () => {
  it('adds up across extends', () => {
    const preset = tempFile(
      'preset.yaml',
      'lint:\n  vague_phrases: [use your judgement]\n',
    );
    const config = tempFile(
      'samaritan.config.yaml',
      `lint:\n  extends: [${preset}]\n  vague_phrases: [if it looks wrong]\n`,
    );
    assert.deepStrictEqual(
      readLintConfig(config, LINT_REGISTRY).vague_phrases,
      ['use your judgement', 'if it looks wrong'],
    );
  });

  it('rejects an empty phrase', () => {
    const config = tempFile(
      'samaritan.config.yaml',
      "lint:\n  vague_phrases: ['']\n",
    );
    assert.throws(() => readLintConfig(config, LINT_REGISTRY), LintConfigError);
  });
});
