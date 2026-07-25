import assert from 'node:assert';
import { describe, it } from 'node:test';
import * as yaml from 'js-yaml';
import {
  findDiscardedVerifyKeys,
  formatDiscardedVerifyFinding,
} from '../../src/lib/deprecated-verify';

// REGRESSION GUARD: `verify.command` is silently discarded by the parser.
// `extractExpect` lifts only `verify.expect` (or a bare string `verify`) into
// `expect`, and `normalizeRollbackStep` then drops `verify` outright. The README
// and USAGE guide both taught `verify: { command:, expect: }` for a long time, so
// real operation files carry a `command:` that never runs. These tests keep the
// warning that surfaces that loss wired up.

describe('deprecated verify detection', () => {
  it('flags verify.command on a top-level step', () => {
    const doc = yaml.load(`
name: Test
version: 1.0.0
steps:
  - name: Scale
    type: automatic
    command: kubectl scale
    verify:
      command: kubectl get deployment
      expect:
        equals: "3"
`);
    const findings = findDiscardedVerifyKeys(doc);
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].path, 'steps[0]');
    assert.strictEqual(findings[0].stepName, 'Scale');
    assert.deepStrictEqual(findings[0].discardedKeys, ['command']);
  });

  it('does not flag verify that only carries expect', () => {
    const doc = yaml.load(`
name: Test
version: 1.0.0
steps:
  - name: Scale
    type: automatic
    command: kubectl scale
    verify:
      expect:
        equals: "3"
`);
    assert.deepStrictEqual(findDiscardedVerifyKeys(doc), []);
  });

  it('does not flag the bare-string verify shorthand', () => {
    const doc = yaml.load(`
name: Test
version: 1.0.0
steps:
  - name: Scale
    type: automatic
    command: kubectl scale
    verify: "Running"
`);
    assert.deepStrictEqual(findDiscardedVerifyKeys(doc), []);
  });

  it('finds discarded keys in sub_steps and step rollbacks', () => {
    const doc = yaml.load(`
name: Test
version: 1.0.0
steps:
  - name: Parent
    type: manual
    sub_steps:
      - name: Child
        type: automatic
        command: echo hi
        verify:
          command: should-not-run
    rollback:
      - name: Undo
        command: echo undo
        verify:
          command: also-should-not-run
`);
    const findings = findDiscardedVerifyKeys(doc);
    const paths = findings.map((f) => f.path).sort();
    assert.deepStrictEqual(paths, [
      'steps[0].rollback[0]',
      'steps[0].sub_steps[0]',
    ]);
  });

  it('finds discarded keys in the operation-level rollback plan', () => {
    const doc = yaml.load(`
name: Test
version: 1.0.0
steps:
  - name: Go
    type: automatic
    command: echo go
rollback:
  steps:
    - name: Undo
      command: echo undo
      verify:
        command: nope
        expect: ok
`);
    const findings = findDiscardedVerifyKeys(doc);
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].path, 'rollback.steps[0]');
    assert.deepStrictEqual(findings[0].discardedKeys, ['command']);
  });

  it('message names the ignored key and points at expect', () => {
    const message = formatDiscardedVerifyFinding({
      path: 'steps[0]',
      stepName: 'Scale',
      discardedKeys: ['command'],
    });
    assert.match(message, /verify\.command is IGNORED/);
    assert.match(message, /use `expect:` instead/);
  });

  it('tolerates documents with no steps', () => {
    assert.deepStrictEqual(findDiscardedVerifyKeys({}), []);
    assert.deepStrictEqual(findDiscardedVerifyKeys(null), []);
  });
});
