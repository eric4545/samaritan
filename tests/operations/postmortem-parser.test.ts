import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  parsePostmortem,
  parsePostmortemFile,
} from '../../src/operations/postmortem-parser';
import { SchemaValidationError } from '../../src/validation/schema-validator';

const fixtureDir = join(__dirname, '../fixtures/postmortems');
const load = (name: string) => readFileSync(join(fixtureDir, name), 'utf-8');

describe('parsePostmortem', () => {
  it('parses a minimal postmortem with only required fields', () => {
    const pm = parsePostmortem(load('minimal.yaml'));
    assert.equal(pm.title, 'Minimal Incident Report');
    assert.ok(pm.summary.length > 0);
  });

  it('parses the full example with all sections', () => {
    const pm = parsePostmortemFile(
      join(__dirname, '../../examples/postmortems/checkout-outage.yaml'),
    );
    assert.equal(pm.severity, 'SEV1');
    assert.equal(pm.operation, '../deployment.yaml');
    assert.equal(pm.timeline?.length, 5);
    assert.equal(pm.root_cause?.five_whys?.length, 5);
    assert.equal(pm.action_items?.length, 3);
    assert.deepEqual(pm.qrh, ['db-failover']);
    assert.ok(pm.lessons_learned?.got_lucky?.length);
  });

  it('throws SchemaValidationError when summary is missing', () => {
    assert.throws(
      () => parsePostmortem(load('invalid-missing-summary.yaml')),
      (err: unknown) => {
        assert.ok(err instanceof SchemaValidationError);
        assert.ok(
          err.errors.some((e) => e.message.includes('summary')),
          'error should mention the missing summary field',
        );
        return true;
      },
    );
  });

  it('throws SchemaValidationError for an invalid severity enum', () => {
    assert.throws(
      () => parsePostmortem(load('invalid-bad-severity.yaml')),
      SchemaValidationError,
    );
  });

  it('rejects a non-mapping document', () => {
    assert.throws(
      () => parsePostmortem('- just\n- a\n- list\n'),
      SchemaValidationError,
    );
  });
});
