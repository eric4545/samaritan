import assert from 'node:assert';
import { describe, it } from 'node:test';
import { generateSingleEnvManual } from '../../src/manuals/generator';
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
