import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'child_process';
import fs from 'fs';

describe('Manual Generation CLI Command', () => {
  const testInputFilePath = '/tmp/test-deployment.yaml';
  const outputFilePath = '/tmp/temp-test-manual.md';

  // Self-contained test YAML content
  const testYamlContent = `name: Deploy Web Server
version: 1.1.0
description: Deploys the main web server application to the staging environment.

environments:
  - name: preprod
    description: preprod
    variables:
      REPLICAS: 2
      DB_HOST: preprod-db.example.com
    targets:
      - cluster-dev-us-east-1
      - cluster-dev-eu-west-1
  - name: production
    description: Live production environment.
    variables:
      REPLICAS: 5
      DB_HOST: prod-db.example.com
    approval_required: true
    targets:
      - cluster-prod-us-east-1
      - cluster-prod-eu-west-1
      - cluster-prod-asia-south-1

preflight:
  - name: Check Git status
    description: Ensure no uncommitted changes exist in the current branch.
    command: git status --porcelain
    expect_empty: true

  - name: Check Docker daemon
    description: Verify that the Docker daemon is running and accessible.
    command: docker info

steps:
  - name: Build Docker Image
    type: automatic
    description: Build the application's Docker image.
    command: docker build -t web-server:latest .

  - name: Push Docker Image
    type: automatic
    description: Push the image to the container registry.
    command: docker push my-registry/web-server:latest

  - name: Request Approval
    type: approval
    description: Request manager approval for deployment.
    command: jira create-ticket --type approval --summary "Deploy Web Server"

  - name: Scale Deployment
    type: automatic
    description: Scale the Kubernetes deployment to the specified replica count.
    command: kubectl scale deployment web-server --replicas=\${REPLICAS}

  - name: Manual Verification
    type: manual
    description: Manually verify deployment health.
    command: curl https://web-server.example.com/health

  - name: Deploy to Kubernetes
    type: automatic
    description: Apply the Kubernetes deployment manifest.
    command: kubectl apply -f k8s/deployment.yaml
`;

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
    assert(content.includes('| preprod | preprod | REPLICAS: 2<br>DB_HOST: "preprod-db.example.com" |'), 'Preprod environment row should exist with <br> tags.');
    assert(content.includes('| production | Live production environment. | REPLICAS: 5<br>DB_HOST: "prod-db.example.com" |'), 'Production environment row should exist with <br> tags.');
    assert(content.includes('cluster-dev-us-east-1<br>cluster-dev-eu-west-1'), 'Preprod targets should use <br> tags.');
    assert(content.includes('| Yes |'), 'Production approval requirement should be shown.');

    // Check for Pre-flight Phase section (unified format)
    assert(content.includes('## 🛫 Pre-Flight Phase'), 'Pre-flight Phase section should exist.');

    // Check for Operation Steps table
    assert(content.includes('## ✈️ Flight Phase (Main Operations)'), 'Operation Steps section should exist.');
    assert(content.includes('| Step | preprod | production |'), 'Steps table header should exist.');
    // Continuous numbering: 2 preflight steps, so flight starts at Step 3
    assert(content.includes('| ☐ Step 3: Build Docker Image ✈️⚙️'), 'First step in flight phase should be Step 3.');
    assert(content.includes('`docker build -t web-server:latest .`'), 'Docker build command should be present.');

    // Check steps with environment-specific commands in table format
    assert(content.includes('| ☐ Step 6: Scale Deployment ✈️⚙️'), 'Scale Deployment step should be Step 6.');
    assert(content.includes('`kubectl scale deployment web-server --replicas=2`'), 'REPLICAS variable should be substituted for preprod.');
    assert(content.includes('`kubectl scale deployment web-server --replicas=5`'), 'REPLICAS variable should be substituted for production.');

    assert(content.includes('| ☐ Step 7: Manual Verification ✈️👤'), 'Manual Verification step should be Step 7.');
    assert(content.includes('`curl https://web-server.example.com/health`'), 'Manual verification command should be present.');
    assert(content.includes('| ☐ Step 8: Deploy to Kubernetes ✈️⚙️'), 'Last step should be Step 8.');
    assert(content.includes('`kubectl apply -f k8s/deployment.yaml`'), 'kubectl command should be present.');

    // Functional tests above verify the important behavior
    // Snapshot removed due to YAML frontmatter making snapshots brittle
  });
});