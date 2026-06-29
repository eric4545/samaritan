import assert from 'node:assert';
import { describe, it } from 'node:test';
import { generateConfluenceContent } from '../../src/cli/commands/generate';
import { generateADFString } from '../../src/manuals/adf-generator';
import {
  generateManual,
  generateSingleEnvManual,
} from '../../src/manuals/generator';
import { parseFixture } from '../fixtures/fixtures';

// aggregate_step_rollbacks: the global rollback section GROUPS every step's own
// rollback after the explicit plan steps, in reverse step order, with a
// provenance label. The explicit step renders first; nested sub_steps still
// render recursively. Covered in every format AND both markdown paths
// (multi-env table + single-env headings — separate code paths).
describe('Global rollback aggregation (aggregate_step_rollbacks)', () => {
  it('groups per-step rollbacks (reverse order) in multi-env Markdown', async () => {
    const operation = await parseFixture('aggregatedGlobalRollback');
    const md = generateManual(operation);

    // Explicit plan step first.
    assert.match(md, /\| Rollback Step 1: Notify on-call \|/);
    // Then last step's rollback, then first step's (reverse order).
    const deployIdx = md.indexOf('↩ Rollback for "Deploy app": Roll back app');
    const backupIdx = md.indexOf(
      '↩ Rollback for "Backup database": Discard backup',
    );
    assert.ok(deployIdx > 0 && backupIdx > 0);
    assert.ok(
      deployIdx < backupIdx,
      'Deploy rollback should precede Backup rollback (reverse step order)',
    );
    // Nested sub_steps of the aggregated rollback still render as rows.
    assert.match(md, /kubectl rollout undo deployment\/app/);
  });

  it('groups per-step rollbacks in single-env Markdown headings', async () => {
    const operation = await parseFixture('aggregatedGlobalRollback');
    const md = generateSingleEnvManual(operation, 'staging');

    assert.match(md, /### Rollback Step 1: Notify on-call/);
    assert.match(
      md,
      /### Rollback Step 2: ↩ Rollback for "Deploy app": Roll back app/,
    );
    assert.match(md, /#### Rollback Step 2\.1/);
    assert.match(
      md,
      /### Rollback Step 3: ↩ Rollback for "Backup database": Discard backup/,
    );
  });

  it('groups per-step rollbacks in ADF', async () => {
    const operation = await parseFixture('aggregatedGlobalRollback');
    const adf = generateADFString(operation, undefined, undefined, false);
    assert.match(adf, /Rollback for \\"Deploy app\\"/);
    assert.match(adf, /Rollback for \\"Backup database\\"/);
  });

  it('groups per-step rollbacks in Confluence markup', async () => {
    const operation = await parseFixture('aggregatedGlobalRollback');
    const content = generateConfluenceContent(operation, false);
    assert.match(content, /Rollback Step 1: Notify on-call/);
    assert.match(content, /↩ Rollback for "Deploy app": Roll back app/);
    assert.match(content, /↩ Rollback for "Backup database": Discard backup/);
  });
});
