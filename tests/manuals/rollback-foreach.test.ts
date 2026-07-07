import assert from 'node:assert';
import { describe, it } from 'node:test';
import { generateConfluenceContent } from '../../src/cli/commands/generate';
import { generateADFString } from '../../src/manuals/adf-generator';
import {
  generateManual,
  generateSingleEnvManual,
} from '../../src/manuals/generator';
import { parseFixture } from '../fixtures/fixtures';

// A rollback step IS a normal step: `foreach`/`matrix` expand at parse time into
// one rollback step per combination. This must hold in every format and for both
// rollback concepts — operation-level `rollback.steps[]` (matrix) and step-level
// `Step.rollback[]` (single-var), including a sub-step rollback. Renders that
// only showed the first entry (`rollback?.[0]`) previously dropped every sibling.
describe('Rollback foreach/matrix rendering (full parity)', () => {
  it('multi-env Markdown renders all expanded rollback steps', async () => {
    const operation = await parseFixture('rollbackForeach');
    const md = generateManual(operation);

    // Operation-level matrix: 4 rows with distinct combo names
    assert.match(md, /\| Rollback Step 1: Restart \(us, web\) \|/);
    assert.match(md, /\| Rollback Step 4: Restart \(eu, api\) \|/);
    // Step-level single-var: both siblings labelled (not just [0])
    assert.match(md, /\*\*Undo tier \(web\)\*\*/);
    assert.match(md, /\*\*Undo tier \(api\)\*\*/);
    // Sub-step rollback foreach
    assert.match(md, /\*\*Revert setting \(a\)\*\*/);
    assert.match(md, /\*\*Revert setting \(b\)\*\*/);
  });

  it('single-env Markdown renders all expanded rollback steps', async () => {
    const operation = await parseFixture('rollbackForeach');
    const md = generateSingleEnvManual(operation, 'production');

    assert.match(md, /### Rollback Step 1: Restart \(us, web\)/);
    assert.match(md, /### Rollback Step 4: Restart \(eu, api\)/);
    assert.match(md, /### 🔄 Rollback: Undo tier \(web\)/);
    assert.match(md, /### 🔄 Rollback: Undo tier \(api\)/);
    assert.match(md, /#### 🔄 Rollback: Revert setting \(a\)/);
  });

  it('ADF renders all expanded rollback steps', async () => {
    const operation = await parseFixture('rollbackForeach');
    const adf = generateADFString(operation, undefined, undefined, false);

    assert.match(adf, /Rollback Step 1: Restart \(us, web\)/);
    assert.match(adf, /Rollback Step 4: Restart \(eu, api\)/);
    assert.match(adf, /Undo tier \(web\)/);
    assert.match(adf, /Undo tier \(api\)/);
    assert.match(adf, /Revert setting \(a\)/);
  });

  it('Confluence renders all expanded rollback steps', async () => {
    const operation = await parseFixture('rollbackForeach');
    const confluence = generateConfluenceContent(operation, false);

    assert.match(confluence, /\| Rollback Step 1: Restart \(us, web\) \|/);
    assert.match(confluence, /\| Rollback Step 4: Restart \(eu, api\) \|/);
    assert.match(confluence, /Rollback for Step 1: Deploy — Undo tier \(web\)/);
    assert.match(confluence, /Rollback for Step 1: Deploy — Undo tier \(api\)/);
  });
});
