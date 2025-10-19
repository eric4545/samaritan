import assert from 'node:assert';
import { describe, it } from 'node:test';
import * as yaml from 'js-yaml';
import {
  generateManual,
  generateManualWithMetadata,
} from '../../src/manuals/generator';
import type { Operation } from '../../src/models/operation';
import { loadYaml, parseFixture } from '../fixtures/fixtures';
import { deploymentOperation } from '../fixtures/operations';

describe('Manual Generator Unit Tests', () => {
  it('should generate proper table format for multi-environment operations', (t) => {
    // Use shared deployment operation fixture
    const testOperation = deploymentOperation;

    const markdown = generateManual(testOperation);

    // Test title
    assert(
      markdown.includes('# Manual for: Deploy Web Server (v1.1.0)'),
      'Should have correct title',
    );
    assert(
      markdown.includes(
        '_Deploys the main web server application to staging and production environments._',
      ),
      'Should include description',
    );

    // Test environments overview table with <br> tags
    assert(
      markdown.includes('## Environments Overview'),
      'Should have environments section',
    );
    assert(
      markdown.includes(
        '| Environment | Description | Variables | Targets | Approval Required |',
      ),
      'Should have table header',
    );
    assert(
      markdown.includes(
        'REPLICAS: 2<br>DB_HOST: "staging-db.example.com"<br>PORT: 8080',
      ),
      'Should use <br> for variables',
    );
    assert(
      markdown.includes(
        'cluster-staging-us-east-1<br>cluster-staging-eu-west-1',
      ),
      'Should use <br> for targets',
    );
    assert(markdown.includes('| Yes |'), 'Should show approval requirement');

    // Test preflight phase (now part of unified steps with phases)
    assert(
      markdown.includes('## 🛫 Pre-Flight Phase'),
      'Should have preflight section',
    );

    // Test main operation steps table
    assert(
      markdown.includes('## ✈️ Flight Phase (Main Operations)'),
      'Should have main steps section',
    );
    assert(
      markdown.includes('| Step | staging | production |'),
      'Should have steps table header',
    );

    // Test step formatting with icons and descriptions
    // Note: Continuous numbering - preflight is Step 1, so flight starts at Step 2
    assert(
      markdown.includes('☐ Step 1: Build Docker Image'),
      'Should include Step 1: Build Docker Image',
    );
    assert(
      markdown.includes("Build the application's Docker image"),
      'Should include Build Docker Image description',
    );
    assert(
      markdown.includes('☐ Step 2: Push Docker Image'),
      'Should include Step 2: Push Docker Image',
    );
    assert(
      markdown.includes('☐ Step 4: Scale Deployment'),
      'Should include Step 4: Scale Deployment',
    );
    assert(
      markdown.includes('☐ Step 5: Health Check'),
      'Should include Step 5: Health Check',
    );
    assert(markdown.includes('👤'), 'Should include manual step icon');

    // Test variable substitution in table
    assert(
      markdown.includes('`kubectl scale deployment web-server --replicas=2`'),
      'Should substitute variables for staging',
    );
    assert(
      markdown.includes('`kubectl scale deployment web-server --replicas=5`'),
      'Should substitute variables for production',
    );
    assert(
      markdown.includes(
        'Check the application health endpoint at http://localhost:8080/health',
      ),
      'Should substitute PORT for staging',
    );
    assert(
      markdown.includes(
        'Check the application health endpoint at http://localhost:80/health',
      ),
      'Should substitute PORT for production',
    );

    // Test that both environments have commands
    // Should have 6 total step rows: 1 preflight + 3 flight steps + 2 postflight steps
    const stepsTableMatch = markdown.match(/\| ☐ Step \d+:.*?\|.*?\|.*?\|/g);
    assert(
      stepsTableMatch && stepsTableMatch.length === 6,
      'Should have 6 step table rows',
    );

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
          validation_required: false,
        },
      ],
      variables: {
        production: { REPLICAS: 3 },
      },
      steps: [
        {
          name: 'Deploy',
          type: 'automatic',
          command: 'kubectl apply -f deployment.yaml',
        },
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0,
      },
    };

    const markdown = generateManual(singleEnvOperation);

    // Should still create table format even with single environment
    assert(
      markdown.includes('| Step | production |'),
      'Should create table with single environment column',
    );
    assert(
      markdown.includes('| ☐ Step 1: Deploy ⚙️'),
      'Should format single environment step',
    );
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
          validation_required: false,
        },
      ],
      variables: { test: {} },
      steps: [
        {
          name: 'Simple Step',
          type: 'manual',
          command: 'echo hello',
        },
      ],
      preflight: [], // Empty preflight
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0,
      },
    };

    const markdown = generateManual(noPreflight);

    // Should not include preflight phase section when empty
    assert(
      !markdown.includes('## 🛫 Pre-Flight Phase'),
      'Should not include empty preflight section',
    );
    assert(
      markdown.includes('## ✈️ Flight Phase (Main Operations)'),
      'Should still include steps section',
    );
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
          validation_required: false,
        },
      ],
      variables: { production: { REPLICAS: 3 } },
      steps: [
        {
          name: 'Step with null description',
          type: 'automatic',
          description: null as any, // Explicitly null
          command: 'echo "null description"',
        },
        {
          name: 'Step with missing description',
          type: 'manual',
          // description is undefined (not provided)
          command: 'echo "missing description"',
        },
        {
          name: 'Step with empty string description',
          type: 'automatic',
          description: '', // Empty string
          command: 'echo "empty description"',
        },
        {
          name: 'Step with whitespace description',
          type: 'manual',
          description: '   ', // Only whitespace
          command: 'echo "whitespace description"',
        },
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0,
      },
    };

    const markdown = generateManual(operationWithEmptyDescriptions);

    // Should not contain JavaScript literal "undefined" values
    assert(
      !markdown.includes('<br>undefined'),
      'Generated markdown should not contain "<br>undefined"',
    );
    assert(
      !markdown.includes('<br>null'),
      'Generated markdown should not contain "<br>null"',
    );

    // Should not render description when it's empty/null/undefined
    assert(
      !markdown.includes('Step 1: Step with null description ⚙️<br>'),
      'Should not add <br> for null description',
    );
    assert(
      !markdown.includes('Step 2: Step with missing description 👤<br>'),
      'Should not add <br> for undefined description',
    );
    assert(
      !markdown.includes('Step 3: Step with empty string description ⚙️<br>'),
      'Should not add <br> for empty description',
    );

    // Should still include step names
    assert(
      markdown.includes('Step with null description'),
      'Should include step name',
    );
    assert(
      markdown.includes('Step with missing description'),
      'Should include step name',
    );
    assert(
      markdown.includes('Step with empty string description'),
      'Should include step name',
    );
    assert(
      markdown.includes('Step with whitespace description'),
      'Should include step name',
    );

    // Should have proper table structure
    assert(
      markdown.includes('| Step | production |'),
      'Should have table header',
    );
    assert(
      markdown.includes('Step 1: Step with null description ⚙️ |'),
      'Should format step without description',
    );
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
          validation_required: false,
        },
        {
          name: 'production',
          description: 'Production environment',
          variables: { REPLICAS: 5, APP_NAME: 'myapp-prod', PORT: 80 },
          restrictions: [],
          approval_required: true,
          validation_required: true,
        },
      ],
      variables: {
        staging: { REPLICAS: 2, APP_NAME: 'myapp-staging', PORT: 8080 },
        production: { REPLICAS: 5, APP_NAME: 'myapp-prod', PORT: 80 },
      },
      steps: [
        {
          name: 'Scale Deployment',
          type: 'automatic',
          description: 'Scale the deployment to target replicas',
          command:
            'kubectl scale deployment ${APP_NAME} --replicas=${REPLICAS}',
        },
        {
          name: 'Health Check',
          type: 'manual',
          description: 'Check application health',
          instruction:
            'curl http://localhost:${PORT}/health && echo "App: ${APP_NAME}"',
        },
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0,
      },
    };

    // Test without variable resolution (should show templates)
    const manualWithTemplates = generateManualWithMetadata(
      testOperation,
      undefined,
      undefined,
      false,
    );

    assert(
      manualWithTemplates.includes(
        'kubectl scale deployment ${APP_NAME} --replicas=${REPLICAS}',
      ),
      'Should show template variables when resolveVariables is false',
    );
    assert(
      manualWithTemplates.includes(
        'curl http://localhost:${PORT}/health && echo "App: ${APP_NAME}"',
      ),
      'Should show template variables in manual steps',
    );

    // Test with variable resolution enabled
    const manualWithResolved = generateManualWithMetadata(
      testOperation,
      undefined,
      undefined,
      true,
    );

    // Should resolve variables for staging environment
    assert(
      manualWithResolved.includes(
        'kubectl scale deployment myapp-staging --replicas=2',
      ),
      'Should resolve variables for staging environment',
    );
    assert(
      manualWithResolved.includes(
        'kubectl scale deployment myapp-prod --replicas=5',
      ),
      'Should resolve variables for production environment',
    );
    assert(
      manualWithResolved.includes(
        'curl http://localhost:8080/health && echo "App: myapp-staging"',
      ),
      'Should resolve variables in manual instructions for staging',
    );
    assert(
      manualWithResolved.includes(
        'curl http://localhost:80/health && echo "App: myapp-prod"',
      ),
      'Should resolve variables in manual instructions for production',
    );

    // Should NOT contain template variables when resolved
    assert(
      !manualWithResolved.includes('${REPLICAS}'),
      'Should not contain template variables when resolved',
    );
    assert(
      !manualWithResolved.includes('${APP_NAME}'),
      'Should not contain template APP_NAME when resolved',
    );
    assert(
      !manualWithResolved.includes('${PORT}'),
      'Should not contain template PORT when resolved',
    );
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
          validation_required: false,
        },
        {
          name: 'production',
          description: 'Production environment',
          variables: { REPLICAS: 5, DB_HOST: 'prod-db.example.com' },
          restrictions: [],
          approval_required: true,
          validation_required: true,
        },
      ],
      variables: {
        staging: { REPLICAS: 2, DB_HOST: 'staging-db.example.com' },
        production: { REPLICAS: 5, DB_HOST: 'prod-db.example.com' },
      },
      steps: [
        {
          name: 'Database Migration',
          type: 'automatic',
          command: 'migrate --host ${DB_HOST} --confirm',
        },
        {
          name: 'Scale Application',
          type: 'automatic',
          command: 'kubectl scale deployment app --replicas=${REPLICAS}',
        },
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0,
      },
    };

    // Test production environment filtering with variable resolution
    const prodManualResolved = generateManualWithMetadata(
      testOperation,
      undefined,
      'production',
      true,
    );

    // Should only show production values
    assert(
      prodManualResolved.includes(
        'migrate --host prod-db.example.com --confirm',
      ),
      'Should resolve production DB_HOST variable',
    );
    assert(
      prodManualResolved.includes('kubectl scale deployment app --replicas=5'),
      'Should resolve production REPLICAS variable',
    );

    // Should NOT contain staging values
    assert(
      !prodManualResolved.includes('staging-db.example.com'),
      'Should not contain staging values when filtered to production',
    );
    assert(
      !prodManualResolved.includes('--replicas=2'),
      'Should not contain staging replica count',
    );

    // Should only have production column in table
    assert(
      prodManualResolved.includes('| Step | production |'),
      'Should only show production column when filtered',
    );
    assert(
      !prodManualResolved.includes('| staging |'),
      'Should not show staging column when filtered to production',
    );
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
          validation_required: false,
        },
      ],
      variables: { production: { NAMESPACE: 'prod' } },
      steps: [
        {
          name: 'Filter and Count',
          type: 'automatic',
          command: 'kubectl get pods -n ${NAMESPACE} | grep Running | wc -l',
        },
        {
          name: 'Chain Commands',
          type: 'manual',
          instruction: 'cat file.txt | sort | uniq | grep error',
        },
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0,
      },
    };

    const markdown = generateManual(testOperation);

    // Pipes should be escaped to prevent table breakage
    assert(markdown.includes('\\|'), 'Should escape pipe characters');

    // Should have properly formed table with escaped pipes
    assert(
      markdown.includes('grep Running \\| wc -l'),
      'Should escape pipes in kubectl command',
    );
    assert(
      markdown.includes('sort \\| uniq \\| grep error'),
      'Should escape all pipes in chain',
    );

    // Table structure should remain intact
    assert(
      markdown.includes('| Step | production |'),
      'Table header should be intact',
    );
    const tableRowsCount = (markdown.match(/\| ☐ Step \d+:/g) || []).length;
    assert(
      tableRowsCount === 2,
      'Should have 2 step rows with proper table structure',
    );
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
          validation_required: false,
        },
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
              command: 'kubectl apply -f backend.yaml',
            },
            {
              name: 'Deploy Frontend',
              type: 'automatic',
              command: 'kubectl apply -f frontend.yaml',
            },
          ],
        },
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0,
      },
    };

    const markdown = generateManual(testOperation);

    // Parent step should indicate it has sub-steps, not show "(manual step)"
    assert(
      !markdown.includes('_(manual step)_'),
      'Should not show generic "(manual step)" when step has sub_steps',
    );
    assert(
      markdown.includes('_(see substeps below)_') ||
        markdown.includes('Deploy all microservices'),
      'Should show description or indicate substeps exist',
    );

    // Sub-steps should show their commands
    assert(
      markdown.includes('Step 1a: Deploy Backend'),
      'Should show first sub-step',
    );
    assert(
      markdown.includes('kubectl apply -f backend.yaml'),
      'Should show sub-step command',
    );
    assert(
      markdown.includes('Step 1b: Deploy Frontend'),
      'Should show second sub-step',
    );
    assert(
      markdown.includes('kubectl apply -f frontend.yaml'),
      'Should show sub-step command',
    );
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
        LOG_FORMAT: 'json',
      },
      environments: [
        {
          name: 'staging',
          description: 'Staging environment',
          // Merged common_variables + env-specific variables
          variables: {
            REGISTRY: 'docker.io/mycompany',
            APP_NAME: 'myapp',
            LOG_FORMAT: 'json',
            REPLICAS: 2,
            LOG_LEVEL: 'debug',
          },
          restrictions: [],
          approval_required: false,
          validation_required: false,
        },
        {
          name: 'production',
          description: 'Production environment',
          // Merged common_variables + env-specific variables (LOG_FORMAT overridden)
          variables: {
            REGISTRY: 'docker.io/mycompany',
            APP_NAME: 'myapp',
            LOG_FORMAT: 'text',
            REPLICAS: 5,
            LOG_LEVEL: 'warn',
          },
          restrictions: [],
          approval_required: true,
          validation_required: true,
        },
      ],
      variables: {
        staging: {
          REGISTRY: 'docker.io/mycompany',
          APP_NAME: 'myapp',
          LOG_FORMAT: 'json',
          REPLICAS: 2,
          LOG_LEVEL: 'debug',
        },
        production: {
          REGISTRY: 'docker.io/mycompany',
          APP_NAME: 'myapp',
          LOG_FORMAT: 'text',
          REPLICAS: 5,
          LOG_LEVEL: 'warn',
        },
      },
      steps: [
        {
          name: 'Build and Push',
          type: 'automatic',
          command:
            'docker build -t ${REGISTRY}/${APP_NAME}:latest . && docker push ${REGISTRY}/${APP_NAME}:latest',
        },
        {
          name: 'Configure Logging',
          type: 'automatic',
          command:
            'kubectl set env deployment/${APP_NAME} LOG_FORMAT=${LOG_FORMAT} LOG_LEVEL=${LOG_LEVEL}',
        },
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0,
      },
    };

    const markdown = generateManual(testOperation);

    // Common variables should be used in all environments
    assert(
      markdown.includes('docker.io/mycompany/myapp'),
      'Should use common REGISTRY and APP_NAME',
    );

    // Staging should use common LOG_FORMAT (json)
    assert(
      markdown.includes('LOG_FORMAT=json LOG_LEVEL=debug'),
      'Staging should use common LOG_FORMAT and env-specific LOG_LEVEL',
    );

    // Production should override LOG_FORMAT (text)
    assert(
      markdown.includes('LOG_FORMAT=text LOG_LEVEL=warn'),
      'Production should override LOG_FORMAT with env-specific value',
    );
  });

  it('should support step-scoped variables that override environment variables (FIXME #2)', () => {
    const testOperation: Operation = {
      id: 'step-vars-test-123',
      name: 'Step Variables Test',
      version: '1.0.0',
      description: 'Test step-scoped variables',
      common_variables: {
        REGISTRY: 'docker.io/default',
        TAG: 'latest',
      },
      environments: [
        {
          name: 'staging',
          description: 'Staging',
          variables: {
            REGISTRY: 'docker.io/staging',
            TAG: 'latest',
            NAMESPACE: 'staging',
          },
          restrictions: [],
          approval_required: false,
          validation_required: false,
        },
        {
          name: 'production',
          description: 'Production',
          variables: {
            REGISTRY: 'docker.io/prod',
            TAG: 'latest',
            NAMESPACE: 'prod',
          },
          restrictions: [],
          approval_required: true,
          validation_required: false,
        },
      ],
      variables: {
        staging: {
          REGISTRY: 'docker.io/staging',
          TAG: 'latest',
          NAMESPACE: 'staging',
        },
        production: {
          REGISTRY: 'docker.io/prod',
          TAG: 'latest',
          NAMESPACE: 'prod',
        },
      },
      steps: [
        {
          name: 'Build Standard Image',
          type: 'automatic',
          command: 'docker build -t ${REGISTRY}/app:${TAG} .',
        },
        {
          name: 'Build Special Image',
          type: 'automatic',
          command: 'docker build -t ${REGISTRY}/app:${TAG} .',
          variables: {
            TAG: 'special-v1.0', // Override TAG for this step only
          },
        },
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0,
      },
    };

    const markdown = generateManual(testOperation);

    // First step uses environment TAG
    assert(
      markdown.includes('docker build -t docker.io/staging/app:latest .'),
      'First step should use environment TAG for staging',
    );
    assert(
      markdown.includes('docker build -t docker.io/prod/app:latest .'),
      'First step should use environment TAG for production',
    );

    // Second step uses step-scoped TAG variable
    assert(
      markdown.includes('docker build -t docker.io/staging/app:special-v1.0 .'),
      'Second step should use step TAG override for staging',
    );
    assert(
      markdown.includes('docker build -t docker.io/prod/app:special-v1.0 .'),
      'Second step should use step TAG override for production',
    );
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
          validation_required: false,
        },
      ],
      variables: { production: {} },
      steps: [
        {
          name: 'Preflight Check 1',
          type: 'automatic',
          phase: 'preflight',
          command: 'echo preflight1',
        },
        {
          name: 'Preflight Check 2',
          type: 'automatic',
          phase: 'preflight',
          command: 'echo preflight2',
        },
        {
          name: 'Main Step 1',
          type: 'automatic',
          phase: 'flight',
          command: 'echo main1',
        },
        {
          name: 'Main Step 2',
          type: 'automatic',
          phase: 'flight',
          command: 'echo main2',
        },
        {
          name: 'Postflight Check 1',
          type: 'manual',
          phase: 'postflight',
          command: 'echo postflight1',
        },
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0,
      },
    };

    const markdown = generateManual(testOperation);

    // Should have continuous numbering: 1, 2, 3, 4, 5
    assert(
      markdown.includes('Step 1: Preflight Check 1'),
      'Preflight should start at 1',
    );
    assert(
      markdown.includes('Step 2: Preflight Check 2'),
      'Preflight should continue to 2',
    );
    assert(
      markdown.includes('Step 3: Main Step 1'),
      'Flight should continue from 3',
    );
    assert(
      markdown.includes('Step 4: Main Step 2'),
      'Flight should continue to 4',
    );
    assert(
      markdown.includes('Step 5: Postflight Check 1'),
      'Postflight should continue from 5',
    );

    // Should NOT reset numbering in each phase
    assert(
      !markdown.match(/Flight Phase.*Step 1: Main Step 1/s),
      'Flight phase should not start numbering from 1',
    );
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
          validation_required: false,
        },
      ],
      variables: { production: {} },
      steps: [
        {
          name: 'Fix Bug',
          type: 'manual',
          command: 'Apply the bug fix',
          ticket: 'JIRA-123',
        },
        {
          name: 'Deploy Feature',
          type: 'automatic',
          command: 'kubectl apply -f feature.yaml',
          ticket: ['TASK-456', 'BUG-789'],
        },
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0,
      },
    };

    const markdown = generateManual(testOperation);

    // Should display single ticket
    assert(
      markdown.includes('🎫 <em>Tickets: JIRA-123</em>'),
      'Should show single ticket reference with emoji',
    );

    // Should display multiple tickets
    assert(
      markdown.includes('🎫 <em>Tickets: TASK-456, BUG-789</em>'),
      'Should show multiple ticket references',
    );
  });

  it('should load variables from .env file (FIXME #3)', () => {
    const testOperation: Operation = {
      id: 'env-file-test-123',
      name: 'Env File Test',
      version: '1.0.0',
      description: 'Test .env file loading',
      env_file: '.env', // Simulating loaded from .env
      common_variables: {
        APP_NAME: 'myapp', // Override from .env
        VERSION: '1.0.0', // New variable
      },
      environments: [
        {
          name: 'staging',
          description: 'Staging',
          // Variables should include: REGISTRY (from .env), APP_NAME (overridden), VERSION (from common)
          variables: {
            REGISTRY: 'docker.io/default',
            APP_NAME: 'myapp',
            VERSION: '1.0.0',
            REPLICAS: 2,
          },
          restrictions: [],
          approval_required: false,
          validation_required: false,
        },
        {
          name: 'production',
          description: 'Production',
          variables: {
            REGISTRY: 'docker.io/default',
            APP_NAME: 'myapp',
            VERSION: '1.0.0',
            REPLICAS: 5,
          },
          restrictions: [],
          approval_required: true,
          validation_required: false,
        },
      ],
      variables: {
        staging: {
          REGISTRY: 'docker.io/default',
          APP_NAME: 'myapp',
          VERSION: '1.0.0',
          REPLICAS: 2,
        },
        production: {
          REGISTRY: 'docker.io/default',
          APP_NAME: 'myapp',
          VERSION: '1.0.0',
          REPLICAS: 5,
        },
      },
      steps: [
        {
          name: 'Build Image',
          type: 'automatic',
          command: 'docker build -t ${REGISTRY}/${APP_NAME}:${VERSION} .',
        },
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0,
      },
    };

    const markdown = generateManual(testOperation);

    // Variables from .env and common_variables should be merged and used
    assert(
      markdown.includes('docker build -t docker.io/default/myapp:1.0.0 .'),
      'Should use variables from .env file merged with common_variables',
    );
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
          validation_required: false,
        },
      ],
      variables: { production: { NAMESPACE: 'prod' } },
      steps: [
        {
          name: 'Deploy Services',
          type: 'automatic',
          command: `kubectl apply -f backend.yaml
kubectl apply -f frontend.yaml
kubectl apply -f worker.yaml`,
        },
        {
          name: 'Smoke Test',
          type: 'manual',
          instruction: `Test the following:
1. Check API health
2. Verify frontend loads
3. Confirm worker is running`,
        },
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0,
      },
    };

    const markdown = generateManual(testOperation);

    // Commands should use <br> for line breaks but NOT have trailing <br>
    assert(
      markdown.includes(
        'kubectl apply -f backend.yaml<br>kubectl apply -f frontend.yaml<br>kubectl apply -f worker.yaml',
      ),
      'Should convert newlines to <br> tags',
    );

    // Should NOT have <br>` (br tag before closing backtick)
    assert(
      !markdown.includes('<br>`'),
      'Should not have trailing <br> before closing backtick',
    );

    // Instruction should also not have trailing <br>
    assert(
      markdown.includes(
        '1. Check API health<br>2. Verify frontend loads<br>3. Confirm worker is running',
      ),
      'Should convert instruction newlines to <br> tags',
    );
    assert(
      !markdown.match(/<br>\s*`\)/),
      'Should not have trailing <br> in instructions',
    );
  });

  it('should render section headings to break up large tables', () => {
    const testOperation: Operation = {
      id: 'section-heading-test',
      name: 'Section Heading Test',
      version: '1.0.0',
      description: 'Test section heading feature',
      environments: [
        {
          name: 'production',
          description: 'Production',
          variables: {},
          restrictions: [],
          approval_required: false,
          validation_required: false,
        },
      ],
      variables: { production: {} },
      steps: [
        {
          name: 'Step 1',
          type: 'automatic',
          command: 'echo step1',
        },
        {
          name: 'Database Migration',
          type: 'manual',
          description: 'Migrate database schema',
          command: 'run migrations',
          section_heading: true,
        },
        {
          name: 'Step 3',
          type: 'automatic',
          command: 'echo step3',
        },
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0,
      },
    };

    const markdown = generateManual(testOperation);

    // Should have section heading
    assert(
      markdown.includes('### Database Migration'),
      'Should have section heading',
    );
    assert(
      markdown.includes('Migrate database schema'),
      'Should include description under heading',
    );

    // Should have steps before and after
    assert(
      markdown.includes('Step 1: Step 1'),
      'Should have step before section',
    );
    assert(
      markdown.includes('Step 3: Step 3'),
      'Should have step after section',
    );
  });

  it('should display PIC and timeline information', () => {
    const testOperation: Operation = {
      id: 'pic-timeline-test',
      name: 'PIC Timeline Test',
      version: '1.0.0',
      description: 'Test PIC and timeline',
      environments: [
        {
          name: 'production',
          description: 'Production',
          variables: {},
          restrictions: [],
          approval_required: false,
          validation_required: false,
        },
      ],
      variables: { production: {} },
      steps: [
        {
          name: 'Deploy Backend',
          type: 'automatic',
          command: 'kubectl apply -f backend.yaml',
          pic: 'John Doe',
          timeline: '2024-01-15 14:00 UTC',
        },
        {
          name: 'Verify Health',
          type: 'manual',
          command: 'curl /health',
          pic: 'Jane Smith',
          timeline: '30 minutes after deployment',
        },
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0,
      },
    };

    const markdown = generateManual(testOperation);

    // Should display PIC
    assert(
      markdown.includes('👤 <em>PIC: John Doe</em>'),
      'Should show PIC for first step',
    );
    assert(
      markdown.includes('👤 <em>PIC: Jane Smith</em>'),
      'Should show PIC for second step',
    );

    // Should display timeline
    assert(
      markdown.includes('⏱️ <em>Timeline: 2024-01-15 14:00 UTC</em>'),
      'Should show timeline for first step',
    );
    assert(
      markdown.includes('⏱️ <em>Timeline: 30 minutes after deployment</em>'),
      'Should show timeline for second step',
    );
  });

  it('should format structured timeline with natural language (Option 4)', () => {
    const testOperation: Operation = {
      id: 'structured-timeline-test',
      name: 'Structured Timeline Test',
      version: '1.0.0',
      description: 'Test structured timeline format with natural language',
      environments: [
        {
          name: 'production',
          description: 'Production',
          variables: {},
          restrictions: [],
          approval_required: false,
          validation_required: false,
        },
      ],
      variables: { production: {} },
      steps: [
        {
          name: 'Pre-deployment Check',
          type: 'automatic',
          command: 'kubectl get nodes',
          pic: 'DevOps Team',
          timeline: {
            start: '2024-01-15 09:00',
            duration: '30m',
          },
        },
        {
          name: 'Deploy Backend',
          type: 'automatic',
          command: 'kubectl apply -f backend.yaml',
          pic: 'Backend Team',
          timeline: {
            status: 'active',
            duration: '15m',
          },
        },
        {
          name: 'Deploy Frontend',
          type: 'automatic',
          command: 'kubectl apply -f frontend.yaml',
          pic: 'Frontend Team',
          timeline: {
            after: 'Deploy Backend',
            duration: '10m',
          },
        },
        {
          name: 'Critical Hotfix',
          type: 'manual',
          command: 'apply hotfix',
          pic: 'SRE Team',
          timeline: {
            start: '2024-01-15 14:00',
            duration: '2h',
            status: 'crit',
          },
        },
        {
          name: 'Simple Task',
          type: 'automatic',
          command: 'run task',
          timeline: {
            duration: '5m',
          },
        },
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0,
      },
    };

    const markdown = generateManual(testOperation);

    // Test Format 1: Absolute start with duration -> "2024-01-15 09:00 for 30m"
    assert(
      markdown.includes('⏱️ <em>Timeline: 2024-01-15 09:00 for 30m</em>'),
      'Should format absolute start with duration using "for"',
    );

    // Test Format 2: Duration only (status ignored) -> "15m"
    assert(
      markdown.includes('⏱️ <em>Timeline: 15m</em>'),
      'Should format duration (status field ignored)',
    );

    // Test Format 3: Dependency with duration -> "(after Deploy Backend) 10m"
    assert(
      markdown.includes('⏱️ <em>Timeline: (after Deploy Backend) 10m</em>'),
      'Should format dependency with duration using parentheses',
    );

    // Test Format 4: Complete without status -> "2024-01-15 14:00 for 2h"
    assert(
      markdown.includes('⏱️ <em>Timeline: 2024-01-15 14:00 for 2h</em>'),
      'Should format complete timeline (status field ignored)',
    );

    // Test Format 5: Just duration -> "5m"
    assert(
      markdown.includes('⏱️ <em>Timeline: 5m</em>'),
      'Should format simple duration without extra text',
    );

    // Verify "for" is only used with start times
    const forCount = (markdown.match(/ for /g) || []).length;
    assert(
      forCount === 2,
      'Should use "for" only with absolute start times (2 occurrences)',
    );

    // Verify parentheses are used for dependencies
    assert(
      markdown.includes('(after Deploy Backend)'),
      'Should wrap dependency in parentheses',
    );
  });

  it('should display rollback procedures', () => {
    const testOperation: Operation = {
      id: 'rollback-test',
      name: 'Rollback Test',
      version: '1.0.0',
      description: 'Test rollback display',
      environments: [
        {
          name: 'staging',
          description: 'Staging',
          variables: { NAMESPACE: 'staging' },
          restrictions: [],
          approval_required: false,
          validation_required: false,
        },
        {
          name: 'production',
          description: 'Production',
          variables: { NAMESPACE: 'prod' },
          restrictions: [],
          approval_required: true,
          validation_required: false,
        },
      ],
      variables: {
        staging: { NAMESPACE: 'staging' },
        production: { NAMESPACE: 'prod' },
      },
      steps: [
        {
          name: 'Deploy Application',
          type: 'automatic',
          command: 'kubectl apply -f deployment.yaml -n ${NAMESPACE}',
          rollback: {
            command: 'kubectl rollout undo deployment/app -n ${NAMESPACE}',
          },
        },
        {
          name: 'Update Config',
          type: 'manual',
          command: 'kubectl apply -f config.yaml',
          rollback: {
            instruction:
              'kubectl delete configmap app-config && kubectl apply -f config-backup.yaml',
          },
        },
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0,
      },
    };

    const markdown = generateManual(testOperation);

    // Should have rollback section
    assert(
      markdown.includes('## 🔄 Rollback Procedures'),
      'Should have rollback section',
    );
    assert(
      markdown.includes('Rollback for: Deploy Application'),
      'Should have rollback for first step',
    );
    assert(
      markdown.includes('Rollback for: Update Config'),
      'Should have rollback for second step',
    );

    // Should show rollback commands
    assert(
      markdown.includes('kubectl rollout undo deployment/app'),
      'Should show rollback command',
    );
    assert(
      markdown.includes('kubectl delete configmap app-config'),
      'Should show rollback instruction',
    );

    // Should resolve variables in rollback
    assert(
      markdown.includes('kubectl rollout undo deployment/app -n staging'),
      'Should resolve NAMESPACE for staging',
    );
    assert(
      markdown.includes('kubectl rollout undo deployment/app -n prod'),
      'Should resolve NAMESPACE for production',
    );
  });

  it('should expand steps with foreach loops (FIXME #8)', () => {
    const testOperation: Operation = {
      id: 'foreach-test-123',
      name: 'Foreach Test',
      version: '1.0.0',
      description: 'Test foreach loops',
      environments: [
        {
          name: 'production',
          description: 'Production',
          variables: {},
          restrictions: [],
          approval_required: false,
          validation_required: false,
        },
      ],
      variables: { production: {} },
      steps: [
        {
          name: 'Deploy Service (backend)',
          type: 'automatic',
          command: 'kubectl apply -f backend.yaml',
          variables: { SERVICE: 'backend' },
        },
        {
          name: 'Deploy Service (frontend)',
          type: 'automatic',
          command: 'kubectl apply -f frontend.yaml',
          variables: { SERVICE: 'frontend' },
        },
        {
          name: 'Deploy Service (worker)',
          type: 'automatic',
          command: 'kubectl apply -f worker.yaml',
          variables: { SERVICE: 'worker' },
        },
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0,
      },
    };

    const markdown = generateManual(testOperation);

    // Should have 3 expanded steps
    assert(
      markdown.includes('Step 1: Deploy Service (backend)'),
      'Should have first expanded step',
    );
    assert(
      markdown.includes('Step 2: Deploy Service (frontend)'),
      'Should have second expanded step',
    );
    assert(
      markdown.includes('Step 3: Deploy Service (worker)'),
      'Should have third expanded step',
    );

    // Each should have the correct command
    assert(
      markdown.includes('kubectl apply -f backend.yaml'),
      'Should have backend command',
    );
    assert(
      markdown.includes('kubectl apply -f frontend.yaml'),
      'Should have frontend command',
    );
    assert(
      markdown.includes('kubectl apply -f worker.yaml'),
      'Should have worker command',
    );
  });

  it('should include Gantt chart when requested with timeline data', (_t) => {
    const testOperation: Operation = {
      id: 'test-gantt',
      name: 'Test Gantt Operation',
      version: '1.0.0',
      description: 'Test Gantt chart generation',
      environments: [
        {
          name: 'staging',
          description: 'Staging environment',
          variables: {},
          restrictions: [],
          approval_required: false,
          validation_required: false,
          targets: [],
        },
      ],
      variables: {},
      steps: [
        {
          name: 'Pre-deployment Check',
          type: 'automatic',
          phase: 'preflight',
          command: 'kubectl get nodes',
          pic: 'DevOps Team',
          timeline: '2024-01-15 09:00 UTC',
        },
        {
          name: 'Deploy Backend',
          type: 'automatic',
          phase: 'flight',
          command: 'kubectl apply -f backend.yaml',
          pic: 'Backend Team',
          timeline: '15 minutes',
        },
        {
          name: 'Post-deployment Verification',
          type: 'manual',
          phase: 'postflight',
          command: 'curl https://example.com/health',
          pic: 'QA Team',
          timeline: 'After all deployments complete',
        },
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0,
      },
    };

    const markdown = generateManualWithMetadata(
      testOperation,
      undefined,
      undefined,
      false,
      true,
    );

    // Should include Mermaid Gantt chart
    assert(markdown.includes('```mermaid'), 'Should have mermaid code block');
    assert(markdown.includes('gantt'), 'Should have gantt keyword');
    assert(
      markdown.includes('title Test Gantt Operation Timeline'),
      'Should have operation title',
    );

    // Should include phase sections (without emojis as Mermaid doesn't render them correctly)
    assert(
      markdown.includes('section Pre-Flight Phase'),
      'Should have preflight section',
    );
    assert(
      markdown.includes('section Flight Phase'),
      'Should have flight section',
    );
    assert(
      markdown.includes('section Post-Flight Phase'),
      'Should have postflight section',
    );

    // Should include step names with PICs
    assert(
      markdown.includes('Pre-deployment Check (DevOps Team)'),
      'Should have preflight step with PIC',
    );
    assert(
      markdown.includes('Deploy Backend (Backend Team)'),
      'Should have flight step with PIC',
    );
    assert(
      markdown.includes('Post-deployment Verification (QA Team)'),
      'Should have postflight step with PIC',
    );

    // Should include timeline data
    assert(
      markdown.includes(':2024-01-15 09:00 UTC'),
      'Should have first timeline',
    );
    assert(markdown.includes(':15 minutes'), 'Should have second timeline');
    assert(
      markdown.includes(':After all deployments complete'),
      'Should have third timeline',
    );
  });

  it('should not include Gantt chart when not requested', (_t) => {
    const testOperation: Operation = {
      id: 'test-no-gantt',
      name: 'Test No Gantt',
      version: '1.0.0',
      description: 'Test without Gantt chart',
      environments: [
        {
          name: 'staging',
          description: 'Staging environment',
          variables: {},
          restrictions: [],
          approval_required: false,
          validation_required: false,
          targets: [],
        },
      ],
      variables: {},
      steps: [
        {
          name: 'Deploy',
          type: 'automatic',
          command: 'kubectl apply -f app.yaml',
          pic: 'DevOps Team',
          timeline: '2024-01-15 09:00 UTC',
        },
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0,
      },
    };

    const markdown = generateManualWithMetadata(
      testOperation,
      undefined,
      undefined,
      false,
      false,
    );

    // Should not include Mermaid Gantt chart
    assert(
      !markdown.includes('```mermaid'),
      'Should not have mermaid code block when gantt=false',
    );
    assert(
      !markdown.includes('gantt'),
      'Should not have gantt keyword when gantt=false',
    );
  });

  it('should not include Gantt chart when no steps have timeline', (_t) => {
    const testOperation: Operation = {
      id: 'test-no-timeline',
      name: 'Test No Timeline',
      version: '1.0.0',
      description: 'Test without timeline data',
      environments: [
        {
          name: 'staging',
          description: 'Staging environment',
          variables: {},
          restrictions: [],
          approval_required: false,
          validation_required: false,
          targets: [],
        },
      ],
      variables: {},
      steps: [
        {
          name: 'Deploy',
          type: 'automatic',
          command: 'kubectl apply -f app.yaml',
        },
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0,
      },
    };

    const markdown = generateManualWithMetadata(
      testOperation,
      undefined,
      undefined,
      false,
      true,
    );

    // Should not include Gantt chart when no timeline data
    assert(
      !markdown.includes('```mermaid'),
      'Should not have mermaid code block when no timeline data',
    );
  });

  it('should not generate empty table when section_heading is first step', () => {
    const operation = yaml.load(loadYaml('sectionHeadingFirst')) as Operation;
    const markdown = generateManual(operation);

    // Should have phase header
    assert(
      markdown.includes('## ✈️ Flight Phase'),
      'Should have flight phase header',
    );

    // Should NOT have empty table before section heading
    // The pattern to avoid: | Step | staging | production |\n|------|\n\n### Initial Setup
    assert(
      !markdown.match(/\| Step \|.*\n\|------\|.*\n\n### Initial Setup/s),
      'Should not have empty table before section heading',
    );

    // Should have section heading immediately after phase header
    assert(
      markdown.match(/Flight Phase.*\n\n### Initial Setup/s),
      'Should have section heading immediately after phase header',
    );

    // Should have description
    assert(
      markdown.includes('Setup required before deployment'),
      'Should have description',
    );

    // Should have PIC metadata
    assert(
      markdown.includes('👤 PIC: DevOps Team'),
      'Should have PIC metadata',
    );

    // After section heading, should have table with steps
    assert(
      markdown.match(/### Initial Setup.*\| Step \| staging \| production \|/s),
      'Should have table after section heading',
    );
    assert(markdown.includes('☐ Step 1: Initial Setup'), 'Should have step 1');
    assert(markdown.includes('☐ Step 2: Deploy App'), 'Should have step 2');
    assert(markdown.includes('☐ Step 3: Verify'), 'Should have step 3');
  });

  it('should include code block for command_output evidence type', () => {
    const operation = yaml.load(loadYaml('evidenceRequired')) as Operation;
    const markdown = generateManual(operation);

    // Should include code block for command_output evidence type (Deploy Application step)
    assert(
      markdown.includes(
        '📎 <em>Evidence Required: screenshot, command_output</em>',
      ),
      'Should show evidence types with command_output',
    );
    assert(
      markdown.includes('```bash<br># Paste command output here<br>```'),
      'Should include code block for command_output evidence type',
    );

    // Should NOT include code block when command_output is not in types (Manual Verification step)
    assert(
      markdown.includes('📎 <em>Evidence Required: screenshot</em>'),
      'Should show evidence types without command_output',
    );

    // Count occurrences of the code block - should be exactly 1 (Deploy Application step only)
    // Evidence is in the step cell (first column), not repeated per environment
    const codeBlockMatches = markdown.match(
      /```bash<br># Paste command output here<br>```/g,
    );
    assert(
      codeBlockMatches && codeBlockMatches.length === 1,
      'Should have one code block for Deploy Application step with command_output evidence',
    );
  });

  it('should respect options.substitute_vars to control variable expansion', () => {
    const testOperation: Operation = {
      id: 'substitute-control-test',
      name: 'Substitute Control Test',
      version: '1.0.0',
      description: 'Test options.substitute_vars control',
      environments: [
        {
          name: 'production',
          description: 'Production',
          variables: { CLUSTER: 'prod-cluster', APP_NAME: 'myapp' },
          restrictions: [],
          approval_required: false,
          validation_required: false,
        },
      ],
      variables: {
        production: { CLUSTER: 'prod-cluster', APP_NAME: 'myapp' },
      },
      steps: [
        {
          name: 'Deploy with substitution',
          type: 'automatic',
          command: 'kubectl apply -f ${APP_NAME}.yaml --cluster=${CLUSTER}',
          // Default: substitute_vars = true
        },
        {
          name: 'Bash script without substitution',
          type: 'automatic',
          command: `#!/bin/bash
export TIMESTAMP=$(date +%Y%m%d_%H%M%S)
echo "Deploying at: \${TIMESTAMP}"`,
          options: {
            substitute_vars: false, // Disable substitution for this step
          },
        },
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0,
      },
    };

    const markdown = generateManualWithMetadata(
      testOperation,
      undefined,
      undefined,
      true,
    );

    // Step 1: Variables should be expanded (default behavior)
    assert(
      markdown.includes('kubectl apply -f myapp.yaml --cluster=prod-cluster'),
      'Should expand variables when substitute_vars is true (default)',
    );

    // Step 2: Variables should NOT be expanded (substitute_vars = false)
    assert(
      markdown.includes('export TIMESTAMP=$(date +%Y%m%d_%H%M%S)'),
      'Should preserve TIMESTAMP definition when substitute_vars is false',
    );
    assert(
      markdown.includes('echo "Deploying at: ${TIMESTAMP}"'),
      'Should preserve ${TIMESTAMP} when substitute_vars is false',
    );

    // Verify the expanded values don't appear in step 2
    assert(
      !markdown.includes('echo "Deploying at: prod-cluster"'),
      'Should not expand CLUSTER in step with substitute_vars=false',
    );
  });

  it('should render overview section with flexible metadata fields', async (t) => {
    const operation = await parseFixture('withOverview');
    const markdown = generateManual(operation);

    // Should have Overview section
    assert(markdown.includes('## Overview'), 'Should have Overview section');

    // Should have table structure
    assert(
      markdown.includes('| Item | Specification |'),
      'Should have overview table header',
    );
    assert(
      markdown.includes('| ---- | ------------- |'),
      'Should have overview table separator',
    );

    // Should render all overview fields
    assert(
      markdown.includes('| Release Date | 23 Jul 2025 |'),
      'Should show Release Date field',
    );
    assert(
      markdown.includes(
        '| Release Notes | https://confluence.example.com/release-notes/v1.0.0 |',
      ),
      'Should show Release Notes field',
    );
    assert(
      markdown.includes('| Release Ticket | INPDRP-2489 |'),
      'Should show Release Ticket field',
    );
    assert(
      markdown.includes(
        '| EPIC Tickets | https://github.com/project/issues/152 |',
      ),
      'Should show EPIC Tickets field',
    );
    assert(
      markdown.includes('| Manual Status | APPROVED |'),
      'Should show Manual Status field',
    );
    assert(
      markdown.includes('| War Room | https://zoom.us/j/warroom-rehearsal |'),
      'Should show War Room field',
    );
    assert(
      markdown.includes(
        '| Production Release War Room | https://zoom.us/j/warroom-prod |',
      ),
      'Should show Production Release War Room field',
    );

    // Overview should appear after description but before other sections
    const overviewIndex = markdown.indexOf('## Overview');
    const _dependenciesIndex = markdown.indexOf('## Dependencies');
    const environmentsIndex = markdown.indexOf('## Environments Overview');

    assert(
      overviewIndex < environmentsIndex || environmentsIndex === -1,
      'Overview should appear before Environments section',
    );

    // Snapshot the complete manual
    t.assert.snapshot(markdown);
  });

  it('should render evidence results (file references and inline content)', async (t) => {
    const operation = await parseFixture('evidenceWithResults');
    const markdown = generateManual(operation);

    // Should include evidence types
    assert(
      markdown.includes(
        '📎 <em>Evidence Required: screenshot, command_output</em>',
      ),
      'Should show evidence types',
    );

    // Should include "Captured Evidence" section
    assert(
      markdown.includes('**Captured Evidence:**'),
      'Should have Captured Evidence section',
    );

    // Should render screenshot as image with description
    assert(
      markdown.includes(
        '**screenshot**: Kubernetes dashboard showing 3 pods running',
      ),
      'Should show screenshot description',
    );
    assert(
      markdown.includes('![Evidence](./evidence/deployment-dashboard.png)'),
      'Should render screenshot as image',
    );

    // Should render command_output in code block
    assert(
      markdown.includes('**command_output**:'),
      'Should show command_output label',
    );
    assert(
      markdown.includes('```bash'),
      'Should use bash code block for command_output',
    );
    assert(
      markdown.includes('deployment.apps/web-server created'),
      'Should include command output content',
    );
    assert(
      markdown.includes('pod/web-0    1/1     Running'),
      'Should include pod status output',
    );

    // Should render log content
    assert(
      markdown.includes('**log**: Application startup logs'),
      'Should show log description',
    );
    assert(
      markdown.includes('[2025-10-16 10:30:00] INFO: Application started'),
      'Should include log content',
    );

    // Should render file reference for non-image types
    assert(
      markdown.includes(
        '[View screenshot](./evidence/homepage-screenshot.png)',
      ) || markdown.includes('![Evidence](./evidence/homepage-screenshot.png)'),
      'Should render screenshot file reference',
    );

    // Step without results should only show placeholder
    assert(
      markdown.includes('📎 <em>Evidence Required: command_output</em>'),
      'Should show evidence requirement without results',
    );

    // Count "Captured Evidence" sections - with environment-keyed evidence,
    // we have 3 steps with results × 2 environments = 6 sections
    const capturedEvidenceCount = (
      markdown.match(/\*\*Captured Evidence:\*\*/g) || []
    ).length;
    assert(
      capturedEvidenceCount === 6,
      'Should have 6 Captured Evidence sections (3 steps with results × 2 environments)',
    );

    // Snapshot test
    t.assert.snapshot(markdown);
  });

  it('should handle evidence results with file-only and content-only', () => {
    const testOperation: Operation = {
      id: 'evidence-test',
      name: 'Evidence Test',
      version: '1.0.0',
      description: 'Test evidence results',
      environments: [
        {
          name: 'production',
          description: 'Production',
          variables: {},
          restrictions: [],
          approval_required: false,
          validation_required: false,
        },
      ],
      variables: { production: {} },
      steps: [
        {
          name: 'Screenshot Only',
          type: 'manual',
          command: 'Take screenshot',
          evidence: {
            required: true,
            types: ['screenshot'],
            results: {
              production: [
                {
                  type: 'screenshot',
                  file: './evidence/screen.png',
                  description: 'Application homepage',
                },
              ],
            },
          },
        },
        {
          name: 'Log Only',
          type: 'manual',
          command: 'Check logs',
          evidence: {
            required: true,
            types: ['log'],
            results: {
              production: [
                {
                  type: 'log',
                  content: 'Log line 1\nLog line 2\nLog line 3',
                },
              ],
            },
          },
        },
      ],
      preflight: [],
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0,
      },
    };

    const markdown = generateManual(testOperation);

    // File reference should render as image
    assert(
      markdown.includes('![Evidence](./evidence/screen.png)'),
      'Should render file as image',
    );
    assert(
      markdown.includes('**screenshot**: Application homepage'),
      'Should show description',
    );

    // Content should render in code block
    assert(markdown.includes('```text'), 'Should use text code block for log');
    assert(
      markdown.includes('Log line 1<br>Log line 2<br>Log line 3'),
      'Should convert newlines to <br> in log content',
    );
  });
});
