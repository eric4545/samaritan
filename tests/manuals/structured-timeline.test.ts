import assert from 'node:assert';
import { describe, it } from 'node:test';
import { generateConfluenceContent } from '../../src/cli/commands/generate';
import { generateADFString } from '../../src/manuals/adf-generator';
import {
  generateManualWithMetadata,
  generateSingleEnvManual,
} from '../../src/manuals/generator';
import { parseFixture } from '../fixtures/fixtures';

/**
 * Regression test: structured `timeline:` objects (start/duration/after)
 * must render via formatTimelineForDisplay in every output format — never
 * as the default `[object Object]` string interpolation.
 *
 * Historical bugs: the ADF step/sub-step cells and the multi-env markdown
 * section-heading metadata interpolated the raw object.
 */
describe('Structured timeline rendering across formats', () => {
  async function generateAll() {
    const operation = await parseFixture('structuredTimeline');

    return {
      multiEnv: generateManualWithMetadata(operation),
      singleEnv: generateSingleEnvManual(operation, 'staging'),
      adf: generateADFString(operation),
      confluence: generateConfluenceContent(operation),
    };
  }

  it('never renders [object Object] in any format', async () => {
    const formats = await generateAll();

    for (const [label, content] of Object.entries(formats)) {
      assert.ok(
        !content.includes('[object Object]'),
        `${label}: structured timeline must not render as [object Object]`,
      );
    }
  });

  it('renders start + duration timelines formatted in all formats', async () => {
    const formats = await generateAll();
    const stepMarker = '2024-01-15 09:00 for 30m';
    const sectionHeadingMarker = '2024-01-15 10:00 for 15m';

    for (const [label, content] of Object.entries(formats)) {
      assert.ok(
        content.includes(stepMarker),
        `${label}: should render top-level step timeline formatted`,
      );
      assert.ok(
        content.includes(sectionHeadingMarker),
        `${label}: should render section-heading sub-step timeline formatted`,
      );
    }
  });

  it('renders after + duration timelines formatted in all formats', async () => {
    const formats = await generateAll();
    const marker = '(after Deploy service) 10m';

    for (const [label, content] of Object.entries(formats)) {
      assert.ok(
        content.includes(marker),
        `${label}: should render sub-step after-timeline formatted`,
      );
    }
  });
});
