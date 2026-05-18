import assert from 'node:assert';
import { describe, it } from 'node:test';
import { generateSingleEnvManual } from '../../src/manuals/generator';
import { parseFixture } from '../fixtures/fixtures';

describe('Bug 1 — multi-line description must not be wrapped in italic markers', () => {
  it('multi-line description is not wrapped in _..._', async () => {
    const op = await parseFixture('multilineDescription');
    const md = generateSingleEnvManual(op, 'staging');

    // The announce step has a multi-line description; it must not start with _
    const announceIdx = md.indexOf('announce');
    assert.ok(announceIdx >= 0, 'announce step present');

    const deployIdx = md.indexOf('Deploy App');
    const announceSection = md.slice(announceIdx, deployIdx);

    assert.ok(
      !announceSection.includes('_Post to'),
      'multi-line description must not start with _ (italic marker)',
    );
    assert.ok(
      !/proceeding\.\s*_/.test(announceSection),
      'multi-line description must not end with _ on its own line',
    );
  });

  it('multi-line description body text is present', async () => {
    const op = await parseFixture('multilineDescription');
    const md = generateSingleEnvManual(op, 'staging');

    assert.ok(md.includes('Post to'), 'first line of description present');
    assert.ok(
      md.includes('Capture thread timestamp'),
      'last line of description present',
    );
  });

  it('single-line description may still be wrapped in italic', async () => {
    const op = await parseFixture('multilineDescription');
    const md = generateSingleEnvManual(op, 'staging');

    // The Deploy App step has a single-line description
    const deployIdx = md.indexOf('Deploy App');
    assert.ok(deployIdx >= 0, 'Deploy App step present');
    const deploySection = md.slice(deployIdx);

    assert.ok(
      deploySection.includes('_Single-line step description_'),
      'single-line description wrapped in italics',
    );
  });
});
