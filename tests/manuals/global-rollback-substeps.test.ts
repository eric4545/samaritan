import assert from 'node:assert';
import { describe, it } from 'node:test';
import { generateConfluenceContent } from '../../src/cli/commands/generate';
import { generateADFString } from '../../src/manuals/adf-generator';
import {
  generateManual,
  generateSingleEnvManual,
} from '../../src/manuals/generator';
import { parseFixture } from '../fixtures/fixtures';

// Regression: an operation-level rollback plan step authored with `sub_steps`
// used to render as the `Rollback Step N` heading/row only — the nested body
// was silently dropped in every format. Rollback steps are now structurally
// like normal steps: their sub_steps render recursively as Rollback Step N.M.
describe('Operation-level rollback plan with sub_steps', () => {
  it('renders nested rollback sub_steps in single-env Markdown', async () => {
    const operation = await parseFixture('globalRollbackSubsteps');
    const md = generateSingleEnvManual(operation, 'staging');

    // Parent rollback step keeps its name in the heading
    assert.match(md, /### Rollback Step 2: Tear down canary/);
    // Sub-steps render with their own numbered headings + bodies (not dropped)
    assert.match(md, /#### Rollback Step 2\.1/);
    assert.match(md, /kubectl scale deployment\/app-canary --replicas=0/);
    assert.match(md, /#### Rollback Step 2\.2/);
    assert.match(md, /Confirm canary pods are gone/);
  });

  it('renders nested rollback sub_steps as rows in multi-env Markdown', async () => {
    const operation = await parseFixture('globalRollbackSubsteps');
    const md = generateManual(operation);

    assert.match(md, /\| Rollback Step 2: Tear down canary \|/);
    assert.match(md, /\| Rollback Step 2\.1 \|/);
    assert.match(md, /kubectl scale deployment\/app-canary --replicas=0/);
    assert.match(md, /\| Rollback Step 2\.2 \|/);
  });

  it('renders nested rollback sub_steps in ADF', async () => {
    const operation = await parseFixture('globalRollbackSubsteps');
    const adfText = generateADFString(operation, undefined, undefined, false);

    assert.match(adfText, /Rollback Step 2: Tear down canary/);
    assert.match(adfText, /Rollback Step 2\.1/);
    assert.match(adfText, /kubectl scale deployment\/app-canary --replicas=0/);
    assert.match(adfText, /Rollback Step 2\.2/);
  });

  it('renders nested rollback sub_steps in Confluence', async () => {
    const operation = await parseFixture('globalRollbackSubsteps');
    const confluence = generateConfluenceContent(operation, false);

    assert.match(confluence, /\| Rollback Step 2: Tear down canary \|/);
    assert.match(confluence, /\| Rollback Step 2\.1 \|/);
    assert.match(
      confluence,
      /kubectl scale deployment\/app-canary --replicas=0/,
    );
    assert.match(confluence, /\| Rollback Step 2\.2 \|/);
  });

  it('rejects unknown keys on rollback steps (no silent drop)', async () => {
    // additionalProperties:false on the rollbackStep schema means a typo'd key
    // fails validation loudly instead of being silently ignored.
    const yaml = `name: Bad Rollback
version: 1.0.0
description: typo in rollback step key
environments:
  - name: staging
    description: Staging
steps:
  - name: Deploy
    type: automatic
    command: echo deploy
rollback:
  steps:
    - command: echo undo
      subStepps: []
`;
    const { parseOperation } = await import('../../src/operations/parser');
    await assert.rejects(() => Promise.resolve(parseOperation(yaml)));
  });
});
