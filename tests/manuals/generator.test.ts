import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'child_process';
import fs from 'fs';
import { deploymentOperationYaml } from '../fixtures/operations';

describe('Manual Generation CLI Command', () => {
  const testInputFilePath = `/tmp/samaritan-test-${Date.now()}-test-deployment.yaml`;
  const outputFilePath = `/tmp/samaritan-test-${Date.now()}-temp-test-manual.md`;

  // Use shared test YAML from fixtures
  const testYamlContent = deploymentOperationYaml;

  after(() => {
    // Clean up all generated files
    if (fs.existsSync(outputFilePath)) {
      fs.unlinkSync(outputFilePath);
    }
    if (fs.existsSync(testInputFilePath)) {
      fs.unlinkSync(testInputFilePath);
    }
  });

  it('should generate a Markdown manual with environment-specific details and substituted variables', (t) => {
    // Create self-contained test input file
    fs.writeFileSync(testInputFilePath, testYamlContent);

    // Run the CLI command with --resolve-vars to match test expectations
    const command = `npx tsx src/cli/index.ts generate manual ${testInputFilePath} --output ${outputFilePath} --resolve-vars`;
    try {
      execSync(command, { stdio: 'pipe' });
    } catch (error) {
      const err = error as { stdout: Buffer; stderr: Buffer };
      console.error('CLI command failed:', err.stderr.toString());
      assert.fail('The CLI command should not fail.');
    }

    // Verify the output file was created
    assert(fs.existsSync(outputFilePath), 'Output file should be created.');

    // Verify the content of the output file
    const content = fs.readFileSync(outputFilePath, 'utf-8');
    
    // Check for title
    assert(content.includes('# Manual for: Deploy Web Server (v1.1.0)'), 'Markdown title should be correct.');

    // Check for Environments Overview table
    assert(content.includes('## Environments Overview'), 'Environments Overview section should exist.');
    assert(content.includes('| Environment | Description | Variables | Targets | Approval Required |'), 'Environments table header should exist.');
    assert(content.includes('| staging | Staging environment for testing |'), 'Staging environment row should exist.');
    assert(content.includes('REPLICAS: 2<br>DB_HOST: "staging-db.example.com"'), 'Staging variables should use <br> tags.');
    assert(content.includes('| production | Live production environment |'), 'Production environment row should exist.');
    assert(content.includes('REPLICAS: 5<br>DB_HOST: "prod-db.example.com"'), 'Production variables should use <br> tags.');
    assert(content.includes('| Yes |'), 'Production approval requirement should be shown.');

    // Check for Pre-flight Phase section (unified format)
    assert(content.includes('## 🛫 Pre-Flight Phase'), 'Pre-flight Phase section should exist.');

    // Check for Operation Steps table
    assert(content.includes('## ✈️ Flight Phase (Main Operations)'), 'Operation Steps section should exist.');
    assert(content.includes('| Step | staging | production |'), 'Steps table header should exist with correct environments.');

    // Pre-flight array has 2 checks, then Build Docker Image from steps array, so flight phase starts at Step 4
    assert(content.includes('☐ Step 4: Push Docker Image'), 'Push Docker Image step should be Step 4.');
    assert(content.includes('`docker push my-registry/web-server:latest`'), 'Docker push command should be present.');

    // Check steps with environment-specific commands in table format
    assert(content.includes('☐ Step 6: Scale Deployment'), 'Scale Deployment step should be Step 6.');
    assert(content.includes('`kubectl scale deployment web-server --replicas=2`'), 'REPLICAS variable should be substituted for staging.');
    assert(content.includes('`kubectl scale deployment web-server --replicas=5`'), 'REPLICAS variable should be substituted for production.');

    // Post-flight phase
    assert(content.includes('## 🛬 Post-Flight Phase'), 'Post-Flight Phase section should exist.');
    assert(content.includes('☐ Step 7: Health Check'), 'Health Check step should exist.');
    assert(content.includes('☐ Step 8: Verify Services'), 'Verify Services step should exist.');

    // Functional tests above verify the important behavior
    // Snapshot removed due to YAML frontmatter making snapshots brittle
  });
});