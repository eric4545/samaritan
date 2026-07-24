import assert from 'node:assert';
import { describe, it } from 'node:test';
import { formatTimelineForDisplay } from '../../src/lib/timeline-format';

describe('formatTimelineForDisplay', () => {
  it('returns string timelines unchanged', () => {
    assert.strictEqual(
      formatTimelineForDisplay('2024-01-15 10:00'),
      '2024-01-15 10:00',
    );
  });

  it('formats start + duration as "start for duration"', () => {
    assert.strictEqual(
      formatTimelineForDisplay({ start: '2024-01-15 09:00', duration: '30m' }),
      '2024-01-15 09:00 for 30m',
    );
  });

  it('formats start without duration', () => {
    assert.strictEqual(
      formatTimelineForDisplay({ start: '2024-01-15 09:00' }),
      '2024-01-15 09:00',
    );
  });

  it('formats after + duration as "(after step) duration"', () => {
    assert.strictEqual(
      formatTimelineForDisplay({ after: 'Deploy service', duration: '10m' }),
      '(after Deploy service) 10m',
    );
  });

  it('formats duration-only timelines', () => {
    assert.strictEqual(formatTimelineForDisplay({ duration: '2h' }), '2h');
  });
});
