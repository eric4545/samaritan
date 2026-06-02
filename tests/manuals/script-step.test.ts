import assert from 'node:assert';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  generateManualWithMetadata,
  generateSingleEnvManual,
} from '../../src/manuals/generator';
import { getFixturePath, parseFixture } from '../fixtures/fixtures';

const FIXTURE_DIR = path.dirname(getFixturePath('withScript'));

describe('Script step field', () => {
  it('parses script field from YAML', async () => {
    const op = await parseFixture('withScript');
    const step = op.steps[0];
    assert.strictEqual(step.script, './deploy.sh');
    assert.strictEqual(step.command, undefined);
  });

  it('parses step with only script and no instruction', async () => {
    const op = await parseFixture('withScript');
    const step = op.steps[1];
    assert.strictEqual(step.script, './deploy.sh');
    assert.strictEqual(step.instruction, undefined);
  });

  describe('Markdown multi-env table format', () => {
    it('renders Script label and file path in table cell', async () => {
      const op = await parseFixture('withScript');
      const md = generateManualWithMetadata(
        op,
        undefined,
        undefined,
        false,
        false,
        FIXTURE_DIR,
      );

      assert.ok(
        md.includes('**Script:** `./deploy.sh`'),
        'should include script label and path',
      );
    });

    it('embeds script content as bash code block in table cell', async () => {
      const op = await parseFixture('withScript');
      const md = generateManualWithMetadata(
        op,
        undefined,
        undefined,
        false,
        false,
        FIXTURE_DIR,
      );

      assert.ok(
        md.includes('```bash'),
        'should include bash code fence marker',
      );
      assert.ok(
        md.includes('kubectl apply -f k8s/deployment.yaml'),
        'should embed script content',
      );
      assert.ok(
        md.includes('kubectl rollout status deployment/web-server'),
        'should embed full script content',
      );
    });

    it('shows script label without content when no operationDir provided', async () => {
      const op = await parseFixture('withScript');
      const md = generateManualWithMetadata(op);

      assert.ok(
        md.includes('**Script:** `./deploy.sh`'),
        'should still show script label',
      );
      assert.ok(
        !md.includes('kubectl apply -f k8s/deployment.yaml'),
        'should not embed content without operationDir',
      );
    });

    it('shows step with both instruction and script', async () => {
      const op = await parseFixture('withScript');
      const md = generateManualWithMetadata(
        op,
        undefined,
        undefined,
        false,
        false,
        FIXTURE_DIR,
      );

      assert.ok(
        md.includes('Run the deployment script to update the application.'),
        'should include instruction text',
      );
      assert.ok(
        md.includes('**Script:** `./deploy.sh`'),
        'should include script after instruction',
      );
    });
  });

  describe('Single-env heading format', () => {
    it('renders Script label and path in heading format', async () => {
      const op = await parseFixture('withScript');
      const md = generateSingleEnvManual(op, 'staging', false, FIXTURE_DIR);

      assert.ok(
        md.includes('**Script:** `./deploy.sh`'),
        'should include script label',
      );
    });

    it('embeds script content as fenced bash block in heading format', async () => {
      const op = await parseFixture('withScript');
      const md = generateSingleEnvManual(op, 'staging', false, FIXTURE_DIR);

      assert.ok(md.includes('```bash'), 'should have bash fence');
      assert.ok(
        md.includes('kubectl apply -f k8s/deployment.yaml'),
        'should embed script content',
      );
    });

    it('shows file-not-found message when script path is invalid', async () => {
      const op = await parseFixture('withScript');
      const modifiedOp = {
        ...op,
        steps: [
          {
            ...op.steps[0],
            script: './nonexistent.sh',
          },
        ],
      };
      const md = generateSingleEnvManual(
        modifiedOp,
        'staging',
        false,
        FIXTURE_DIR,
      );

      assert.ok(
        md.includes('Script file not found') || md.includes('nonexistent.sh'),
        'should show not-found message',
      );
    });
  });

  describe('Rollback with script, pic, and reviewer', () => {
    it('parses rollback script, pic, reviewer from YAML', async () => {
      const op = await parseFixture('withScript');
      const rollback = op.steps[0].rollback?.[0];
      assert.strictEqual(rollback?.script, './deploy.sh');
      assert.strictEqual(rollback?.pic, 'ops-lead@example.com');
      assert.strictEqual(rollback?.reviewer, 'sre-buddy@example.com');
    });

    it('renders rollback script in multi-env table format', async () => {
      const op = await parseFixture('withScript');
      const md = generateManualWithMetadata(
        op,
        undefined,
        undefined,
        false,
        false,
        FIXTURE_DIR,
      );
      assert.ok(
        md.includes('**Script:** `./deploy.sh`'),
        'rollback should include script label',
      );
      assert.ok(
        md.includes('kubectl apply -f k8s/deployment.yaml'),
        'rollback should embed script content',
      );
    });

    it('renders rollback pic and reviewer sign-off checkboxes in multi-env format', async () => {
      const op = await parseFixture('withScript');
      const md = generateManualWithMetadata(
        op,
        undefined,
        undefined,
        false,
        false,
        FIXTURE_DIR,
      );
      assert.ok(
        md.includes('- [ ] PIC (ops-lead@example.com)'),
        'rollback should have PIC checkbox',
      );
      assert.ok(
        md.includes('- [ ] Reviewer (sre-buddy@example.com)'),
        'rollback should have Reviewer checkbox',
      );
    });

    it('renders rollback script in single-env heading format', async () => {
      const op = await parseFixture('withScript');
      const md = generateSingleEnvManual(op, 'staging', false, FIXTURE_DIR);
      assert.ok(
        md.includes('**Script:** `./deploy.sh`'),
        'rollback single-env should include script label',
      );
      assert.ok(
        md.includes('kubectl apply -f k8s/deployment.yaml'),
        'rollback single-env should embed script content',
      );
    });

    it('renders rollback pic and reviewer in single-env heading format', async () => {
      const op = await parseFixture('withScript');
      const md = generateSingleEnvManual(op, 'staging', false, FIXTURE_DIR);
      assert.ok(
        md.includes('- [ ] PIC (ops-lead@example.com)'),
        'rollback single-env should have PIC checkbox',
      );
      assert.ok(
        md.includes('- [ ] Reviewer (sre-buddy@example.com)'),
        'rollback single-env should have Reviewer checkbox',
      );
    });
  });
});
