import assert from 'node:assert';
import path from 'node:path';
import { describe, it } from 'node:test';
import { generateConfluenceContent } from '../../src/cli/commands/generate';
import { generateADFString } from '../../src/manuals/adf-generator';
import {
  generateManualWithMetadata,
  generateSingleEnvManual,
} from '../../src/manuals/generator';
import { getFixturePath, parseFixture } from '../fixtures/fixtures';

/**
 * Regression test: rollback steps carry an `evidence` block just like normal
 * steps, and it must render in every output format for BOTH rollback concepts
 * (step-level Step.rollback AND the operation-level rollback plan).
 *
 * Historical gap: the ADF `buildRollbackCellNodes` and the single-env markdown
 * `renderRollbackStepSingleEnv` dropped rb.evidence entirely.
 */
describe('Rollback evidence rendering across formats', () => {
  async function generateAll() {
    const operation = await parseFixture('rollbackWithEvidence');
    const operationDir = path.dirname(getFixturePath('rollbackWithEvidence'));

    return {
      multiEnv: generateManualWithMetadata(
        operation,
        undefined,
        undefined,
        true,
        false,
        operationDir,
      ),
      singleEnv: generateSingleEnvManual(
        operation,
        'staging',
        true,
        operationDir,
      ),
      adf: generateADFString(
        operation,
        undefined,
        undefined,
        true,
        operationDir,
      ),
      confluence: generateConfluenceContent(
        operation,
        true,
        false,
        undefined,
        operationDir,
      ),
    };
  }

  it('renders step-level rollback evidence in all formats', async () => {
    const formats = await generateAll();
    const marker = 'deployment.apps/web rolled back';

    for (const [label, content] of Object.entries(formats)) {
      assert.ok(
        content.includes(marker),
        `${label}: should render step-level rollback evidence content`,
      );
    }
  });

  it('renders operation-level rollback-plan evidence in all formats', async () => {
    const formats = await generateAll();
    const marker = 'pg_restore: restored 42 tables';

    for (const [label, content] of Object.entries(formats)) {
      assert.ok(
        content.includes(marker),
        `${label}: should render operation-level rollback evidence content`,
      );
    }
  });
});
