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

    it('accepts zone-less date-times (read in the display zone)', () => {
      const pm = parsePostmortem(
        'title: T\nsummary: S\noccurred_at: 2026-01-01 14:00\nresolved_at: 2026-01-01T15:00:00\ndetection:\n  detected_at: 2026-01-01T14:05:00\n',
      );
      assert.equal(pm.resolved_at, '2026-01-01T15:00:00');
    });

    it('names every impossible date', () => {
      assert.throws(
        () =>
          parsePostmortem(
            'title: T\nsummary: S\noccurred_at: 2026-02-30T14:00:00Z\ndetection:\n  detected_at: 2026-01-01T25:00:00Z\n',
          ),
        (err: unknown) => {
          assert.ok(err instanceof SchemaValidationError);
          assert.deepEqual(
            err.errors.map((e) => e.field),
            ['/occurred_at', '/detection/detected_at'],
          );
          return true;
        },
      );
    });

    const ranged = (at: string, until: string) =>
      `title: T\nsummary: S\ntimeline:\n  - at: "${at}"\n    until: "${until}"\n    event: e\n`;

    it('accepts an until of the same kind as at', () => {
      const pm = parsePostmortem(
        ranged('2026-01-01T14:30:00Z', '2026-01-01T14:35:00Z'),
      );
      assert.equal(pm.timeline?.[0].until, '2026-01-01T14:35:00Z');
      assert.equal(
        parsePostmortem(ranged('14:30', '14:35')).timeline?.[0].until,
        '14:35',
      );
    });

    it('rejects an until that is a clock time when at is ISO-8601', () => {
      assert.throws(
        () => parsePostmortem(ranged('2026-01-01T14:30:00Z', '14:35')),
        (err: unknown) => {
          assert.ok(err instanceof SchemaValidationError);
          assert.equal(err.errors[0].field, '/timeline/0/until');
          assert.match(err.errors[0].message, /must be a full ISO-8601/);
          return true;
        },
      );
    });

    it('rejects an until before at', () => {
      assert.throws(
        () =>
          parsePostmortem(
            ranged('2026-01-01T14:30:00Z', '2026-01-01T14:00:00Z'),
          ),
        (err: unknown) => {
          assert.ok(err instanceof SchemaValidationError);
          assert.match(err.errors[0].message, /is before at/);
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
