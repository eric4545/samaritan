import assert from 'node:assert';
import { describe, it } from 'node:test';
import { generateManual } from '../../src/manuals/generator';
import { parseOperation } from '../../src/operations/parser';

describe('Template Import Manual Generation', () => {
  it('should generate a manual with steps expanded from templates', async () => {
    const operation = await parseOperation(
      'tests/fixtures/operations/valid/with-template-import.yaml',
    );
    const manual = generateManual(operation);

    // Steps from health-checks.yaml template (first import)
    assert.ok(
      manual.includes('Check API Health'),
      'Should include health check step name',
    );
    assert.ok(
      manual.includes('Verify Database Connection'),
      'Should include db check step name',
    );

    // Regular inline step
    assert.ok(
      manual.includes('Deploy Application'),
      'Should include regular step name',
    );

    // Steps from notification.yaml template
    assert.ok(
      manual.includes('Send Slack Notification'),
      'Should include Slack notification step',
    );
    assert.ok(
      manual.includes('Send Email Notification'),
      'Should include email notification step',
    );

    // Manual should have substantial content
    assert.ok(manual.length > 500, 'Manual should have substantial content');
  });

  it('should render all 7 expanded template steps in the output table', async () => {
    const operation = await parseOperation(
      'tests/fixtures/operations/valid/with-template-import.yaml',
    );

    assert.strictEqual(
      operation.steps.length,
      7,
      'Should have 7 steps after template expansion',
    );

    const manual = generateManual(operation);
    assert.ok(manual.length > 0, 'Manual should not be empty');

    // All step names should appear in output
    const stepNames = operation.steps.map((s) => s.name);
    for (const name of stepNames) {
      assert.ok(manual.includes(name), `Manual should include step: ${name}`);
    }
  });
});
