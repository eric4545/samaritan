import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  generateManual,
  generateSingleEnvManual,
} from '../../src/manuals/generator';
import { parseOperation } from '../../src/operations/parser';
import { parseFixture } from '../fixtures/fixtures';

describe('Bug 3 — preflight instruction field rendered in single-env manual', () => {
  it('instruction content appears in output', async () => {
    const op = await parseFixture('preflightInstruction');
    const md = generateSingleEnvManual(op, 'dev');

    assert.ok(md.includes('**Instructions**'), 'has Instructions label');
    assert.ok(md.includes('Post to'), 'instruction body present');
    assert.ok(
      md.includes('Capture thread timestamp'),
      'full instruction content present',
    );
  });

  it('step title and description still rendered', async () => {
    const op = await parseFixture('preflightInstruction');
    const md = generateSingleEnvManual(op, 'dev');

    assert.ok(md.includes('announce'), 'step name present');
    assert.ok(md.includes('Post announcement'), 'description present');
  });

  it('preflight step with no instruction does not emit Instructions label', async () => {
    const op = await parseFixture('preflightInstruction');
    const md = generateSingleEnvManual(op, 'dev');

    // The socks-proxy step has no instruction, only command
    const socksIdx = md.indexOf('socks-proxy');
    const deployIdx = md.indexOf('Deploy App');
    const sectionBetween = md.slice(socksIdx, deployIdx);
    // Should contain command but no stray Instructions heading from a missing field
    assert.ok(sectionBetween.includes('**Command**'), 'command block present');
  });
});

describe('Bug 4 — preflight command with pre-fenced blocks not double-wrapped', () => {
  it('command containing fenced block is not wrapped in outer ```bash fence', async () => {
    const op = await parseFixture('preflightInstruction');
    const md = generateSingleEnvManual(op, 'dev');

    // Find the socks-proxy section
    const socksIdx = md.indexOf('socks-proxy');
    assert.ok(socksIdx >= 0, 'socks-proxy step present');

    const deployIdx = md.indexOf('Deploy App');
    const section = md.slice(socksIdx, deployIdx);

    // Must not contain nested opening fence: ```bash followed by ```bash
    assert.ok(!/```bash\s*```bash/.test(section), 'no nested ```bash fences');

    // The original ssh command should be present
    assert.ok(section.includes('ssh -D 6666'), 'ssh command content present');
  });

  it('plain command (no pre-existing fences) still wrapped in ```bash', async () => {
    const op = await parseFixture('preflightInstruction');
    const md = generateSingleEnvManual(op, 'dev');

    // The Deploy App step has a plain command
    assert.ok(
      md.includes('```bash\nkubectl apply'),
      'plain command wrapped in ```bash',
    );
  });
});

describe('uses: preflight is scoped to the reused block', () => {
  it('keeps a reused block preflight local instead of hoisting it', async () => {
    const op = await parseOperation('examples/scoped-preflight.yaml');
    const md = generateManual(op);

    const preIdx = md.indexOf('## 🛫 Pre-Flight Phase');
    const flightIdx = md.indexOf('## ✈️ Flight Phase');
    const postIdx = md.indexOf('## 🛬 Post-Flight Phase');
    assert.ok(
      preIdx >= 0 && flightIdx > preIdx && postIdx > flightIdx,
      'all three phase sections present and ordered',
    );

    const preSection = md.slice(preIdx, flightIdx);
    const flightSection = md.slice(flightIdx, postIdx);

    // The top-level preflight step hoists into the global Pre-Flight section.
    assert.ok(
      preSection.includes('Confirm Change Window'),
      'top-level preflight stays in the Pre-Flight section',
    );
    // The reused block's preflight checks do NOT hoist to the top.
    assert.ok(
      !preSection.includes('Verify DB Reachable'),
      'reused block preflight is not in the global Pre-Flight section',
    );

    // They render locally inside the Flight section, right before the block's
    // flight steps, and still carry a "Phase: preflight" badge.
    const dbReachable = flightSection.indexOf('Verify DB Reachable');
    const runMigrations = flightSection.indexOf('Run Migrations');
    assert.ok(
      dbReachable >= 0,
      'block preflight renders in the Flight section',
    );
    assert.ok(
      runMigrations > dbReachable,
      'block preflight renders before the block flight steps',
    );
    assert.ok(
      flightSection.includes('Phase: preflight'),
      'reused preflight step labelled with its phase locally',
    );
  });
});
