import assert from 'node:assert';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import {
  getRunEvidenceDir,
  getRunReportPath,
} from '../../src/lib/session-persistence';

describe('getRunEvidenceDir', () => {
  it('lives in the run dir beside report.md', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sam-evdir-'));
    try {
      const op = join(dir, 'op.yaml');
      writeFileSync(op, 'name: x\n');
      const evidenceDir = getRunEvidenceDir(op, 'sess-1');
      assert.strictEqual(
        evidenceDir,
        join(dirname(getRunReportPath(op, 'sess-1')), 'evidence'),
      );
      assert.ok(existsSync(evidenceDir), 'created on demand');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
