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
 * Cross-format render parity test.
 *
 * Exercises every renderable `StepContent` field (command, script,
 * instruction, expect in all its shapes, evidence + results, pic,
 * reviewer, timeout, and rollback with command/expect/pic) against all
 * four generator output formats:
 *   1. Markdown multi-env table (generateManualWithMetadata, no --env)
 *   2. Markdown single-env headings (generateSingleEnvManual, --env)
 *   3. ADF / Confluence JSON (generateADFString)
 *   4. Confluence wiki markup (generateConfluenceContent)
 *
 * This is a presence test, not a snapshot: each field must produce a
 * recognizable marker in every format, with ${VAR} placeholders resolved
 * via --resolve-vars.
 */
describe('Render parity: all StepContent fields across formats', () => {
  const operationDir = path.dirname(getFixturePath('allContentFields'));

  async function generateAll() {
    const operation = await parseFixture('allContentFields');

    const multiEnv = generateManualWithMetadata(
      operation,
      undefined,
      undefined,
      true,
      false,
      operationDir,
    );

    const singleEnv = generateSingleEnvManual(
      operation,
      'staging',
      true,
      operationDir,
    );

    const adf = generateADFString(
      operation,
      undefined,
      undefined,
      true,
      operationDir,
    );

    const confluence = generateConfluenceContent(
      operation,
      true,
      false,
      undefined,
      operationDir,
    );

    return { multiEnv, singleEnv, adf, confluence };
  }

  it('renders command with resolved ${VAR} in all formats', async () => {
    const { multiEnv, singleEnv, adf, confluence } = await generateAll();
    const marker =
      'kubectl apply -f deployment.yaml --context=staging.example.com';

    assert.ok(multiEnv.includes(marker), 'multi-env markdown: command');
    assert.ok(singleEnv.includes(marker), 'single-env markdown: command');
    assert.ok(adf.includes(marker), 'ADF: command');
    assert.ok(confluence.includes(marker), 'Confluence: command');
  });

  it('renders instruction with resolved ${VAR} in all formats', async () => {
    const { multiEnv, singleEnv, adf, confluence } = await generateAll();
    const marker = 'Deploy to staging.example.com and confirm rollout.';

    assert.ok(multiEnv.includes(marker), 'multi-env markdown: instruction');
    assert.ok(singleEnv.includes(marker), 'single-env markdown: instruction');
    assert.ok(adf.includes(marker), 'ADF: instruction');
    assert.ok(confluence.includes(marker), 'Confluence: instruction');
  });

  it('renders script label and embedded content for the automatic step in all formats', async () => {
    const { multiEnv, singleEnv, adf, confluence } = await generateAll();

    for (const [label, content] of Object.entries({
      multiEnv,
      singleEnv,
      adf,
      confluence,
    })) {
      assert.ok(
        content.includes('./deploy.sh'),
        `${label}: should reference script path`,
      );
      assert.ok(
        content.includes('Deploying web server'),
        `${label}: should embed script content`,
      );
    }
  });

  it('renders expect with resolved ${VAR} (ExpectConfig shorthand) in all formats', async () => {
    const { multiEnv, singleEnv, adf, confluence } = await generateAll();
    const marker = 'contains: Deployment to staging.example.com complete';

    assert.ok(multiEnv.includes(marker), 'multi-env markdown: step expect');
    assert.ok(singleEnv.includes(marker), 'single-env markdown: step expect');
    assert.ok(adf.includes(marker), 'ADF: step expect');
    assert.ok(confluence.includes(marker), 'Confluence: step expect');
  });

  it('renders numeric expect (string shorthand resolving to a number) in all formats', async () => {
    const { multiEnv, singleEnv, adf, confluence } = await generateAll();

    // Each format renders the resolved expect value 0 with its own checkbox
    // syntax; pick the marker that matches each format's rendering style.
    const markers: Record<string, string> = {
      multiEnv: '- [ ] _0_',
      singleEnv: '- [ ] 0',
      adf: '- [ ] 0',
      confluence: '* [ ] _0_',
    };

    for (const [label, content] of Object.entries({
      multiEnv,
      singleEnv,
      adf,
      confluence,
    })) {
      assert.ok(
        content.includes(markers[label]),
        `${label}: should render resolved numeric expect (0)`,
      );
      assert.ok(
        !content.includes('${REPLICA_COUNT}'),
        `${label}: should not leave unresolved \${REPLICA_COUNT}`,
      );
    }
  });

  it('renders array-of-checks expect on a sub-step in all formats', async () => {
    const { multiEnv, singleEnv, adf, confluence } = await generateAll();

    for (const [label, content] of Object.entries({
      multiEnv,
      singleEnv,
      adf,
      confluence,
    })) {
      assert.ok(
        content.includes('contains: Running'),
        `${label}: should render sub-step contains check`,
      );
      assert.ok(
        content.includes('does not contain: Failed'),
        `${label}: should render sub-step not_contains check`,
      );
    }
  });

  it('renders pic and reviewer sign-off in all formats', async () => {
    const { multiEnv, singleEnv, adf, confluence } = await generateAll();

    for (const [label, content] of Object.entries({
      multiEnv,
      singleEnv,
      adf,
      confluence,
    })) {
      assert.ok(
        content.includes('ops-team@example.com'),
        `${label}: should render PIC`,
      );
      assert.ok(
        content.includes('sre-lead@example.com'),
        `${label}: should render reviewer`,
      );
    }
  });

  it('renders evidence results (command_output content) in all formats', async () => {
    const { multiEnv, singleEnv, adf, confluence } = await generateAll();
    const marker = 'deployment.apps/web-server created';

    assert.ok(
      multiEnv.includes(marker),
      'multi-env markdown: evidence content',
    );
    assert.ok(
      singleEnv.includes(marker),
      'single-env markdown: evidence content',
    );
    assert.ok(adf.includes(marker), 'ADF: evidence content');
    assert.ok(confluence.includes(marker), 'Confluence: evidence content');
  });

  it('renders rollback command, pic/reviewer, and resolved expect in all formats', async () => {
    const { multiEnv, singleEnv, adf, confluence } = await generateAll();
    const commandMarker =
      'kubectl rollout undo deployment/web-server --context=staging.example.com';
    const expectMarker = 'rolled back on staging.example.com';

    for (const [label, content] of Object.entries({
      multiEnv,
      singleEnv,
      adf,
      confluence,
    })) {
      assert.ok(
        content.includes(commandMarker),
        `${label}: should render rollback command`,
      );
      assert.ok(
        content.includes(expectMarker),
        `${label}: should render resolved rollback expect`,
      );
      assert.ok(
        content.includes('ops-team@example.com') &&
          content.includes('sre-lead@example.com'),
        `${label}: should render rollback sign-off`,
      );
    }
  });
});

