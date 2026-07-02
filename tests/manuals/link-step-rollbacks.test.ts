import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  generateManual,
  generateSingleEnvManual,
} from '../../src/manuals/generator';
import { parseFixture } from '../fixtures/fixtures';

// `rollback.link_step_rollbacks: true` replaces each step's inline rollback body
// with a jump-link to the consolidated "Rollback Plan" section, which aggregates
// every step's rollback so nothing is lost. Covered in BOTH the multi-env table
// path and the --env single-env heading path (CLAUDE.md rule 7).
describe('rollback.link_step_rollbacks', () => {
  const JUMP =
    /Rollback for this step is consolidated in the \[Rollback Plan\]\(#rollback-plan\)/;

  it('multi-env: links inline, drops the repeated body, keeps the aggregated plan', async () => {
    const operation = await parseFixture('rollbackJumpLinks');
    const md = generateManual(operation);

    // Inline rollback becomes a jump-link (one per step with a rollback).
    const jumps = md.match(new RegExp(JUMP, 'g')) ?? [];
    assert.equal(jumps.length, 2, 'both steps link to the plan');

    // The repeated inline rollback heading + legacy Procedures section are gone.
    assert.ok(
      !/### 🔄 Rollback for Step/.test(md),
      'no inline per-step rollback heading',
    );
    assert.ok(
      !/## 🔄 Rollback Procedures/.test(md),
      'legacy Rollback Procedures section suppressed',
    );

    // The consolidated plan carries an explicit anchor and every step's rollback.
    assert.match(md, /<a id="rollback-plan"><\/a>/);
    assert.match(md, /## 🔄 Rollback Plan/);
    assert.match(md, /Roll back web server/);
    assert.match(md, /Discard the backup snapshot/);
    assert.match(md, /Page the on-call SRE/);
  });

  it('single-env: links inline and keeps the aggregated plan', async () => {
    const operation = await parseFixture('rollbackJumpLinks');
    const md = generateSingleEnvManual(operation, 'production');

    const jumps = md.match(new RegExp(JUMP, 'g')) ?? [];
    assert.equal(jumps.length, 2, 'both steps link to the plan');

    // No repeated inline rollback heading for the step.
    assert.ok(
      !/## 🔄 Rollback$/m.test(md.replace(/Rollback Plan/g, '')),
      'no standalone inline step rollback heading',
    );

    assert.match(md, /<a id="rollback-plan"><\/a>/);
    assert.match(md, /## 🔄 Rollback Plan/);
    assert.match(md, /Roll back web server/);
    assert.match(md, /Discard the backup snapshot/);
  });

  it('is off by default: inline rollback bodies still render', async () => {
    // The same operation with the flag cleared keeps the inline rollback body
    // and does NOT emit the jump-link.
    const operation = await parseFixture('rollbackJumpLinks');
    if (operation.rollback) operation.rollback.link_step_rollbacks = false;
    const md = generateManual(operation);

    assert.ok(!JUMP.test(md), 'no jump-link when the flag is off');
    assert.match(md, /### 🔄 Rollback for Step 1/);
  });
});
