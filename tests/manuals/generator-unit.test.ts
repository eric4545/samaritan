import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateManual, generateManualWithMetadata } from '../../src/manuals/generator';
import { Operation } from '../../src/models/operation';

describe('Manual Generator Unit Tests', () => {
  it('should generate proper table format for multi-environment operations', (t) => {
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
          name: 'Check Docker',
          type: 'automatic',
          phase: 'preflight',
          description: 'Verify Docker is running',
          command: 'docker version'
        },
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
      preflight: [],
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

    // Test preflight phase (now part of unified steps with phases)
    assert(markdown.includes('## 🛫 Pre-Flight Phase'), 'Should have preflight section');

    // Test main operation steps table
    assert(markdown.includes('## ✈️ Flight Phase (Main Operations)'), 'Should have main steps section');
    assert(markdown.includes('| Step | staging | production |'), 'Should have steps table header');

    // Test step formatting with icons and descriptions
    // Note: Continuous numbering - preflight is Step 1, so flight starts at Step 2
    assert(markdown.includes('| Step 2: Build Application ⚙️<br>Build the Docker image |'), 'Should format step with icon and description');
    assert(markdown.includes('| Step 3: Scale Service ⚙️<br>Scale to target replicas |'), 'Should handle automatic steps');
    assert(markdown.includes('| Step 4: Manual Health Check 👤<br>Verify application health |'), 'Should handle manual steps with correct icon');

    // Test variable substitution in table
    assert(markdown.includes('`kubectl scale deployment app --replicas=2`'), 'Should substitute variables for staging');
    assert(markdown.includes('`kubectl scale deployment app --replicas=5`'), 'Should substitute variables for production');
    assert(markdown.includes('`curl http://localhost:8080/health`'), 'Should substitute PORT for staging');
    assert(markdown.includes('`curl http://localhost:80/health`'), 'Should substitute PORT for production');

    // Test that both environments have commands
    // Should have 4 total step rows: 1 preflight + 3 main steps
    const stepsTableMatch = markdown.match(/\| Step \d+:.*?\|.*?\|.*?\|/g);
    assert(stepsTableMatch && stepsTableMatch.length === 4, 'Should have 4 step table rows');

    // Snapshot the complete manual for regression testing
    t.assert.snapshot(markdown);
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

    // Should not include preflight phase section when empty
    assert(!markdown.includes('## 🛫 Pre-Flight Phase'), 'Should not include empty preflight section');
    assert(markdown.includes('## ✈️ Flight Phase (Main Operations)'), 'Should still include steps section');
  });

  it('should handle null/empty step descriptions without rendering undefined (T008.1)', () => {
    const operationWithEmptyDescriptions: Operation = {
      id: 'test-empty-desc',
      name: 'Empty Description Test',
      version: '1.0.0',
      description: 'Test for T008.1 bug fix',
      environments: [
        {
          name: 'production',
          description: 'Production environment',
          variables: { REPLICAS: 3 },
          restrictions: [],
          approval_required: false,
          validation_required: false
        }
      ],
      variables: { production: { REPLICAS: 3 } },
      steps: [
        {
          name: 'Step with null description',
          type: 'automatic',
          description: null as any, // Explicitly null
          command: 'echo "null description"'
        },
        {
          name: 'Step with missing description',
          type: 'manual',
          // description is undefined (not provided)
          command: 'echo "missing description"'
        },
        {
          name: 'Step with empty string description',
          type: 'automatic',
          description: '', // Empty string
          command: 'echo "empty description"'
        },
        {
          name: 'Step with whitespace description',
          type: 'manual',
          description: '   ', // Only whitespace
          command: 'echo "whitespace description"'
        }
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0
      }
    };

    const markdown = generateManual(operationWithEmptyDescriptions);

    // Should not contain JavaScript literal "undefined" values
    assert(!markdown.includes('<br>undefined'), 'Generated markdown should not contain "<br>undefined"');
    assert(!markdown.includes('<br>null'), 'Generated markdown should not contain "<br>null"');

    // Should not render description when it's empty/null/undefined
    assert(!markdown.includes('Step 1: Step with null description ⚙️<br>'), 'Should not add <br> for null description');
    assert(!markdown.includes('Step 2: Step with missing description 👤<br>'), 'Should not add <br> for undefined description');
    assert(!markdown.includes('Step 3: Step with empty string description ⚙️<br>'), 'Should not add <br> for empty description');

    // Should still include step names
    assert(markdown.includes('Step with null description'), 'Should include step name');
    assert(markdown.includes('Step with missing description'), 'Should include step name');
    assert(markdown.includes('Step with empty string description'), 'Should include step name');
    assert(markdown.includes('Step with whitespace description'), 'Should include step name');

    // Should have proper table structure
    assert(markdown.includes('| Step | production |'), 'Should have table header');
    assert(markdown.includes('Step 1: Step with null description ⚙️ |'), 'Should format step without description');
  });

  it('should resolve variables when resolveVariables flag is enabled', () => {
    const testOperation: Operation = {
      id: 'resolve-test-123',
      name: 'Variable Resolution Test',
      version: '1.0.0',
      description: 'Test variable resolution functionality',
      environments: [
        {
          name: 'staging',
          description: 'Staging environment',
          variables: { REPLICAS: 2, APP_NAME: 'myapp-staging', PORT: 8080 },
          restrictions: [],
          approval_required: false,
          validation_required: false
        },
        {
          name: 'production',
          description: 'Production environment',
          variables: { REPLICAS: 5, APP_NAME: 'myapp-prod', PORT: 80 },
          restrictions: [],
          approval_required: true,
          validation_required: true
        }
      ],
      variables: {
        staging: { REPLICAS: 2, APP_NAME: 'myapp-staging', PORT: 8080 },
        production: { REPLICAS: 5, APP_NAME: 'myapp-prod', PORT: 80 }
      },
      steps: [
        {
          name: 'Scale Deployment',
          type: 'automatic',
          description: 'Scale the deployment to target replicas',
          command: 'kubectl scale deployment ${APP_NAME} --replicas=${REPLICAS}'
        },
        {
          name: 'Health Check',
          type: 'manual',
          description: 'Check application health',
          instruction: 'curl http://localhost:${PORT}/health && echo "App: ${APP_NAME}"'
        }
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0
      }
    };

    // Test without variable resolution (should show templates)
    const manualWithTemplates = generateManualWithMetadata(testOperation, undefined, undefined, false);

    assert(manualWithTemplates.includes('kubectl scale deployment ${APP_NAME} --replicas=${REPLICAS}'),
      'Should show template variables when resolveVariables is false');
    assert(manualWithTemplates.includes('curl http://localhost:${PORT}/health && echo "App: ${APP_NAME}"'),
      'Should show template variables in manual steps');

    // Test with variable resolution enabled
    const manualWithResolved = generateManualWithMetadata(testOperation, undefined, undefined, true);

    // Should resolve variables for staging environment
    assert(manualWithResolved.includes('kubectl scale deployment myapp-staging --replicas=2'),
      'Should resolve variables for staging environment');
    assert(manualWithResolved.includes('kubectl scale deployment myapp-prod --replicas=5'),
      'Should resolve variables for production environment');
    assert(manualWithResolved.includes('curl http://localhost:8080/health && echo "App: myapp-staging"'),
      'Should resolve variables in manual instructions for staging');
    assert(manualWithResolved.includes('curl http://localhost:80/health && echo "App: myapp-prod"'),
      'Should resolve variables in manual instructions for production');

    // Should NOT contain template variables when resolved
    assert(!manualWithResolved.includes('${REPLICAS}'),
      'Should not contain template variables when resolved');
    assert(!manualWithResolved.includes('${APP_NAME}'),
      'Should not contain template APP_NAME when resolved');
    assert(!manualWithResolved.includes('${PORT}'),
      'Should not contain template PORT when resolved');
  });

  it('should resolve variables for single environment when filtered', () => {
    const testOperation: Operation = {
      id: 'single-env-resolve-123',
      name: 'Single Environment Resolution Test',
      version: '1.0.0',
      description: 'Test single environment variable resolution',
      environments: [
        {
          name: 'staging',
          description: 'Staging environment',
          variables: { REPLICAS: 2, DB_HOST: 'staging-db.example.com' },
          restrictions: [],
          approval_required: false,
          validation_required: false
        },
        {
          name: 'production',
          description: 'Production environment',
          variables: { REPLICAS: 5, DB_HOST: 'prod-db.example.com' },
          restrictions: [],
          approval_required: true,
          validation_required: true
        }
      ],
      variables: {
        staging: { REPLICAS: 2, DB_HOST: 'staging-db.example.com' },
        production: { REPLICAS: 5, DB_HOST: 'prod-db.example.com' }
      },
      steps: [
        {
          name: 'Database Migration',
          type: 'automatic',
          command: 'migrate --host ${DB_HOST} --confirm'
        },
        {
          name: 'Scale Application',
          type: 'automatic',
          command: 'kubectl scale deployment app --replicas=${REPLICAS}'
        }
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0
      }
    };

    // Test production environment filtering with variable resolution
    const prodManualResolved = generateManualWithMetadata(testOperation, undefined, 'production', true);

    // Should only show production values
    assert(prodManualResolved.includes('migrate --host prod-db.example.com --confirm'),
      'Should resolve production DB_HOST variable');
    assert(prodManualResolved.includes('kubectl scale deployment app --replicas=5'),
      'Should resolve production REPLICAS variable');

    // Should NOT contain staging values
    assert(!prodManualResolved.includes('staging-db.example.com'),
      'Should not contain staging values when filtered to production');
    assert(!prodManualResolved.includes('--replicas=2'),
      'Should not contain staging replica count');

    // Should only have production column in table
    assert(prodManualResolved.includes('| Step | production |'),
      'Should only show production column when filtered');
    assert(!prodManualResolved.includes('| staging |'),
      'Should not show staging column when filtered to production');
  });

  it('should escape pipe characters in commands to prevent table breakage', () => {
    const testOperation: Operation = {
      id: 'pipe-test-123',
      name: 'Pipe Character Test',
      version: '1.0.0',
      description: 'Test pipe character escaping',
      environments: [
        {
          name: 'production',
          description: 'Production',
          variables: { NAMESPACE: 'prod' },
          restrictions: [],
          approval_required: false,
          validation_required: false
        }
      ],
      variables: { production: { NAMESPACE: 'prod' } },
      steps: [
        {
          name: 'Filter and Count',
          type: 'automatic',
          command: 'kubectl get pods -n ${NAMESPACE} | grep Running | wc -l'
        },
        {
          name: 'Chain Commands',
          type: 'manual',
          instruction: 'cat file.txt | sort | uniq | grep error'
        }
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0
      }
    };

    const markdown = generateManual(testOperation);

    // Pipes should be escaped to prevent table breakage
    assert(markdown.includes('\\|'), 'Should escape pipe characters');

    // Should have properly formed table with escaped pipes
    assert(markdown.includes('grep Running \\| wc -l'), 'Should escape pipes in kubectl command');
    assert(markdown.includes('sort \\| uniq \\| grep error'), 'Should escape all pipes in chain');

    // Table structure should remain intact
    assert(markdown.includes('| Step | production |'), 'Table header should be intact');
    const tableRowsCount = (markdown.match(/\| Step \d+:/g) || []).length;
    assert(tableRowsCount === 2, 'Should have 2 step rows with proper table structure');
  });

  it('should handle imported steps with sub_steps correctly', () => {
    const testOperation: Operation = {
      id: 'substep-test-123',
      name: 'Sub-step Test',
      version: '1.0.0',
      description: 'Test sub-step display',
      environments: [
        {
          name: 'production',
          description: 'Production',
          variables: { NAMESPACE: 'prod' },
          restrictions: [],
          approval_required: false,
          validation_required: false
        }
      ],
      variables: { production: { NAMESPACE: 'prod' } },
      steps: [
        {
          name: 'Deploy All Services',
          type: 'manual',
          description: 'Deploy all microservices',
          // No parent command - only sub_steps
          sub_steps: [
            {
              name: 'Deploy Backend',
              type: 'automatic',
              command: 'kubectl apply -f backend.yaml'
            },
            {
              name: 'Deploy Frontend',
              type: 'automatic',
              command: 'kubectl apply -f frontend.yaml'
            }
          ]
        }
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0
      }
    };

    const markdown = generateManual(testOperation);

    // Parent step should indicate it has sub-steps, not show "(manual step)"
    assert(!markdown.includes('_(manual step)_'),
      'Should not show generic "(manual step)" when step has sub_steps');
    assert(markdown.includes('_(see substeps below)_') || markdown.includes('Deploy all microservices'),
      'Should show description or indicate substeps exist');

    // Sub-steps should show their commands
    assert(markdown.includes('Step 1a: Deploy Backend'), 'Should show first sub-step');
    assert(markdown.includes('kubectl apply -f backend.yaml'), 'Should show sub-step command');
    assert(markdown.includes('Step 1b: Deploy Frontend'), 'Should show second sub-step');
    assert(markdown.includes('kubectl apply -f frontend.yaml'), 'Should show sub-step command');
  });

  it('should support common variables shared across all environments', () => {
    const testOperation: Operation = {
      id: 'common-vars-test-123',
      name: 'Common Variables Test',
      version: '1.0.0',
      description: 'Test common variables functionality',
      common_variables: {
        REGISTRY: 'docker.io/mycompany',
        APP_NAME: 'myapp',
        LOG_FORMAT: 'json'
      },
      environments: [
        {
          name: 'staging',
          description: 'Staging environment',
          // Merged common_variables + env-specific variables
          variables: { REGISTRY: 'docker.io/mycompany', APP_NAME: 'myapp', LOG_FORMAT: 'json', REPLICAS: 2, LOG_LEVEL: 'debug' },
          restrictions: [],
          approval_required: false,
          validation_required: false
        },
        {
          name: 'production',
          description: 'Production environment',
          // Merged common_variables + env-specific variables (LOG_FORMAT overridden)
          variables: { REGISTRY: 'docker.io/mycompany', APP_NAME: 'myapp', LOG_FORMAT: 'text', REPLICAS: 5, LOG_LEVEL: 'warn' },
          restrictions: [],
          approval_required: true,
          validation_required: true
        }
      ],
      variables: {
        staging: { REGISTRY: 'docker.io/mycompany', APP_NAME: 'myapp', LOG_FORMAT: 'json', REPLICAS: 2, LOG_LEVEL: 'debug' },
        production: { REGISTRY: 'docker.io/mycompany', APP_NAME: 'myapp', LOG_FORMAT: 'text', REPLICAS: 5, LOG_LEVEL: 'warn' }
      },
      steps: [
        {
          name: 'Build and Push',
          type: 'automatic',
          command: 'docker build -t ${REGISTRY}/${APP_NAME}:latest . && docker push ${REGISTRY}/${APP_NAME}:latest'
        },
        {
          name: 'Configure Logging',
          type: 'automatic',
          command: 'kubectl set env deployment/${APP_NAME} LOG_FORMAT=${LOG_FORMAT} LOG_LEVEL=${LOG_LEVEL}'
        }
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0
      }
    };

    const markdown = generateManual(testOperation);

    // Common variables should be used in all environments
    assert(markdown.includes('docker.io/mycompany/myapp'), 'Should use common REGISTRY and APP_NAME');

    // Staging should use common LOG_FORMAT (json)
    assert(markdown.includes('LOG_FORMAT=json LOG_LEVEL=debug'),
      'Staging should use common LOG_FORMAT and env-specific LOG_LEVEL');

    // Production should override LOG_FORMAT (text)
    assert(markdown.includes('LOG_FORMAT=text LOG_LEVEL=warn'),
      'Production should override LOG_FORMAT with env-specific value');
  });

  it('should support step-scoped variables that override environment variables (FIXME #2)', () => {
    const testOperation: Operation = {
      id: 'step-vars-test-123',
      name: 'Step Variables Test',
      version: '1.0.0',
      description: 'Test step-scoped variables',
      common_variables: {
        REGISTRY: 'docker.io/default',
        TAG: 'latest'
      },
      environments: [
        {
          name: 'staging',
          description: 'Staging',
          variables: { REGISTRY: 'docker.io/staging', TAG: 'latest', NAMESPACE: 'staging' },
          restrictions: [],
          approval_required: false,
          validation_required: false
        },
        {
          name: 'production',
          description: 'Production',
          variables: { REGISTRY: 'docker.io/prod', TAG: 'latest', NAMESPACE: 'prod' },
          restrictions: [],
          approval_required: true,
          validation_required: false
        }
      ],
      variables: {
        staging: { REGISTRY: 'docker.io/staging', TAG: 'latest', NAMESPACE: 'staging' },
        production: { REGISTRY: 'docker.io/prod', TAG: 'latest', NAMESPACE: 'prod' }
      },
      steps: [
        {
          name: 'Build Standard Image',
          type: 'automatic',
          command: 'docker build -t ${REGISTRY}/app:${TAG} .'
        },
        {
          name: 'Build Special Image',
          type: 'automatic',
          command: 'docker build -t ${REGISTRY}/app:${TAG} .',
          variables: {
            TAG: 'special-v1.0' // Override TAG for this step only
          }
        }
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0
      }
    };

    const markdown = generateManual(testOperation);

    // First step uses environment TAG
    assert(markdown.includes('docker build -t docker.io/staging/app:latest .'),
      'First step should use environment TAG for staging');
    assert(markdown.includes('docker build -t docker.io/prod/app:latest .'),
      'First step should use environment TAG for production');

    // Second step uses step-scoped TAG variable
    assert(markdown.includes('docker build -t docker.io/staging/app:special-v1.0 .'),
      'Second step should use step TAG override for staging');
    assert(markdown.includes('docker build -t docker.io/prod/app:special-v1.0 .'),
      'Second step should use step TAG override for production');
  });

  it('should use continuous numbering across all phases (FIXME #7)', () => {
    const testOperation: Operation = {
      id: 'numbering-test-123',
      name: 'Phase Numbering Test',
      version: '1.0.0',
      description: 'Test continuous phase numbering',
      environments: [
        {
          name: 'production',
          description: 'Production',
          variables: {},
          restrictions: [],
          approval_required: false,
          validation_required: false
        }
      ],
      variables: { production: {} },
      steps: [
        {
          name: 'Preflight Check 1',
          type: 'automatic',
          phase: 'preflight',
          command: 'echo preflight1'
        },
        {
          name: 'Preflight Check 2',
          type: 'automatic',
          phase: 'preflight',
          command: 'echo preflight2'
        },
        {
          name: 'Main Step 1',
          type: 'automatic',
          phase: 'flight',
          command: 'echo main1'
        },
        {
          name: 'Main Step 2',
          type: 'automatic',
          phase: 'flight',
          command: 'echo main2'
        },
        {
          name: 'Postflight Check 1',
          type: 'manual',
          phase: 'postflight',
          command: 'echo postflight1'
        }
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0
      }
    };

    const markdown = generateManual(testOperation);

    // Should have continuous numbering: 1, 2, 3, 4, 5
    assert(markdown.includes('Step 1: Preflight Check 1'), 'Preflight should start at 1');
    assert(markdown.includes('Step 2: Preflight Check 2'), 'Preflight should continue to 2');
    assert(markdown.includes('Step 3: Main Step 1'), 'Flight should continue from 3');
    assert(markdown.includes('Step 4: Main Step 2'), 'Flight should continue to 4');
    assert(markdown.includes('Step 5: Postflight Check 1'), 'Postflight should continue from 5');

    // Should NOT reset numbering in each phase
    assert(!markdown.match(/Flight Phase.*Step 1: Main Step 1/s),
      'Flight phase should not start numbering from 1');
  });

  it('should display ticket references in steps (FIXME #9)', () => {
    const testOperation: Operation = {
      id: 'ticket-test-123',
      name: 'Ticket Reference Test',
      version: '1.0.0',
      description: 'Test ticket references',
      environments: [
        {
          name: 'production',
          description: 'Production',
          variables: {},
          restrictions: [],
          approval_required: false,
          validation_required: false
        }
      ],
      variables: { production: {} },
      steps: [
        {
          name: 'Fix Bug',
          type: 'manual',
          command: 'Apply the bug fix',
          ticket: 'JIRA-123'
        },
        {
          name: 'Deploy Feature',
          type: 'automatic',
          command: 'kubectl apply -f feature.yaml',
          ticket: ['TASK-456', 'BUG-789']
        }
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0
      }
    };

    const markdown = generateManual(testOperation);

    // Should display single ticket
    assert(markdown.includes('🎫 <em>Tickets: JIRA-123</em>'),
      'Should show single ticket reference with emoji');

    // Should display multiple tickets
    assert(markdown.includes('🎫 <em>Tickets: TASK-456, BUG-789</em>'),
      'Should show multiple ticket references');
  });

  it('should trim trailing <br> tags from multi-line commands', () => {
    const testOperation: Operation = {
      id: 'multiline-test-123',
      name: 'Multi-line Command Test',
      version: '1.0.0',
      description: 'Test multi-line command formatting',
      environments: [
        {
          name: 'production',
          description: 'Production',
          variables: { NAMESPACE: 'prod' },
          restrictions: [],
          approval_required: false,
          validation_required: false
        }
      ],
      variables: { production: { NAMESPACE: 'prod' } },
      steps: [
        {
          name: 'Deploy Services',
          type: 'automatic',
          command: `kubectl apply -f backend.yaml
kubectl apply -f frontend.yaml
kubectl apply -f worker.yaml`
        },
        {
          name: 'Smoke Test',
          type: 'manual',
          instruction: `Test the following:
1. Check API health
2. Verify frontend loads
3. Confirm worker is running`
        }
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0
      }
    };

    const markdown = generateManual(testOperation);

    // Commands should use <br> for line breaks but NOT have trailing <br>
    assert(markdown.includes('kubectl apply -f backend.yaml<br>kubectl apply -f frontend.yaml<br>kubectl apply -f worker.yaml'),
      'Should convert newlines to <br> tags');

    // Should NOT have <br>` (br tag before closing backtick)
    assert(!markdown.includes('<br>`'), 'Should not have trailing <br> before closing backtick');

    // Instruction should also not have trailing <br>
    assert(markdown.includes('1. Check API health<br>2. Verify frontend loads<br>3. Confirm worker is running'),
      'Should convert instruction newlines to <br> tags');
    assert(!markdown.match(/<br>\s*`\)/), 'Should not have trailing <br> in instructions');
  });
});