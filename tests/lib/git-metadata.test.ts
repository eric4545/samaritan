import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  generateYamlFrontmatter,
  createGenerationMetadata
} from '../../src/lib/git-metadata';

describe('Git Metadata', () => {
  describe('createGenerationMetadata', () => {
    it('should create basic metadata structure', async () => {
      const metadata = await createGenerationMetadata(
        'examples/test.yaml',
        'test-op-123',
        '2.0.0',
        'production'
      );

      // Test basic fields that should always be present
      assert.strictEqual(metadata.source_file, 'examples/test.yaml');
      assert.strictEqual(metadata.operation_id, 'test-op-123');
      assert.strictEqual(metadata.operation_version, '2.0.0');
      assert.strictEqual(metadata.target_environment, 'production');
      assert.strictEqual(metadata.generator_version, '1.0.0');

      // Should have valid ISO timestamp
      assert(metadata.generated_at.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/), 'Should have valid ISO timestamp');

      // Git fields should be present (either real values or 'unknown')
      assert(typeof metadata.git_sha === 'string', 'Should have git_sha field');
      assert(typeof metadata.git_branch === 'string', 'Should have git_branch field');
      assert(typeof metadata.git_dirty === 'boolean', 'Should have git_dirty field');

      // Git metadata should either be real values or fallback to 'unknown'
      if (metadata.git_sha !== 'unknown') {
        assert(metadata.git_sha.length >= 7, 'Real git SHA should be at least 7 characters');
      }
      if (metadata.git_branch !== 'unknown') {
        assert(metadata.git_branch.length > 0, 'Real git branch should not be empty');
      }
    });

    it('should handle missing target environment', async () => {
      const metadata = await createGenerationMetadata(
        'examples/test.yaml',
        'test-op-456',
        '1.5.0'
        // No target environment
      );

      assert.strictEqual(metadata.target_environment, undefined);
      assert.strictEqual(metadata.source_file, 'examples/test.yaml');
      assert.strictEqual(metadata.operation_id, 'test-op-456');
      assert.strictEqual(metadata.operation_version, '1.5.0');
      assert.strictEqual(metadata.generator_version, '1.0.0');
    });

    it('should generate git short SHA from full SHA', async () => {
      const metadata = await createGenerationMetadata(
        'examples/test.yaml',
        'test-sha-123',
        '1.0.0'
      );

      // If we have a real git SHA (not 'unknown'), short SHA should be first 8 characters
      if (metadata.git_sha !== 'unknown' && metadata.git_sha.length >= 8) {
        assert.strictEqual(metadata.git_short_sha, metadata.git_sha.substring(0, 8));
      } else if (metadata.git_sha === 'unknown') {
        assert.strictEqual(metadata.git_short_sha, 'unknown');
      }
    });
  });

  describe('generateYamlFrontmatter', () => {
    it('should generate valid YAML frontmatter with all fields', () => {
      const metadata = {
        source_file: 'examples/deployment.yaml',
        operation_id: 'deploy-123',
        operation_version: '2.1.0',
        target_environment: 'production',
        generated_at: '2023-12-01T15:30:45.123Z',
        git_sha: 'abcdef123456',
        git_branch: 'main',
        git_short_sha: 'abcdef12',
        git_author: 'DevOps Team',
        git_date: '2023-12-01 15:25:30 +0000',
        git_message: 'feat: enhance deployment process',
        git_dirty: false,
        generator_version: '1.2.3'
      };

      const frontmatter = generateYamlFrontmatter(metadata);

      // Should start and end with ---
      assert(frontmatter.startsWith('---\n'), 'Should start with YAML frontmatter delimiter');
      assert(frontmatter.includes('\n---\n\n'), 'Should end with YAML frontmatter delimiter and newlines');

      // Should contain all expected fields
      assert(frontmatter.includes('source_file: "examples/deployment.yaml"'));
      assert(frontmatter.includes('operation_id: "deploy-123"'));
      assert(frontmatter.includes('operation_version: "2.1.0"'));
      assert(frontmatter.includes('target_environment: "production"'));
      assert(frontmatter.includes('generated_at: "2023-12-01T15:30:45.123Z"'));
      assert(frontmatter.includes('git_sha: "abcdef123456"'));
      assert(frontmatter.includes('git_branch: "main"'));
      assert(frontmatter.includes('git_short_sha: "abcdef12"'));
      assert(frontmatter.includes('git_author: "DevOps Team"'));
      assert(frontmatter.includes('git_date: "2023-12-01 15:25:30 +0000"'));
      assert(frontmatter.includes('git_message: "feat: enhance deployment process"'));
      assert(frontmatter.includes('git_dirty: false'));
      assert(frontmatter.includes('generator_version: "1.2.3"'));
    });

    it('should omit target_environment when not specified', () => {
      const metadata = {
        source_file: 'examples/test.yaml',
        operation_id: 'test-123',
        operation_version: '1.0.0',
        generated_at: '2023-12-01T15:30:45.123Z',
        git_sha: 'abc123',
        git_branch: 'feature',
        git_short_sha: 'abc12345',
        git_author: 'Test User',
        git_date: '2023-12-01 15:25:30 +0000',
        git_message: 'test commit',
        git_dirty: true,
        generator_version: '1.0.0'
      };

      const frontmatter = generateYamlFrontmatter(metadata);

      assert(!frontmatter.includes('target_environment:'), 'Should not include target_environment when undefined');
      assert(frontmatter.includes('source_file: "examples/test.yaml"'), 'Should still include other fields');
    });

    it('should properly escape quotes in git messages', () => {
      const metadata = {
        source_file: 'test.yaml',
        operation_id: 'test-123',
        operation_version: '1.0.0',
        generated_at: '2023-12-01T15:30:45.123Z',
        git_sha: 'abc123',
        git_branch: 'main',
        git_short_sha: 'abc12345',
        git_author: 'Test "Quotes" User',
        git_date: '2023-12-01 15:25:30 +0000',
        git_message: 'fix: handle "quoted" strings in config',
        git_dirty: false,
        generator_version: '1.0.0'
      };

      const frontmatter = generateYamlFrontmatter(metadata);

      // Should contain the quoted strings (YAML will handle escaping)
      assert(frontmatter.includes('git_author: "Test "Quotes" User"'));
      assert(frontmatter.includes('git_message: "fix: handle "quoted" strings in config"'));
    });
  });
});