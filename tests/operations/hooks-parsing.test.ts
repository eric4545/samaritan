import assert from 'node:assert';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { parseOperation } from '../../src/operations/parser';

const EXAMPLE = resolve('examples/deployment-with-hooks.yaml');

async function parseExample() {
  return parseOperation(EXAMPLE);
}

describe('hooks: parse-time injection into the step list', () => {
  it('injects before/after hook steps in the authored order', async () => {
    const op = await parseExample();
    assert.deepStrictEqual(
      op.steps.map((s) => s.name),
      [
        'Announce the change window', // before: preflight
        'Check cluster reachability', // authored preflight
        'Snapshot current replica count', // before: deploy (1st declared)
        'Drain traffic from the old pods', // before: deploy (2nd declared)
        'Apply the deployment manifest', // authored flight
        'Confirm pods are healthy', // authored postflight
        'Re-enable alerting', // after: verify
      ],
      'hook steps must land at their anchors, same-anchor hooks in declaration order',
    );
  });

  it('stamps injected steps with hookSource and leaves authored ones alone', async () => {
    const op = await parseExample();
    const injected = op.steps.find(
      (s) => s.name === 'Drain traffic from the old pods',
    );
    assert.deepStrictEqual(injected?.hookSource, {
      anchor: 'deploy',
      position: 'before',
    });
    const authored = op.steps.find(
      (s) => s.name === 'Apply the deployment manifest',
    );
    assert.strictEqual(authored?.hookSource, undefined);
  });

  it('keeps on_failure steps OUT of the flow', async () => {
    const op = await parseExample();
    const flow = op.steps.map((s) => s.name);
    assert.ok(
      !flow.includes('Page the on-call engineer'),
      'on_failure steps must not be injected into the step list',
    );
    assert.deepStrictEqual(
      (op.on_failure ?? []).map((s) => s.name),
      [
        'Page the on-call engineer',
        'Capture pod diagnostics for the postmortem',
      ],
    );
  });

  it('hook steps carry the full normal-step surface', async () => {
    const op = await parseExample();
    const snapshot = op.steps.find(
      (s) => s.name === 'Snapshot current replica count',
    );
    assert.strictEqual(snapshot?.type, 'automatic');
    assert.ok(snapshot?.command?.includes('jsonpath'));
    assert.strictEqual(snapshot?.evidence?.required, true);
  });

  it('an operation without hooks has no on_failure', async () => {
    const op = await parseOperation(resolve('examples/deployment.yaml'));
    assert.strictEqual(op.on_failure, undefined);
  });
});

describe('hooks: anchor validation', () => {
  async function parseYaml(yaml: string) {
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'samaritan-hooks-'));
    const file = join(dir, 'op.yaml');
    writeFileSync(file, yaml);
    return parseOperation(file);
  }

  const base = `name: Anchor Test
version: 1.0.0
environments:
  - name: staging
    variables: {}
steps:
  - name: Only step
    id: only
    type: manual
    instruction: do it
`;

  it('rejects an anchor that matches no step id or phase', async () => {
    await assert.rejects(
      () =>
        parseYaml(
          `${base}hooks:
  - before: ghost
    steps:
      - name: Orphan
        type: manual
        instruction: never placed
`,
        ),
      // OperationParseError carries the detail on `.errors`, not `.message`.
      (err: Error & { errors?: Array<{ field: string; message: string }> }) =>
        (err.errors ?? []).some(
          (e) => e.field === 'hooks' && /anchor 'ghost'/.test(e.message),
        ),
    );
  });

  it('accepts a phase anchor that a step occupies', async () => {
    const op = await parseYaml(
      `${base}hooks:
  - before: flight
    steps:
      - name: Injected
        type: manual
        instruction: placed
`,
    );
    assert.deepStrictEqual(
      op.steps.map((s) => s.name),
      ['Injected', 'Only step'],
    );
  });

  it('an on_failure hook needs no anchor', async () => {
    const op = await parseYaml(
      `${base}hooks:
  - on_failure: true
    steps:
      - name: Notify
        type: manual
        instruction: page someone
`,
    );
    assert.deepStrictEqual(
      op.steps.map((s) => s.name),
      ['Only step'],
    );
    assert.deepStrictEqual(
      (op.on_failure ?? []).map((s) => s.name),
      ['Notify'],
    );
  });
});
