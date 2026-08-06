import assert from 'node:assert';
import { describe, it } from 'node:test';
import { generateConfluenceContent } from '../../src/cli/commands/generate';
import { slugify } from '../../src/lib/anchor';
import { generateADFString } from '../../src/manuals/adf-generator';
import {
  generateManual,
  generateManualWithMetadata,
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

    // Explicit plan step first (still a table row).
    assert.match(md, /\| Rollback Step 1: Notify on-call \|/);
    // Then last step's rollback, then first step's (reverse order) — now
    // rendered as renderer-safe headings (the jump-link targets).
    const deployIdx = md.indexOf('### Rollback for "Deploy app"');
    const backupIdx = md.indexOf('### Rollback for "Backup database"');
    assert.ok(deployIdx > 0 && backupIdx > 0);
    assert.ok(
      deployIdx < backupIdx,
      'Deploy rollback should precede Backup rollback (reverse step order)',
    );
    // Nested sub_steps of the aggregated rollback still render (inline in cell).
    assert.match(md, /kubectl rollout undo deployment\/app/);
  });

  it('groups per-step rollbacks in single-env Markdown headings', async () => {
    const operation = await parseFixture('aggregatedGlobalRollback');
    const md = generateSingleEnvManual(operation, 'staging');

    // Explicit plan step keeps its numbered heading.
    assert.match(md, /### Rollback Step 1: Notify on-call/);
    // Folded entries render under their renderer-safe heading; sub_steps keep
    // the Rollback Step N.M numbering beneath it.
    assert.match(md, /### Rollback for "Deploy app"/);
    assert.match(md, /#### Rollback Step 2\.1/);
    assert.match(md, /### Rollback for "Backup database"/);
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
// step collapses to a jump-link into the bottom Rollback Plan. The Markdown link
// MUST resolve in sanitized renderers (e.g. GitHub, which rewrites hand-authored
// `<a id>` to `user-content-*` with no clean-fragment alias), so the target is a
// real HEADING whose slug equals the link's anchor — and the link text and that
// heading share one searchable phrase. Covered in every format + both md paths.
describe('aggregate_step_rollbacks jump-links + centralization', () => {
  // The renderer-agnostic invariant: every inline `](#slug)` resolves to a real
  // heading whose slug equals `slug`, and NO raw `<a id>` anchors remain (those
  // are what break in sanitized renderers).
  const assertLinksResolveToHeadings = (md: string): void => {
    const hrefs = [...md.matchAll(/\]\(#([a-z0-9-]+)\)/g)].map((m) => m[1]);
    assert.ok(hrefs.length > 0, 'expected at least one inline jump-link');
    const headingSlugs = new Set(
      [...md.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slugify(m[1])),
    );
    for (const href of hrefs) {
      assert.ok(
        headingSlugs.has(href),
        `jump-link #${href} has no matching heading slug (won't jump in sanitized renderers)`,
      );
    }
    assert.ok(
      !md.includes('<a id='),
      'no raw <a id> anchors should remain (they break in sanitized renderers)',
    );
  };

  it('multi-env Markdown: links resolve to headings, no <a id>, no Procedures', async () => {
    const operation = await parseFixture('aggregatedGlobalRollback');
    const md = generateManual(operation);

    // Inline blocks collapsed to semantic jump-links.
    assert.ok(
      md.includes(
        '↩ **Rollback:** [Rollback for "Backup database" ↓](#rollback-for-backup-database)',
      ),
    );
    assert.ok(
      md.includes(
        '↩ **Rollback:** [Rollback for "Deploy app" ↓](#rollback-for-deploy-app)',
      ),
    );
    assertLinksResolveToHeadings(md);
    // Duplicate content is gone: no inline rollback table, no Procedures section.
    assert.ok(!md.includes('### 🔄 Rollback for Step'));
    assert.ok(!md.includes('## 🔄 Rollback Procedures'));
    // Link text and target heading share a searchable phrase.
    assert.ok(md.includes('[Rollback for "Deploy app" ↓]'));
    assert.ok(md.includes('### Rollback for "Deploy app"'));
  });

  it('single-env Markdown: links resolve to headings, no <a id>', async () => {
    const operation = await parseFixture('aggregatedGlobalRollback');
    const md = generateSingleEnvManual(operation, 'staging');

    assert.ok(
      md.includes(
        '[Rollback for "Backup database" ↓](#rollback-for-backup-database)',
      ),
    );
    assert.ok(
      md.includes('[Rollback for "Deploy app" ↓](#rollback-for-deploy-app)'),
    );
    assertLinksResolveToHeadings(md);
    // No inline rollback heading in the step flow.
    assert.ok(!md.includes('### 🔄 Rollback\n'));
    // Same searchable phrase in link text and target heading.
    assert.ok(md.includes('[Rollback for "Backup database" ↓]'));
    assert.ok(md.includes('### Rollback for "Backup database"'));
  });

  it('single-env production variant also resolves links to headings', async () => {
    const operation = await parseFixture('aggregatedGlobalRollback');
    const md = generateSingleEnvManual(operation, 'production');
    assertLinksResolveToHeadings(md);
  });

  it('ADF: anchor macros in Plan, no Procedures section', async () => {
    const operation = await parseFixture('aggregatedGlobalRollback');
    const adf = generateADFString(operation, undefined, undefined, false);
    // Confluence anchor macro targets for the folded entries.
    assert.match(adf, /"extensionKey":\s*"anchor"/);
    assert.ok(adf.includes('rollback-for-backup-database'));
    assert.ok(adf.includes('rollback-for-deploy-app'));
    // Duplicate Procedures section dropped.
    assert.ok(!adf.includes('Rollback Procedures'));
  });

  it('Confluence markup: inline links + {anchor} targets', async () => {
    const operation = await parseFixture('aggregatedGlobalRollback');
    const content = generateConfluenceContent(operation, false);
    assert.ok(
      content.includes(
        '[Rollback for "Backup database" |#rollback-for-backup-database]',
      ),
    );
    assert.ok(
      content.includes('[Rollback for "Deploy app" |#rollback-for-deploy-app]'),
    );
    assert.ok(content.includes('{anchor:rollback-for-backup-database}'));
    assert.ok(content.includes('{anchor:rollback-for-deploy-app}'));
  });

  it('sub-step rollbacks also collapse to jump-links (all formats)', async () => {
    // Reuse the nested-sub-step fixture (a sub-step that has BOTH its own
    // rollback and nested sub_steps — the shape the Confluence wiki path needs)
    // and turn aggregation on in-test so no dedicated fixture is required.
    const operation = await parseFixture('nestedSubstepWithRollback');
    operation.rollback = {
      automatic: false,
      aggregate_step_rollbacks: true,
      steps: [{ name: 'Notify on-call', instruction: 'Page the on-call SRE.' }],
    };
    // Sub-step "Stage 1 (1% Traffic)" → heading slug rollback-for-stage-1-1-traffic.
    const anchor = 'rollback-for-stage-1-1-traffic';

    // Multi-env Markdown: the sub-step's inline rollback becomes a link that
    // resolves to a real heading (no <a id>).
    const md = generateManual(operation);
    assert.ok(md.includes(`](#${anchor})`));
    assert.ok(!md.includes('<a id='));
    const headingSlugs = new Set(
      [...md.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slugify(m[1])),
    );
    assert.ok(headingSlugs.has(anchor), 'sub-step link resolves to a heading');
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

// Regression: when-gated steps must not contribute rollbacks to environments
// they don't apply to, even with aggregate_step_rollbacks: true (single-env
// path used by `generate manual --env <name>`).
describe('aggregate_step_rollbacks: when: filtering respected in rollback plan', () => {
  it('single-env pro: dev-only step rollback does not appear', async () => {
    const operation = await parseFixture('rollbackWhenAggregate');
    const md = generateSingleEnvManual(operation, 'pro');

    // The dev-only step itself must not appear.
    assert.ok(!md.includes('Dev-only setup'), 'dev-only step body absent');
    // Its rollback must not appear in the plan either.
    assert.ok(
      !md.includes('Rollback for "Dev-only setup"'),
      'dev-only rollback absent from pro plan',
    );
    assert.ok(
      !md.includes('echo "undo-dev"'),
      'dev-only rollback command absent from pro plan',
    );
    // The all-environments step rollback must still appear.
    assert.ok(
      md.includes('Rollback for "All environments deploy"'),
      'shared rollback present in pro plan',
    );
    assert.ok(
      md.includes('echo "undo-deploy"'),
      'shared rollback command present in pro plan',
    );
  });

  it('single-env dev: dev-only step rollback is present', async () => {
    const operation = await parseFixture('rollbackWhenAggregate');
    const md = generateSingleEnvManual(operation, 'dev');

    // Both rollbacks appear when generating for dev.
    assert.ok(
      md.includes('Rollback for "Dev-only setup"'),
      'dev-only rollback present in dev plan',
    );
    assert.ok(
      md.includes('Rollback for "All environments deploy"'),
      'shared rollback present in dev plan',
    );
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

// Regression: explicit rollback.steps with when: gating must not leak into
// manuals for non-matching environments. Non-empty rollback.steps + nested
// sub_steps + aggregate_step_rollbacks: true (single-env and multi-env paths).
describe('explicit rollback.steps: when: filtering respected by environment', () => {
  it('single-env pro: dev/stg-gated rollback steps absent, all-env and pro steps present', async () => {
    const operation = await parseFixture('rollbackWhenAggregateGlobal');
    const md = generateSingleEnvManual(operation, 'pro');

    // Env-gated entries for other environments must not appear.
    assert.ok(
      !md.includes('Revert dev config'),
      'dev-gated rollback step absent from pro manual',
    );
    assert.ok(
      !md.includes('echo "revert-dev-config"'),
      'dev-gated rollback command absent from pro manual',
    );
    assert.ok(
      !md.includes('Revert stg config'),
      'stg-gated rollback step absent from pro manual',
    );
    assert.ok(
      !md.includes('echo "revert-stg-config"'),
      'stg-gated rollback command absent from pro manual',
    );
    assert.ok(
      !md.includes('Flush stg cache'),
      'stg-only sub_step absent from pro manual',
    );
    // Universal and pro-specific entries must appear.
    assert.ok(
      md.includes('Notify on-call'),
      'all-env rollback step present in pro manual',
    );
    assert.ok(
      md.includes('Revert pro config'),
      'pro-gated rollback step present in pro manual',
    );
    assert.ok(
      md.includes('echo "revert-pro-config"'),
      'pro-gated rollback command present in pro manual',
    );
  });

  it('single-env stg: stg-gated steps (+ sub_steps) present, dev/pro absent', async () => {
    const operation = await parseFixture('rollbackWhenAggregateGlobal');
    const md = generateSingleEnvManual(operation, 'stg');

    assert.ok(
      !md.includes('Revert dev config'),
      'dev-gated rollback step absent from stg manual',
    );
    assert.ok(
      !md.includes('Revert pro config'),
      'pro-gated rollback step absent from stg manual',
    );
    assert.ok(
      md.includes('Revert stg config'),
      'stg-gated rollback step present in stg manual',
    );
    assert.ok(
      md.includes('echo "revert-stg-config"'),
      'stg-gated rollback command present in stg manual',
    );
    // sub_step of the stg rollback step must also appear.
    assert.ok(
      md.includes('Flush stg cache'),
      'stg rollback sub_step present in stg manual',
    );
    assert.ok(
      md.includes('Notify on-call'),
      'all-env rollback step present in stg manual',
    );
  });

  it('single-env dev: dev-gated step present, stg/pro absent', async () => {
    const operation = await parseFixture('rollbackWhenAggregateGlobal');
    const md = generateSingleEnvManual(operation, 'dev');

    assert.ok(
      md.includes('Revert dev config'),
      'dev-gated rollback step present in dev manual',
    );
    assert.ok(
      md.includes('echo "revert-dev-config"'),
      'dev-gated rollback command present in dev manual',
    );
    assert.ok(
      !md.includes('Revert stg config'),
      'stg-gated rollback step absent from dev manual',
    );
    assert.ok(
      !md.includes('Revert pro config'),
      'pro-gated rollback step absent from dev manual',
    );
  });

  it('multi-env --env pro (generateManualWithMetadata): dev/stg rollback steps absent', async () => {
    const operation = await parseFixture('rollbackWhenAggregateGlobal');
    const md = generateManualWithMetadata(operation, undefined, 'pro');

    assert.ok(
      !md.includes('Revert dev config'),
      'dev-gated rollback step absent from --env pro manual',
    );
    assert.ok(
      !md.includes('Revert stg config'),
      'stg-gated rollback step absent from --env pro manual',
    );
    assert.ok(
      md.includes('Revert pro config'),
      'pro-gated rollback step present in --env pro manual',
    );
    assert.ok(
      md.includes('Notify on-call'),
      'all-env rollback step present in --env pro manual',
    );
  });

  it('multi-env all-envs (no targetEnvironment): all rollback steps appear', async () => {
    const operation = await parseFixture('rollbackWhenAggregateGlobal');
    // No targetEnvironment — all explicit rollback.steps remain unfiltered.
    const md = generateManualWithMetadata(operation);

    assert.ok(
      md.includes('Revert dev config'),
      'dev-gated rollback step present in all-env manual',
    );
    assert.ok(
      md.includes('Revert stg config'),
      'stg-gated rollback step present in all-env manual',
    );
    assert.ok(
      md.includes('Revert pro config'),
      'pro-gated rollback step present in all-env manual',
    );
    assert.ok(
      md.includes('Notify on-call'),
      'all-env rollback step present in all-env manual',
    );
  });
});
