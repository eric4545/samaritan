import assert from 'node:assert';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  generateManualWithMetadata,
  generateSingleEnvManual,
} from '../../src/manuals/generator';
import { parseRunManifest } from '../../src/operations/run-manifest-parser';
import { parseFixture } from '../fixtures/fixtures';

const STEP_ID_RUN_FIXTURE = join(
  process.cwd(),
  'tests/fixtures/runs/step-id-lookup.yaml',
);

const RUN_FIXTURE = join(
  process.cwd(),
  'tests/fixtures/runs/staging-2025-10-16-v1.yaml',
);

describe('generateManualWithMetadata with run manifest', () => {
  it('includes run info block in output', async () => {
    const operation = await parseFixture('evidenceWithResults');
    const runManifest = parseRunManifest(RUN_FIXTURE);
    const md = generateManualWithMetadata(
      operation,
      undefined,
      undefined,
      false,
      false,
      undefined,
      runManifest,
    );
    assert.ok(md.includes('**Run**: staging-2025-10-16-v1'), 'has run ID');
    assert.ok(md.includes('**Operator**: ops@example.com'), 'has operator');
    assert.ok(md.includes('**Status**: completed'), 'has status');
  });

  it('overlays run manifest evidence over static YAML evidence', async () => {
    const operation = await parseFixture('evidenceWithResults');
    const runManifest = parseRunManifest(RUN_FIXTURE);
    const md = generateManualWithMetadata(
      operation,
      undefined,
      undefined,
      false,
      false,
      undefined,
      runManifest,
    );
    assert.ok(
      md.includes('run 2025-10-16'),
      'uses run manifest description not YAML description',
    );
  });

  it('includes orphaned evidence section for unmatched steps', async () => {
    const operation = await parseFixture('evidenceWithResults');
    const runManifest = parseRunManifest(RUN_FIXTURE);
    const md = generateManualWithMetadata(
      operation,
      undefined,
      undefined,
      false,
      false,
      undefined,
      runManifest,
    );
    assert.ok(
      md.includes('Orphaned Evidence'),
      'has orphaned evidence section',
    );
    assert.ok(md.includes('orphaned-step'), 'lists orphaned step key');
  });

  it('works without run manifest (backward compat)', async () => {
    const operation = await parseFixture('evidenceWithResults');
    const md = generateManualWithMetadata(operation);
    assert.ok(!md.includes('**Run**:'), 'no run info without manifest');
    assert.ok(!md.includes('Orphaned Evidence'), 'no orphaned section');
  });
});

describe('generateSingleEnvManual with run manifest', () => {
  it('includes run info block', async () => {
    const operation = await parseFixture('evidenceWithResults');
    const runManifest = parseRunManifest(RUN_FIXTURE);
    const md = generateSingleEnvManual(
      operation,
      'staging',
      false,
      undefined,
      runManifest,
    );
    assert.ok(md.includes('**Run**: staging-2025-10-16-v1'), 'has run ID');
  });

  it('renders captured evidence under each step', async () => {
    const operation = await parseFixture('evidenceWithResults');
    const runManifest = parseRunManifest(RUN_FIXTURE);
    const md = generateSingleEnvManual(
      operation,
      'staging',
      false,
      undefined,
      runManifest,
    );
    assert.ok(md.includes('**Evidence Captured**'), 'has evidence section');
    assert.ok(
      md.includes('web-server created'),
      'embeds command_output content',
    );
  });

  it('includes orphaned evidence section', async () => {
    const operation = await parseFixture('evidenceWithResults');
    const runManifest = parseRunManifest(RUN_FIXTURE);
    const md = generateSingleEnvManual(
      operation,
      'staging',
      false,
      undefined,
      runManifest,
    );
    assert.ok(md.includes('Orphaned Evidence'), 'has orphaned section');
  });

  it('uses step.id for evidence lookup when available', async () => {
    const op = await parseFixture('withStepIds');
    const run = parseRunManifest(STEP_ID_RUN_FIXTURE);
    const md = generateSingleEnvManual(op, 'staging', false, undefined, run);
    assert.ok(
      md.includes('Found via step.id'),
      'resolves evidence via step.id not slugified name',
    );
  });

  it('falls back to slugified name when step has no id', async () => {
    const operation = await parseFixture('evidenceWithResults');
    const runManifest = parseRunManifest(RUN_FIXTURE);
    // "Deploy Application" → "deploy-application" (slug) must match run manifest key
    const md = generateSingleEnvManual(
      operation,
      'staging',
      false,
      undefined,
      runManifest,
    );
    assert.ok(
      md.includes('Deployment command output (run 2025-10-16)'),
      'slug-based lookup worked',
    );
  });

  it('backward compat: works without run manifest', async () => {
    const operation = await parseFixture('evidenceWithResults');
    const md = generateSingleEnvManual(operation, 'staging');
    assert.ok(!md.includes('**Run**:'), 'no run info');
    assert.ok(!md.includes('Orphaned Evidence'), 'no orphaned section');
  });
});
