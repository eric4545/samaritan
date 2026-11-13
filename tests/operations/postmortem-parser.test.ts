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

  describe('timestamps', () => {
    const doc = (at: string) =>
      `title: T\nsummary: S\ntimeline:\n  - at: ${at}\n    event: e\n`;

    it('rejects a date-time without a time zone, naming the field', () => {
      assert.throws(
        () => parsePostmortem(doc('2026-01-01T14:00:00')),
        (err: unknown) => {
          assert.ok(err instanceof SchemaValidationError);
          assert.equal(err.errors[0].field, '/timeline/0/at');
          assert.match(err.errors[0].message, /no time zone/);
          return true;
        },
      );
    });

    it('rejects a zone-less occurred_at, resolved_at and detected_at', () => {
      assert.throws(
        () =>
          parsePostmortem(
            'title: T\nsummary: S\noccurred_at: 2026-01-01 14:00\nresolved_at: 2026-01-01T15:00:00\ndetection:\n  detected_at: 2026-01-01T14:05:00\n',
          ),
        (err: unknown) => {
          assert.ok(err instanceof SchemaValidationError);
          assert.deepEqual(
            err.errors.map((e) => e.field),
            ['/occurred_at', '/resolved_at', '/detection/detected_at'],
          );
          return true;
        },
      );
    });

    it('rejects an impossible date', () => {
      assert.throws(
        () => parsePostmortem(doc('2026-13-45T14:00:00Z')),
        /Schema validation failed/,
      );
    });

    for (const ok of [
      '2026-01-01T14:00:00Z',
      '2026-01-01T23:00:00+09:00',
      '2026-01-01T14:00:00.123-0500',
      '2026-01-01',
      '16:20',
      '18:05-18:10Z',
    ]) {
      it(`accepts '${ok}'`, () => {
        assert.equal(parsePostmortem(doc(ok)).timeline?.[0].at, ok);
      });
    }
  });
});
