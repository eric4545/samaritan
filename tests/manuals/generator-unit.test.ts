import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateManual } from '../../src/manuals/generator';
import { Operation, Environment, Step, PreflightCheck } from '../../src/models/operation';

describe('Manual Generator Unit Tests', () => {
  it('should generate proper table format for multi-environment operations', () => {
    // Create test operation with all necessary fields
    const testOperation: Operation = {
      id: 'test-123',
      name: 'Test Operation',
      version: '2.0.0',
      description: 'Test operation for unit testing',
      environments: [
        {
          name: 'staging',
          description: 'Staging environment',
          variables: { REPLICAS: 2, PORT: 8080 },
          restrictions: [],
          approval_required: false,
          validation_required: false,
          targets: ['staging-cluster-1', 'staging-cluster-2']
        },
        {
          name: 'production',
          description: 'Production environment',
          variables: { REPLICAS: 5, PORT: 80 },
          restrictions: ['requires-approval'],
          approval_required: true,
          validation_required: true,
          targets: ['prod-cluster-1', 'prod-cluster-2', 'prod-cluster-3']
        }
      ],
      variables: {
        staging: { REPLICAS: 2, PORT: 8080 },
        production: { REPLICAS: 5, PORT: 80 }
      },
      steps: [
        {
          name: 'Build Application',
          type: 'automatic',
          description: 'Build the Docker image',
          command: 'docker build -t app:latest .'
        },
        {
          name: 'Scale Service',
          type: 'automatic', 
          description: 'Scale to target replicas',
          command: 'kubectl scale deployment app --replicas=${REPLICAS}'
        },
        {
          name: 'Manual Health Check',
          type: 'manual',
          description: 'Verify application health',
          command: 'curl http://localhost:${PORT}/health'
        }
      ],
      preflight: [
        {
          name: 'Check Docker',
          description: 'Verify Docker is running',
          command: 'docker version',
          type: 'command'
        }
      ],
      metadata: {
        created_at: new Date('2023-01-01'),
        updated_at: new Date('2023-01-01'),
        execution_count: 0
      }
    };

    const markdown = generateManual(testOperation);

    // Test title
    assert(markdown.includes('# Manual for: Test Operation (v2.0.0)'), 'Should have correct title');
    assert(markdown.includes('_Test operation for unit testing_'), 'Should include description');

    // Test environments overview table with <br> tags
    assert(markdown.includes('## Environments Overview'), 'Should have environments section');
    assert(markdown.includes('| Environment | Description | Variables | Targets | Approval Required |'), 'Should have table header');
    assert(markdown.includes('REPLICAS: 2<br>PORT: 8080'), 'Should use <br> for variables');
    assert(markdown.includes('staging-cluster-1<br>staging-cluster-2'), 'Should use <br> for targets');
    assert(markdown.includes('| Yes |'), 'Should show approval requirement');

    // Test preflight checklist
    assert(markdown.includes('## Pre-flight Checklist'), 'Should have preflight section');
    assert(markdown.includes('- **Check Docker:** Verify Docker is running'), 'Should format preflight items');
    assert(markdown.includes('```bash\n  docker version\n  ```'), 'Should include command blocks');

    // Test operation steps table
    assert(markdown.includes('## Operation Steps'), 'Should have steps section');
    assert(markdown.includes('| Step | staging | production |'), 'Should have steps table header');
    
    // Test step formatting with icons and descriptions
    assert(markdown.includes('| Step 1: Build Application ⚙️<br>Build the Docker image |'), 'Should format step with icon and description');
    assert(markdown.includes('| Step 2: Scale Service ⚙️<br>Scale to target replicas |'), 'Should handle automatic steps');
    assert(markdown.includes('| Step 3: Manual Health Check 👤<br>Verify application health |'), 'Should handle manual steps with correct icon');

    // Test variable substitution in table
    assert(markdown.includes('`kubectl scale deployment app --replicas=2`'), 'Should substitute variables for staging');
    assert(markdown.includes('`kubectl scale deployment app --replicas=5`'), 'Should substitute variables for production');
    assert(markdown.includes('`curl http://localhost:8080/health`'), 'Should substitute PORT for staging');
    assert(markdown.includes('`curl http://localhost:80/health`'), 'Should substitute PORT for production');

    // Test that both environments have commands
    const stepsTableMatch = markdown.match(/\| Step \d+:.*?\|.*?\|.*?\|/g);
    assert(stepsTableMatch && stepsTableMatch.length === 3, 'Should have 3 step table rows');
  });

  it('should handle single environment operations', () => {
    const singleEnvOperation: Operation = {
      id: 'single-123',
      name: 'Single Env Test',
      version: '1.0.0', 
      description: 'Single environment test',
      environments: [
        {
          name: 'production',
          description: 'Production only',
          variables: { REPLICAS: 3 },
          restrictions: [],
          approval_required: false,
          validation_required: false
        }
      ],
      variables: {
        production: { REPLICAS: 3 }
      },
      steps: [
        {
          name: 'Deploy',
          type: 'automatic',
          command: 'kubectl apply -f deployment.yaml'
        }
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0
      }
    };

    const markdown = generateManual(singleEnvOperation);
    
    // Should still create table format even with single environment
    assert(markdown.includes('| Step | production |'), 'Should create table with single environment column');
    assert(markdown.includes('| Step 1: Deploy ⚙️ |'), 'Should format single environment step');
  });

  it('should handle operations without preflight checks', () => {
    const noPreflight: Operation = {
      id: 'no-preflight-123',
      name: 'No Preflight Test',
      version: '1.0.0',
      description: 'No preflight checks',
      environments: [
        {
          name: 'test',
          description: 'Test env',
          variables: {},
          restrictions: [],
          approval_required: false,
          validation_required: false
        }
      ],
      variables: { test: {} },
      steps: [
        {
          name: 'Simple Step',
          type: 'manual',
          command: 'echo hello'
        }
      ],
      preflight: [], // Empty preflight
      metadata: {
        created_at: new Date(),
        updated_at: new Date(), 
        execution_count: 0
      }
    };

    const markdown = generateManual(noPreflight);
    
    // Should not include preflight section when empty
    assert(!markdown.includes('## Pre-flight Checklist'), 'Should not include empty preflight section');
    assert(markdown.includes('## Operation Steps'), 'Should still include steps section');
  });
});