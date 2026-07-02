import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  generateManualWithMetadata,
  generateSingleEnvManual,
} from '../../src/manuals/generator';
import { parseOperation } from '../../src/operations/parser';

const FIXTURE_DIR = 'tests/fixtures/operations/features/extends';
// operationDir is deliberately something OTHER than the base's own directory
// to prove extends.ts rebased the base's relative script/evidence paths to
// absolute — if it hadn't, resolving them against this dir would fail.
const CHILD_DIR = FIXTURE_DIR;

describe('extends: manual generation', () => {
  describe('multi-env manual (no --env)', () => {
    it('renders both base and child step names', async () => {
      const op = await parseOperation(`${FIXTURE_DIR}/child-simple.yaml`);
      const md = generateManualWithMetadata(
        op,
        undefined,
        undefined,
        false,
        false,
        CHILD_DIR,
      );

      for (const name of [
        'Base Preflight Check',
        'Base Deploy Script',
        'Base Deploy Verification',
        'Child Deploy Script',
        'Child Smoke Test',
      ]) {
        assert.ok(md.includes(name), `manual should include step: ${name}`);
      }
    });

    it('embeds the base script content (rebased absolute path)', async () => {
      const op = await parseOperation(`${FIXTURE_DIR}/child-simple.yaml`);
      const md = generateManualWithMetadata(
        op,
        undefined,
        undefined,
        false,
        false,
        CHILD_DIR,
      );

      assert.ok(
        md.includes('Running base deploy script...'),
        'should embed base script content',
      );
    });

    it('embeds the child script content', async () => {
      const op = await parseOperation(`${FIXTURE_DIR}/child-simple.yaml`);
      const md = generateManualWithMetadata(
        op,
        undefined,
        undefined,
        false,
        false,
        CHILD_DIR,
      );

      assert.ok(
        md.includes('Running child deploy script...'),
        'should embed child script content',
      );
    });

    it('embeds base evidence.results file content in the production column', async () => {
      const op = await parseOperation(`${FIXTURE_DIR}/child-simple.yaml`);
      const md = generateManualWithMetadata(
        op,
        undefined,
        undefined,
        false,
        false,
        CHILD_DIR,
      );

      assert.ok(
        md.includes('deployment.apps/base-web-server created'),
        'should embed base evidence file content',
      );
    });
  });

  describe('single-env manual (--env production)', () => {
    it('renders both base and child step names for the selected environment', async () => {
      const op = await parseOperation(`${FIXTURE_DIR}/child-simple.yaml`);
      const md = generateSingleEnvManual(op, 'production', false, CHILD_DIR);

      for (const name of [
        'Base Preflight Check',
        'Base Deploy Script',
        'Base Deploy Verification',
        'Child Deploy Script',
        'Child Smoke Test',
      ]) {
        assert.ok(md.includes(name), `manual should include step: ${name}`);
      }
    });

    it('embeds the base script content (rebased absolute path)', async () => {
      const op = await parseOperation(`${FIXTURE_DIR}/child-simple.yaml`);
      const md = generateSingleEnvManual(op, 'production', false, CHILD_DIR);

      assert.ok(
        md.includes('Running base deploy script...'),
        'should embed base script content in single-env manual',
      );
    });

    it('embeds base evidence.results file content for production', async () => {
      const op = await parseOperation(`${FIXTURE_DIR}/child-simple.yaml`);
      const md = generateSingleEnvManual(op, 'production', false, CHILD_DIR);

      assert.ok(
        md.includes('deployment.apps/base-web-server created'),
        'should embed base evidence file content in single-env manual',
      );
    });
  });

  describe('3-level chain', () => {
    it('embeds the base script content through the full chain in the grandchild manual', async () => {
      const op = await parseOperation(`${FIXTURE_DIR}/chain-grandchild.yaml`);
      const md = generateManualWithMetadata(
        op,
        undefined,
        undefined,
        false,
        false,
        CHILD_DIR,
      );

      assert.ok(
        md.includes('Running base deploy script...'),
        "should embed base script content through the grandchild's ancestry",
      );
      assert.ok(md.includes('Grandchild Final Step'));
    });
  });
});
