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
 * `type: link` evidence (a chat message, a CI build, a dashboard URL) renders
 * as a LINK in every format. Before, the only way to record a URL was a
 * `command_output`/`log` result, which put it in a code block.
 */
describe('link and text evidence results across formats', () => {
  const NOTICE = 'https://chat.example.com/archives/C0000000/p1700000000';
  const ROLLBACK = 'https://ci.example.com/job/web-server-rollback/7/console';

  async function generateAll() {
    const operation = await parseFixture('evidenceKinds');
    const dir = path.dirname(getFixturePath('evidenceKinds'));
    return {
      multiEnv: generateManualWithMetadata(
        operation,
        undefined,
        undefined,
        true,
        false,
        dir,
      ),
      singleEnv: generateSingleEnvManual(operation, 'staging', true, dir),
      adf: generateADFString(operation, undefined, undefined, true, dir),
      confluence: generateConfluenceContent(
        operation,
        true,
        false,
        undefined,
        dir,
      ),
    };
  }

  it('Markdown (multi-env and --env) renders an autolink, not a code block', async () => {
    const { multiEnv, singleEnv } = await generateAll();
    for (const [label, md] of Object.entries({ multiEnv, singleEnv })) {
      assert.ok(md.includes(`<${NOTICE}>`), `${label}: step link`);
      assert.ok(md.includes(`<${ROLLBACK}>`), `${label}: rollback link`);
      assert.ok(
        !new RegExp(`\`\`\`\\w*(<br>|\\n)${NOTICE}`).test(md),
        `${label}: the URL must not be fenced`,
      );
      assert.ok(md.includes('Deploy notice in the ops channel'), label);
      assert.ok(md.includes('web-server 1.4.2 going out to staging'), label);
    }
  });

  it('Confluence markup renders a wiki link', async () => {
    const { confluence } = await generateAll();
    assert.ok(confluence.includes(`[${NOTICE}]`), confluence);
    assert.ok(confluence.includes(`[${ROLLBACK}]`), 'rollback link');
    assert.ok(!confluence.includes(`{code:text}\n${NOTICE}`));
  });

  it('ADF renders a text node with a link mark', async () => {
    const { adf } = await generateAll();
    const linked = (url: string): boolean =>
      JSON.stringify(JSON.parse(adf)).includes(
        JSON.stringify({
          type: 'text',
          text: url,
          marks: [{ type: 'link', attrs: { href: url } }],
        }),
      );
    assert.ok(linked(NOTICE), 'step link');
    assert.ok(linked(ROLLBACK), 'rollback link');
  });
});
