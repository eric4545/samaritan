import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateManualWithMetadata } from '../../src/manuals/generator';
import { createGenerationMetadata } from '../../src/lib/git-metadata';
import { Operation } from '../../src/models/operation';

describe('Manual Generation with Metadata Integration', () => {
  const testOperation: Operation = {
    id: 'metadata-test-123',
    name: 'Metadata Test Operation',
    version: '3.0.0',
    description: 'Test operation for metadata integration',
    environments: [
      {
        name: 'staging',
        description: 'Staging environment',
        variables: { REPLICAS: 2, APP_NAME: 'test-app-staging' },
        restrictions: [],
        approval_required: false,
        validation_required: false
      },
      {
        name: 'production',
        description: 'Production environment',
        variables: { REPLICAS: 5, APP_NAME: 'test-app-prod' },
        restrictions: [],
        approval_required: true,
        validation_required: true
      }
    ],
    variables: {
      staging: { REPLICAS: 2, APP_NAME: 'test-app-staging' },
      production: { REPLICAS: 5, APP_NAME: 'test-app-prod' }
    },
    steps: [
      {
        name: 'Deploy Application',
        type: 'automatic',
        description: 'Deploy the application',
        command: 'kubectl apply -f deployment.yaml --replicas=${REPLICAS}'
      }
    ],
    preflight: [],
    metadata: {
      created_at: new Date(),
      updated_at: new Date(),
      execution_count: 0
    }
  };

  it('should generate manual with YAML frontmatter when metadata provided', async () => {
    const metadata = await createGenerationMetadata(
      'examples/metadata-test.yaml',
      'metadata-test-123',
      '3.0.0',
      'production'
    );

    const manual = generateManualWithMetadata(testOperation, metadata, 'production', false);

    // Should start with YAML frontmatter
    assert(manual.startsWith('---\n'), 'Should start with YAML frontmatter');
    assert(manual.includes('---\n\n# Manual for:'), 'Should have frontmatter delimiter followed by content');

    // Should contain metadata fields
    assert(manual.includes('source_file: "examples/metadata-test.yaml"'));
    assert(manual.includes('operation_id: "metadata-test-123"'));
    assert(manual.includes('operation_version: "3.0.0"'));
    assert(manual.includes('target_environment: "production"'));
    assert(manual.includes('generator_version: "1.0.0"'));

    // Git fields should be present (either real values from actual git or 'unknown' as fallback)
    assert(manual.includes('git_sha:'));
    assert(manual.includes('git_branch:'));
    assert(manual.includes('git_short_sha:'));
    assert(manual.includes('git_author:'));
    assert(manual.includes('git_message:'));
    assert(manual.includes('git_dirty:'));

    // Should contain the manual content
    assert(manual.includes('# Manual for: Metadata Test Operation (v3.0.0)'));
    assert(manual.includes('production'), 'Should include production environment');
    assert(!manual.includes('staging'), 'Should not include staging when filtered to production');
  });

  it('should generate manual without frontmatter when no metadata provided', () => {
    const manual = generateManualWithMetadata(testOperation, undefined, undefined, false);

    // Should NOT start with YAML frontmatter
    assert(!manual.startsWith('---\n'), 'Should not start with YAML frontmatter when no metadata');
    assert(manual.startsWith('# Manual for:'), 'Should start directly with manual content');

    // Should contain normal manual content
    assert(manual.includes('# Manual for: Metadata Test Operation (v3.0.0)'));
    assert(manual.includes('staging'), 'Should include staging environment');
    assert(manual.includes('production'), 'Should include production environment');
  });

  it('should handle metadata with no target environment', async () => {
    const metadata = await createGenerationMetadata(
      'examples/all-env.yaml',
      'all-env-123',
      '1.5.0'
      // No target environment specified
    );

    const manual = generateManualWithMetadata(testOperation, metadata, undefined, true);

    // Should have frontmatter but without target_environment field
    assert(manual.includes('source_file: "examples/all-env.yaml"'));
    assert(manual.includes('operation_id: "all-env-123"'));
    assert(manual.includes('operation_version: "1.5.0"'));
    assert(!manual.includes('target_environment:'), 'Should not include target_environment when not specified');

    // Should include git fields (either real values or fallback)
    assert(manual.includes('git_dirty:'));

    // Should include both environments (no filtering)
    assert(manual.includes('| Step | staging | production |'), 'Should include both environment columns');

    // Should resolve variables since resolveVariables=true
    assert(manual.includes('--replicas=2'), 'Should resolve staging variables');
    assert(manual.includes('--replicas=5'), 'Should resolve production variables');
  });

  it('should combine environment filtering, variable resolution, and metadata', async () => {
    const metadata = await createGenerationMetadata(
      'operations/advanced-deployment.yaml',
      'advanced-deploy-789',
      '4.2.1',
      'staging'
    );

    const manual = generateManualWithMetadata(testOperation, metadata, 'staging', true);

    // Should have complete frontmatter with staging target
    assert(manual.includes('target_environment: "staging"'));
    assert(manual.includes('source_file: "operations/advanced-deployment.yaml"'));
    assert(manual.includes('operation_id: "advanced-deploy-789"'));
    assert(manual.includes('operation_version: "4.2.1"'));

    // Should have git metadata (either real or fallback)
    assert(manual.includes('git_branch:'));
    assert(manual.includes('git_dirty:'));
    assert(manual.includes('git_message:'));

    // Should be filtered to staging only
    assert(manual.includes('| Step | staging |'), 'Should have only staging column');
    assert(!manual.includes('| production |'), 'Should not include production column when filtered');

    // Should resolve variables for staging
    assert(manual.includes('--replicas=2'), 'Should resolve staging REPLICAS variable');
    assert(!manual.includes('--replicas=5'), 'Should not include production values when filtered to staging');
    assert(!manual.includes('${REPLICAS}'), 'Should not contain template variables when resolved');

    // Should show staging environment details only
    assert(!manual.includes('| production |'), 'Should not contain production environment row when filtered');
  });

  it('should handle git metadata gracefully', async () => {
    const metadata = await createGenerationMetadata(
      'examples/fallback-test.yaml',
      'fallback-123',
      '1.0.0',
      'production'
    );

    const manual = generateManualWithMetadata(testOperation, metadata, 'production', false);

    // Should generate frontmatter with git values (either real or fallback to 'unknown')
    assert(manual.includes('git_sha:'));
    assert(manual.includes('git_branch:'));
    assert(manual.includes('git_author:'));
    assert(manual.includes('git_dirty:'));
    assert(manual.includes('target_environment: "production"'));
    assert(manual.includes('source_file: "examples/fallback-test.yaml"'));
    assert(manual.includes('operation_id: "fallback-123"'));

    // Should still generate normal manual content
    assert(manual.includes('# Manual for: Metadata Test Operation (v3.0.0)'));
  });
});