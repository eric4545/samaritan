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

// aggregate_step_rollbacks ALSO centralizes rollbacks: the inline block after a
// step collapses to a jump-link into the bottom Rollback Plan (which carries the
// matching anchor target), and the duplicate Rollback Procedures section is
// dropped. Covered in every format + both markdown paths.
describe('aggregate_step_rollbacks jump-links + centralization', () => {
  it('multi-env Markdown: inline links, anchors, no Procedures', async () => {
    const operation = await parseFixture('aggregatedGlobalRollback');
    const md = generateManual(operation);

    // Inline blocks collapsed to jump-links pointing at the folded entries.
    assert.ok(
      md.includes(
        '↩ **Rollback:** [Rollback for Step 1 ↓](#rollback-backup-database)',
      ),
    );
    assert.ok(
      md.includes(
        '↩ **Rollback:** [Rollback for Step 2 ↓](#rollback-deploy-app)',
      ),
    );
    // The folded Plan entries advertise the matching anchor targets.
    assert.ok(md.includes('<a id="rollback-backup-database"></a>'));
    assert.ok(md.includes('<a id="rollback-deploy-app"></a>'));
    // Duplicate content is gone: no inline rollback table, no Procedures section.
    assert.ok(!md.includes('### 🔄 Rollback for Step'));
    assert.ok(!md.includes('## 🔄 Rollback Procedures'));
  });

  it('single-env Markdown: inline links + anchors before Plan headings', async () => {
    const operation = await parseFixture('aggregatedGlobalRollback');
    const md = generateSingleEnvManual(operation, 'staging');

    assert.ok(
      md.includes('[Rollback for Step 1 ↓](#rollback-backup-database)'),
    );
    assert.ok(md.includes('[Rollback for Step 2 ↓](#rollback-deploy-app)'));
    assert.ok(md.includes('<a id="rollback-backup-database"></a>'));
    assert.ok(md.includes('<a id="rollback-deploy-app"></a>'));
    // No inline rollback heading in the step flow.
    assert.ok(!md.includes('### 🔄 Rollback\n'));
  });

  it('ADF: anchor macros in Plan, no Procedures section', async () => {
    const operation = await parseFixture('aggregatedGlobalRollback');
    const adf = generateADFString(operation, undefined, undefined, false);
    // Confluence anchor macro targets for the folded entries.
    assert.match(adf, /"extensionKey":\s*"anchor"/);
    assert.ok(adf.includes('rollback-backup-database'));
    assert.ok(adf.includes('rollback-deploy-app'));
    // Duplicate Procedures section dropped.
    assert.ok(!adf.includes('Rollback Procedures'));
  });

  it('Confluence markup: inline links + {anchor} targets', async () => {
    const operation = await parseFixture('aggregatedGlobalRollback');
    const content = generateConfluenceContent(operation, false);
    assert.ok(
      content.includes('[Rollback for Step 1 |#rollback-backup-database]'),
    );
    assert.ok(content.includes('[Rollback for Step 2 |#rollback-deploy-app]'));
    assert.ok(content.includes('{anchor:rollback-backup-database}'));
    assert.ok(content.includes('{anchor:rollback-deploy-app}'));
  });

  it('sub-step rollbacks also collapse to jump-links (all formats)', async () => {
    // Reuse the nested-sub-step fixture (a sub-step that has BOTH its own
    // rollback and nested sub_steps — the shape the Confluence wiki path needs)
    // and turn aggregation on in-test so no dedicated fixture is required.
    const operation = await parseFixture('nestedSubstepWithRollback');
    operation.rollback = {
      automatic: false,
      aggregate_step_rollbacks: true,
      steps: [
        { name: 'Notify on-call', instruction: 'Page the on-call SRE.' },
      ],
    };
    // Sub-step "Stage 1 (1% Traffic)" → anchor rollback-stage-1-1-traffic.
    const anchor = 'rollback-stage-1-1-traffic';

    // Multi-env Markdown: the sub-step's inline rollback becomes a link.
    const md = generateManual(operation);
    assert.ok(md.includes(`](#${anchor})`));
    assert.ok(md.includes(`<a id="${anchor}"></a>`));
    assert.ok(!md.includes('🔄 Rollback for Step'));

    // ADF: link mark + anchor macro for the sub-step.
    const adf = generateADFString(operation, undefined, undefined, false);
    assert.ok(adf.includes(`#${anchor}`));
    assert.ok(adf.includes(anchor));

    // Confluence markup: link + {anchor}.
    const content = generateConfluenceContent(operation, false);
    assert.ok(content.includes(`|#${anchor}]`));
    assert.ok(content.includes(`{anchor:${anchor}}`));
  });
});

// Guard the default: with aggregate_step_rollbacks OFF, nothing changes — inline
// rollback blocks and the Rollback Procedures section still render, and NO
// jump-links or anchors are emitted.
describe('aggregate_step_rollbacks OFF: rollback rendering unchanged', () => {
  it('multi-env Markdown keeps inline blocks, emits no jump-links/anchors', async () => {
    const operation = await parseFixture('stepRollbackSubsteps');
    const md = generateManual(operation);

    assert.ok(md.includes('### 🔄 Rollback for Step'));
    assert.ok(md.includes('## 🔄 Rollback Procedures'));
    assert.ok(!md.includes('↩ **Rollback:**'));
    assert.ok(!md.includes('<a id="rollback-'));
  });

  it('ADF keeps the Procedures section, emits no anchor macros', async () => {
    const operation = await parseFixture('stepRollbackSubsteps');
    const adf = generateADFString(operation, undefined, undefined, false);

    assert.ok(adf.includes('Rollback Procedures'));
    assert.ok(!adf.includes('"extensionKey":"anchor"'));
    assert.ok(!/"extensionKey":\s*"anchor"/.test(adf));
  });
});
