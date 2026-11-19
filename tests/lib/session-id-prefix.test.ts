import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  resolveSessionIdPrefix,
  shortSessionId,
} from '../../src/lib/session-persistence';

const IDS = [
  '3f2a9c1e-0000-4000-8000-000000000001',
  '3f2a9c1e-0000-4000-8000-000000000002',
  'a1b2c3d4-0000-4000-8000-000000000003',
];

describe('resolveSessionIdPrefix', () => {
  it('a full id resolves to itself', () => {
    assert.deepStrictEqual(resolveSessionIdPrefix(IDS[2], IDS), {
      id: IDS[2],
    });
  });

  it('a unique leading part resolves, case-insensitively', () => {
    assert.deepStrictEqual(resolveSessionIdPrefix('A1B2', IDS), {
      id: IDS[2],
    });
  });

  it('a part shared by several ids asks for more', () => {
    const r = resolveSessionIdPrefix('3f2a9c1e', IDS);
    assert.match(
      (r as { error: string }).error,
      /"3f2a9c1e" starts 2 session ids \(3f2a9c1e-0000-4000-8000-000000000001, 3f2a9c1e-0000-4000-8000-000000000002\)/,
    );
  });

  it('no match (or nothing typed) is undefined', () => {
    assert.strictEqual(resolveSessionIdPrefix('ffff', IDS), undefined);
    assert.strictEqual(resolveSessionIdPrefix('  ', IDS), undefined);
  });
});

describe('shortSessionId', () => {
  it('8 characters when they are unique', () => {
    assert.strictEqual(shortSessionId(IDS[2], IDS), 'a1b2c3d4');
  });

  it('as long as it takes to be unique', () => {
    assert.strictEqual(shortSessionId(IDS[0], IDS), IDS[0]);
    assert.strictEqual(
      shortSessionId(IDS[0], [IDS[0], 'a1b2c3d4-0000-4000-8000-000000000009']),
      '3f2a9c1e',
    );
  });
});