describe('Render parity: operation-level (global) rollback across formats', () => {
  async function generateAllGlobalRollback() {
    const operation = await parseFixture('globalRollback');
    const operationDir = path.dirname(getFixturePath('globalRollback'));

    const multiEnv = generateManualWithMetadata(
      operation,
      undefined,
      undefined,
      true,
      false,
      operationDir,
    );
    const singleEnv = generateSingleEnvManual(
      operation,
      'staging',
      true,
      operationDir,
    );
    const adf = generateADFString(
      operation,
      undefined,
      undefined,
      true,
      operationDir,
    );
    const confluence = generateConfluenceContent(
      operation,
      true,
      false,
      undefined,
      operationDir,
    );

    return { multiEnv, singleEnv, adf, confluence };
  }

  it('renders the global rollback heading + automatic/conditions in all formats', async () => {
    const { multiEnv, singleEnv, adf, confluence } =
      await generateAllGlobalRollback();

    for (const [label, content] of Object.entries({
      multiEnv,
      singleEnv,
      adf,
    })) {
      assert.ok(
        content.includes('Rollback Plan'),
        `${label}: should render the rollback plan heading`,
      );
      assert.ok(
        content.includes('No'),
        `${label}: should render automatic flag`,
      );
      assert.ok(
        content.includes('health_check_failure') &&
          content.includes('error_rate_spike'),
        `${label}: should render rollback conditions`,
      );
    }
    // Confluence renders the rollback plan under its own heading
    assert.match(confluence, /Rollback Plan/);
    assert.match(confluence, /health_check_failure/);
  });

  it('renders the global rollback command, instruction, expect, and sign-off in all formats', async () => {
    const { multiEnv, singleEnv, adf, confluence } =
      await generateAllGlobalRollback();

    for (const [label, content] of Object.entries({
      multiEnv,
      singleEnv,
      adf,
      confluence,
    })) {
      assert.ok(
        content.includes('kubectl rollout undo deployment/app'),
        `${label}: should render global rollback command`,
      );
      assert.ok(
        content.includes('Verify rollback completed:'),
        `${label}: should render global rollback instruction`,
      );
      assert.ok(
        content.includes('rolled back'),
        `${label}: should render global rollback expect`,
      );
      assert.ok(
        content.includes('ops-team@example.com') &&
          content.includes('sre-lead@example.com'),
        `${label}: should render global rollback sign-off`,
      );
    }
  });
});
