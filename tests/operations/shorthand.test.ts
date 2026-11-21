import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { parseOperation } from '../../src/operations/parser';
import { getStepSource } from '../../src/operations/step-source';
import { validateOperationSchema } from '../../src/validation/schema-validator';

/**
 * YAML shorthands: a step written as a bare command, `type` left out
 * (`manual`), and `when:` as one environment name. Each parses to EXACTLY the
 * operation its long form parses to, so manuals, the run loop and reports
 * see no difference. Every long form stays valid.
 */

const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function write(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'samaritan-shorthand-'));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), body);
  }
  return dir;
}

const HEAD = `name: Shorthand
version: 1.0.0
environments:
  - name: staging
  - name: production
`;

const SHORT = `${HEAD}steps:
  - kubectl get pods -n web
  - |
    kubectl rollout status deployment/web-server -n web
    kubectl get deployment web-server -n web
  - name: Scale web-server
    command: kubectl scale deployment web-server -n web --replicas=3
    when: production
    rollback:
      - kubectl scale deployment web-server -n web --replicas=2
  - name: Checks
    sub_steps:
      - curl -fsS https://web-server.example.com/health
rollback:
  steps:
    - kubectl rollout undo deployment/web-server -n web
`;

const LONG = `${HEAD}steps:
  - name: kubectl get pods -n web
    type: manual
    command: kubectl get pods -n web
  - name: kubectl rollout status deployment/web-server -n web
    type: manual
    command: |
      kubectl rollout status deployment/web-server -n web
      kubectl get deployment web-server -n web
  - name: Scale web-server
    type: manual
    command: kubectl scale deployment web-server -n web --replicas=3
    when: [production]
    rollback:
      - command: kubectl scale deployment web-server -n web --replicas=2
  - name: Checks
    type: manual
    sub_steps:
      - name: curl -fsS https://web-server.example.com/health
        type: manual
        command: curl -fsS https://web-server.example.com/health
rollback:
  steps:
    - command: kubectl rollout undo deployment/web-server -n web
`;

describe('YAML shorthands', () => {
  it('parse to the same steps and rollback as the long form', async () => {
    const dir = write({ 'short.yaml': SHORT, 'long.yaml': LONG });
    const short = await parseOperation(join(dir, 'short.yaml'));
    const long = await parseOperation(join(dir, 'long.yaml'));
    assert.deepStrictEqual(short.steps, long.steps);
    assert.deepStrictEqual(short.rollback, long.rollback);
  });

  it('are valid against the published schema (editors use it)', () => {
    // The schema accepts the raw shorthand, not only the parser.
    const yaml = require('js-yaml') as typeof import('js-yaml');
    assert.deepStrictEqual(validateOperationSchema(yaml.load(SHORT)), []);
    assert.deepStrictEqual(validateOperationSchema(yaml.load(LONG)), []);
  });

  it('a bare-command step points back at its line for lint', async () => {
    const dir = write({ 'short.yaml': SHORT });
    const op = await parseOperation(join(dir, 'short.yaml'));
    assert.deepStrictEqual(getStepSource(op.steps[0])?.path, ['steps', 0]);
    assert.deepStrictEqual(
      getStepSource(op.steps[3].sub_steps?.[0] as never)?.path,
      ['steps', 3, 'sub_steps', 0],
    );
  });

  it('keeps `uses:` with a `name:` and no `type:` valid (unchanged)', async () => {
    const dir = write({
      'part.yaml': '- name: Part step\n  type: manual\n  command: echo part\n',
      'op.yaml': `${HEAD}steps:\n  - uses: ./part.yaml\n    name: Included block\n`,
    });
    const op = await parseOperation(join(dir, 'op.yaml'));
    assert.strictEqual(op.steps[0].name, 'Part step');
    assert.strictEqual(op.steps[0].usesGroup?.name, 'Included block');
  });

  it('`rollback: <command>` is a one-entry rollback, like the object form', async () => {
    const dir = write({
      'short.yaml': `${HEAD}steps:\n  - name: A\n    command: echo a\n    rollback: echo undo\n`,
      'long.yaml': `${HEAD}steps:\n  - name: A\n    type: manual\n    command: echo a\n    rollback:\n      command: echo undo\n`,
    });
    const short = await parseOperation(join(dir, 'short.yaml'));
    const long = await parseOperation(join(dir, 'long.yaml'));
    assert.deepStrictEqual(short.steps, long.steps);
    assert.strictEqual(short.steps[0].rollback?.[0]?.command, 'echo undo');
  });

  it('`uses:` with a `type:` is still rejected, as before', () => {
    const yaml = require('js-yaml') as typeof import('js-yaml');
    const errors = validateOperationSchema(
      yaml.load(
        `${HEAD}steps:\n  - uses: ./part.yaml\n    name: Block\n    type: manual\n`,
      ),
    );
    assert.ok(errors.length > 0);
  });

  it('steps from a `uses:` file may use the shorthands too', async () => {
    const dir = write({
      'part.yaml': '- echo from-part\n- name: Typed later\n  command: echo b\n',
      'op.yaml': `${HEAD}steps:\n  - uses: ./part.yaml\n`,
    });
    const op = await parseOperation(join(dir, 'op.yaml'));
    assert.deepStrictEqual(
      op.steps.map((s) => [s.name, s.type, s.command]),
      [
        ['echo from-part', 'manual', 'echo from-part'],
        ['Typed later', 'manual', 'echo b'],
      ],
    );
  });

  it('still rejects an unknown type, an empty bare step and an empty when', async () => {
    const bad = (steps: string) =>
      validateOperationSchema(
        (require('js-yaml') as typeof import('js-yaml')).load(
          `${HEAD}steps:\n${steps}`,
        ),
      );
    assert.ok(bad('  - name: A\n    type: manuel\n    command: x\n').length);
    assert.ok(bad("  - ''\n").length);
    assert.ok(bad("  - name: A\n    command: x\n    when: ''\n").length);
  });

  it('validate and lint accept a shorthand file and point at its lines', () => {
    const dir = write({
      'op.yaml': `${HEAD}steps:\n  - kubectl get pods -n web\n  - kubectl delete pod web-server-0 -n web\n`,
    });
    const cli = (args: string[]) =>
      spawnSync('node_modules/.bin/tsx', ['src/cli/index.ts', ...args], {
        encoding: 'utf8',
        timeout: 30_000,
      });
    const validate = cli(['validate', join(dir, 'op.yaml')]);
    assert.strictEqual(validate.status, 0, validate.stdout + validate.stderr);
    const lint = cli(['lint', join(dir, 'op.yaml')]);
    // `kubectl delete` with no rollback: the finding is on line 8, the
    // bare-command step.
    assert.match(
      lint.stdout,
      /\b8:\d+\s+warning\s+flow\/no-rollback-on-mutate/,
    );
  });
});
