import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

// GUARDRAIL: a rollback step IS a normal step, so #/definitions/rollbackStep must
// stay at full field parity with the normal-step schema. This class of bug —
// `name`, then `sub_steps`, then `foreach` silently dropped from rollback —
// recurred precisely because nothing forced parity: rollbackStep was a
// hand-maintained subset, and each new Step field had to be mirrored by memory.
// This test turns the next omission into a loud CI failure instead of a silent
// runtime data loss. When you ADD a field to a normal step, either add it to
// rollbackStep too, or add it to ROLLBACK_EXCLUDED_FIELDS with a reason.
const ROLLBACK_EXCLUDED_FIELDS = new Set<string>([
  // No rollback-of-a-rollback: nesting is expressed via `sub_steps`, which
  // rollbackStep already supports (recursively → rollbackStep).
  // NOTE: `uses:`/`with:` file composition IS now supported on rollback steps —
  // the rollback pipeline runs through resolveRollbackReferences, which shares
  // the uses-expansion core (expandUsesEntry) with normal steps — so they are
  // deliberately NOT excluded here.
  'rollback',
]);

describe('rollbackStep schema parity with normal steps', () => {
  const schema = JSON.parse(
    readFileSync(
      join(process.cwd(), 'src/schemas/operation.schema.json'),
      'utf-8',
    ),
  );

  const normalStepProps = new Set<string>(
    Object.keys(schema.properties.steps.items.oneOf[1].properties),
  );
  const rollbackProps = new Set<string>(
    Object.keys(schema.definitions.rollbackStep.properties),
  );

  it('rollbackStep accepts every normal-step field (minus documented exclusions)', () => {
    const missing = [...normalStepProps].filter(
      (field) =>
        !rollbackProps.has(field) && !ROLLBACK_EXCLUDED_FIELDS.has(field),
    );
    assert.deepStrictEqual(
      missing,
      [],
      `rollbackStep is missing normal-step field(s): ${missing.join(', ')}. ` +
        'A rollback step IS a normal step — add these to ' +
        '#/definitions/rollbackStep, or to ROLLBACK_EXCLUDED_FIELDS with a reason.',
    );
  });

  it('every ROLLBACK_EXCLUDED_FIELDS entry is a real normal-step field', () => {
    // Keeps the exclusion list honest: a field removed from the normal step must
    // also be removed here, so the list can never mask a genuine parity gap.
    const stale = [...ROLLBACK_EXCLUDED_FIELDS].filter(
      (field) => !normalStepProps.has(field),
    );
    assert.deepStrictEqual(
      stale,
      [],
      `ROLLBACK_EXCLUDED_FIELDS lists non-existent normal-step field(s): ${stale.join(', ')}`,
    );
  });

  it('rollbackStep stays strict and enforces command/script mutual exclusion', () => {
    assert.strictEqual(
      schema.definitions.rollbackStep.additionalProperties,
      false,
    );
    assert.deepStrictEqual(schema.definitions.rollbackStep.not, {
      required: ['command', 'script'],
    });
  });
});
