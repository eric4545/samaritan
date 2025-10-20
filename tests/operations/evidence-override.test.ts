import assert from 'node:assert';
import { describe, it } from 'node:test';
import { parseFixture } from '../fixtures/fixtures';

describe('Evidence Override in use: Directive', () => {
  it('should override evidence results when using imported steps', async () => {
    const operation = await parseFixture('evidenceOverrideInUse');

    // Verify operation parsed correctly
    assert.strictEqual(
      operation.name,
      'Service Migration with Evidence Override',
    );
    assert.strictEqual(operation.version, '1.0.0');

    // Verify environments
    assert.strictEqual(operation.environments.length, 2);
    const preprodEnv = operation.environments.find(
      (env) => env.name === 'preprod',
    );
    const prodEnv = operation.environments.find((env) => env.name === 'prod');
    assert.ok(preprodEnv);
    assert.ok(prodEnv);

    // Verify steps (3 total: 2 imported with evidence override + 1 regular)
    assert.strictEqual(operation.steps.length, 3);

    // Step 1: check-afd-health (imported with evidence override)
    const afdHealthStep = operation.steps[0];
    assert.strictEqual(afdHealthStep.name, 'check-afd-health');
    assert.strictEqual(afdHealthStep.type, 'manual');
    assert.strictEqual(afdHealthStep.phase, 'preflight');

    // Verify evidence configuration
    assert.ok(afdHealthStep.evidence);
    assert.strictEqual(afdHealthStep.evidence.required, true);
    assert.ok(Array.isArray(afdHealthStep.evidence.types));
    assert.strictEqual(afdHealthStep.evidence.types.length, 2);
    assert.ok(afdHealthStep.evidence.types.includes('command_output'));
    assert.ok(afdHealthStep.evidence.types.includes('screenshot'));

    // Verify environment-specific evidence results were overridden
    assert.ok(afdHealthStep.evidence.results);
    assert.ok(afdHealthStep.evidence.results.preprod);
    assert.ok(afdHealthStep.evidence.results.prod);

    // Check preprod evidence
    const preprodEvidence = afdHealthStep.evidence.results.preprod;
    assert.strictEqual(preprodEvidence.length, 2);
    assert.strictEqual(preprodEvidence[0].type, 'screenshot');
    assert.strictEqual(
      preprodEvidence[0].file,
      './evidence/preprod/afd-health.png',
    );
    assert.strictEqual(
      preprodEvidence[0].description,
      'Preprod AFD health dashboard (2025-10-10)',
    );
    assert.strictEqual(preprodEvidence[1].type, 'command_output');
    assert.ok(preprodEvidence[1].content);
    assert.ok(preprodEvidence[1].content.includes('HTTP/1.1 200 OK'));

    // Check prod evidence
    const prodEvidence = afdHealthStep.evidence.results.prod;
    assert.strictEqual(prodEvidence.length, 2);
    assert.strictEqual(prodEvidence[0].type, 'screenshot');
    assert.strictEqual(prodEvidence[0].file, './evidence/prod/afd-health.png');
    assert.strictEqual(
      prodEvidence[0].description,
      'Production AFD health dashboard (2025-10-20)',
    );
    assert.strictEqual(prodEvidence[1].type, 'command_output');
    assert.ok(prodEvidence[1].content);
    assert.ok(prodEvidence[1].content.includes('us-east-1, us-west-2'));

    // Step 2: verify-dns (imported with evidence override)
    const dnsStep = operation.steps[1];
    assert.strictEqual(dnsStep.name, 'verify-dns');
    assert.strictEqual(dnsStep.type, 'manual');
    assert.strictEqual(dnsStep.phase, 'preflight');

    // Verify evidence configuration
    assert.ok(dnsStep.evidence);
    assert.strictEqual(dnsStep.evidence.required, true);

    // Verify environment-specific evidence results were overridden
    assert.ok(dnsStep.evidence.results);
    assert.ok(dnsStep.evidence.results.preprod);
    assert.ok(dnsStep.evidence.results.prod);

    // Check preprod DNS evidence
    const preprodDnsEvidence = dnsStep.evidence.results.preprod;
    assert.strictEqual(preprodDnsEvidence.length, 1);
    assert.strictEqual(preprodDnsEvidence[0].type, 'command_output');
    assert.ok(preprodDnsEvidence[0].content);
    assert.ok(preprodDnsEvidence[0].content.includes('preprod.example.com'));

    // Check prod DNS evidence
    const prodDnsEvidence = dnsStep.evidence.results.prod;
    assert.strictEqual(prodDnsEvidence.length, 1);
    assert.strictEqual(prodDnsEvidence[0].type, 'command_output');
    assert.ok(prodDnsEvidence[0].content);
    assert.ok(prodDnsEvidence[0].content.includes('example.com'));

    // Step 3: Regular step (no evidence override)
    const deployStep = operation.steps[2];
    assert.strictEqual(deployStep.name, 'Deploy Application');
    assert.strictEqual(deployStep.type, 'manual');
    assert.strictEqual(deployStep.phase, 'flight');
    assert.ok(deployStep.evidence);
    assert.strictEqual(deployStep.evidence.required, true);
    assert.ok(!deployStep.evidence.results); // No results provided
  });

  it('should preserve instruction from imported step when overriding evidence', async () => {
    const operation = await parseFixture('evidenceOverrideInUse');

    const afdHealthStep = operation.steps[0];

    // Verify that instruction from imported step is preserved
    assert.ok(afdHealthStep.instruction);
    assert.ok(afdHealthStep.instruction.includes('Check AFD health status'));
    assert.ok(
      afdHealthStep.instruction.includes('curl https://${AFD_ENDPOINT}/health'),
    );
  });

  it('should preserve evidence types from imported step when not overridden', async () => {
    const operation = await parseFixture('evidenceOverrideInUse');

    const dnsStep = operation.steps[1];

    // verify-dns step overrides results but not types
    // Should preserve types from imported step
    assert.ok(dnsStep.evidence);
    assert.ok(Array.isArray(dnsStep.evidence.types));
    assert.strictEqual(dnsStep.evidence.types.length, 1);
    assert.ok(dnsStep.evidence.types.includes('command_output'));
  });
});
