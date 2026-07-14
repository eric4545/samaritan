import assert from 'node:assert';
import { describe, it } from 'node:test';
import { generateConfluenceContent } from '../../src/cli/commands/generate';
import { generateADFString } from '../../src/manuals/adf-generator';
import {
  generateManual,
  generateSingleEnvManual,
} from '../../src/manuals/generator';
import { parseFixture } from '../fixtures/fixtures';

// A rollback step IS a normal step: `uses:`/`with:` file composition expands at
// parse time into a flat RollbackStep[], so every renderer sees the imported
// steps directly (no format-specific uses awareness). This must hold in every
// format and for BOTH rollback concepts — step-level `Step.rollback[]` and
// operation-level `rollback.steps[]`.
describe('Rollback uses:/with: rendering (full parity)', () => {
  it('multi-env Markdown renders the imported rollback steps at both sites', async () => {
    const operation = await parseFixture('rollbackWithUses');
    const md = generateManual(operation);

    // Step-level rollback imported (SERVICE=web)
    assert.match(md, /Restore web to previous revision/);
    assert.match(md, /kubectl rollout undo deployment\/web/);
    // Operation-level rollback: plain step + imported (SERVICE=api)
    assert.match(md, /Announce rollback/);
    assert.match(md, /Rollback Step 2: Restore api to previous revision/);
    assert.match(md, /kubectl rollout undo deployment\/api/);
  });

  it('single-env Markdown renders the imported rollback steps', async () => {
    const operation = await parseFixture('rollbackWithUses');
    const md = generateSingleEnvManual(operation, 'production');

    assert.match(md, /### 🔄 Rollback: Restore web to previous revision/);
    assert.match(md, /### Rollback Step 2: Restore api to previous revision/);
    assert.match(md, /kubectl rollout undo deployment\/api/);
  });

  it('ADF renders the imported rollback steps', async () => {
    const operation = await parseFixture('rollbackWithUses');
    const adf = generateADFString(operation, undefined, undefined, false);

    assert.match(adf, /Restore web to previous revision/);
    assert.match(adf, /Restore api to previous revision/);
    assert.match(adf, /kubectl rollout undo deployment\/api/);
  });

  it('Confluence renders the imported rollback steps', async () => {
    const operation = await parseFixture('rollbackWithUses');
    const confluence = generateConfluenceContent(operation, false);

    assert.match(confluence, /Restore web to previous revision/);
    assert.match(confluence, /Restore api to previous revision/);
    assert.match(confluence, /kubectl rollout undo deployment\/api/);
  });
});
