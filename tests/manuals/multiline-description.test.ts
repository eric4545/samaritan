import assert from 'node:assert';
import { describe, it } from 'node:test';
import { generateSingleEnvManual } from '../../src/manuals/generator';
import type { Operation } from '../../src/models/operation';

function makeOp(stepDescription: string): Operation {
  return {
    id: 'test-op',
    name: 'Test Operation',
    version: '1.0.0',
    description: '',
    environments: [
      {
        name: 'staging',
        description: '',
        variables: {},
        restrictions: [],
        approval_required: false,
        validation_required: false,
      },
    ],
    variables: {},
    steps: [
      { name: 'Test Step', type: 'manual', description: stepDescription },
    ],
    preflight: [],
    metadata: { created_at: new Date(), updated_at: new Date() },
  };
}

describe('Bug 1 — multi-line description must not be wrapped in italic markers', () => {
  it('multi-line description is not wrapped in _..._', () => {
    const md = generateSingleEnvManual(makeOp('line one\nline two'), 'staging');
    assert.ok(!md.includes('_line one'), 'must not open with italic marker');
    assert.ok(!/two_/.test(md), 'must not close with italic marker');
  });

  it('multi-line description content is preserved', () => {
    const md = generateSingleEnvManual(makeOp('line one\nline two'), 'staging');
    assert.ok(md.includes('line one'), 'first line present');
    assert.ok(md.includes('line two'), 'second line present');
  });

  it('multi-line description with fenced code block is not wrapped in _..._', () => {
    const desc = 'Run this:\n```bash\necho hello\n```\nDone.';
    const md = generateSingleEnvManual(makeOp(desc), 'staging');
    assert.ok(!md.includes('_Run this'), 'must not open with italic marker');
    assert.ok(md.includes('```bash'), 'fenced block preserved');
  });

  it('single-line description is wrapped in italic', () => {
    const md = generateSingleEnvManual(
      makeOp('single line description'),
      'staging',
    );
    assert.ok(
      md.includes('_single line description_'),
      'single-line wrapped in italics',
    );
  });
});
