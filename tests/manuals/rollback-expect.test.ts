import assert from 'node:assert';
import path from 'node:path';
import { describe, it } from 'node:test';
import { generateADFString } from '../../src/manuals/adf-generator';
import {
  generateManualWithMetadata,
  generateSingleEnvManual,
} from '../../src/manuals/generator';
import { getFixturePath, parseFixture } from '../fixtures/fixtures';

describe('Rollback expect rendering across formats', () => {
  it('renders rollback expect checkboxes in the multi-env Markdown manual', async () => {
    const operation = await parseFixture('confluenceScriptAndExpect');
    const operationDir = path.dirname(
      getFixturePath('confluenceScriptAndExpect'),
    );

    const manual = generateManualWithMetadata(
      operation,
      undefined,
      undefined,
      false,
      false,
      operationDir,
    );

    assert.match(
      manual,
      /Rollback for Step 1: Deploy Application/,
      'should render inline rollback section for step 1',
    );
    assert.match(
      manual,
      /_Expected:_<br>- \[ \] _contains: rolled back_/,
      'should render rollback expect as a checkbox',
    );
  });

  it('renders rollback expect checkboxes in the single-env Markdown manual', async () => {
    const operation = await parseFixture('confluenceScriptAndExpect');
    const operationDir = path.dirname(
      getFixturePath('confluenceScriptAndExpect'),
    );

    const manual = generateSingleEnvManual(
      operation,
      'staging',
      false,
      operationDir,
    );

    assert.match(
      manual,
      /> Expected:\n> - \[ \] contains: rolled back/,
      'should render rollback expect as a blockquote checkbox in single-env output',
    );
  });

  it('renders rollback expect checkboxes in the ADF manual', async () => {
    const operation = await parseFixture('confluenceScriptAndExpect');
    const operationDir = path.dirname(
      getFixturePath('confluenceScriptAndExpect'),
    );

    const adfString = generateADFString(
      operation,
      undefined,
      undefined,
      false,
      operationDir,
    );

    assert.match(
      adfString,
      /Rollback for: Deploy Application/,
      'should render rollback section heading',
    );
    assert.match(
      adfString,
      /- \[ \] contains: rolled back/,
      'should render rollback expect as a checkbox in ADF',
    );
  });
});
