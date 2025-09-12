import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'child_process';
import fs from 'fs';

describe('Manual Generation CLI Command', () => {
  const inputFilePath = 'examples/deployment.yaml';
  const outputFilePath = 'temp-test-manual.md';

  after(() => {
    // Clean up the generated file
    if (fs.existsSync(outputFilePath)) {
      fs.unlinkSync(outputFilePath);
    }
  });

  it('should generate a Markdown manual with environment-specific details and substituted variables', () => {
    // Ensure the input file exists
    assert(fs.existsSync(inputFilePath), 'Prerequisite: Input YAML file must exist.');

    // Run the CLI command
    const command = `npx tsx src/cli/index.ts generate:manual ${inputFilePath} ${outputFilePath}`;
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
    assert(content.includes('# Manual for: Deploy Web Server to Staging (v1.1.0)'), 'Markdown title should be correct.');

    // Check for Environments Overview table
    assert(content.includes('## Environments Overview'), 'Environments Overview section should exist.');
    assert(content.includes('| Environment | Description | Variables | Targets | Approval Required |'), 'Environments table header should exist.');
    assert(content.includes('| staging | Development and testing environment. | REPLICAS: 2, DB_HOST: "staging-db.example.com" |'), 'Staging environment row should exist.');
    assert(content.includes('| production | Live production environment. | REPLICAS: 5, DB_HOST: "prod-db.example.com" |'), 'Production environment row should exist.');
    assert(content.includes('| Yes |'), 'Production approval requirement should be shown.');

    // Check for Pre-flight Checklist section
    assert(content.includes('## Pre-flight Checklist'), 'Pre-flight Checklist section should exist.');
    assert(content.includes('- **Check Git status:** Ensure no uncommitted changes exist in the current branch.'), 'Pre-flight check name should be present.');
    assert(content.includes('  ```bash\n  git status --porcelain\n  ```'), 'Pre-flight command should be present.');

    // Check for Operation Steps section and variable substitution
    assert(content.includes('## Operation Steps'), 'Operation Steps section should exist.');
    assert(content.includes('### Step 1: Build Docker Image ⚙️'), 'First step name with icon should be present.');
    assert(content.includes('**Command:** `docker build -t web-server:latest .`'), 'Docker build command should be present.');
    
    // Check steps with environment-specific commands
    assert(content.includes('### Step 4: Scale Deployment ⚙️'), 'Scale Deployment step with icon should be present.');
    assert(content.includes('**Commands by environment:**'), 'Environment-specific commands section should exist.');
    assert(content.includes('- **staging**: `kubectl scale deployment web-server --replicas=2`'), 'REPLICAS variable should be substituted for staging.');
    assert(content.includes('- **production**: `kubectl scale deployment web-server --replicas=5`'), 'REPLICAS variable should be substituted for production.');
    
    assert(content.includes('### Step 5: Manual Verification 👤'), 'Manual Verification step with icon should be present.');
    assert(content.includes('**Command:** `curl https://web-server.example.com/health`'), 'Manual verification command should be present.');
    assert(content.includes('### Step 6: Deploy to Kubernetes ⚙️'), 'Last step name with icon should be present.');
    assert(content.includes('**Command:** `kubectl apply -f k8s/deployment.yaml`'), 'kubectl command should be present.');
  });
});