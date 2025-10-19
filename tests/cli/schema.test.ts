import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { after, describe, it } from 'node:test';

describe('Schema Export Command', () => {
  const testOutputPath = '/tmp/samaritan-test-schema.json';
  const testOutputYamlPath = '/tmp/samaritan-test-schema.yaml';

  after(() => {
    // Cleanup test files
    if (existsSync(testOutputPath)) {
      unlinkSync(testOutputPath);
    }
    if (existsSync(testOutputYamlPath)) {
      unlinkSync(testOutputYamlPath);
    }
  });

  it('should export schema to JSON file', () => {
    // Execute schema export command
    const result = execSync(
      `npx tsx src/cli/index.ts schema --output ${testOutputPath}`,
      {
        cwd: process.cwd(),
        encoding: 'utf-8',
      },
    );

    // Verify success message
    assert.ok(result.includes('Schema exported to'));
    assert.ok(result.includes(testOutputPath));

    // Verify file was created
    assert.ok(existsSync(testOutputPath), 'Schema file should exist');

    // Verify file content is valid JSON
    const content = readFileSync(testOutputPath, 'utf-8');
    const schema = JSON.parse(content);

    // Verify schema structure
    assert.ok(schema.$schema, 'Schema should have $schema field');
    assert.ok(schema.$id, 'Schema should have $id field');
    assert.strictEqual(schema.title, 'SAMARITAN Operation');
    assert.strictEqual(schema.type, 'object');
    assert.ok(
      Array.isArray(schema.required),
      'Schema should have required array',
    );
    assert.ok(schema.properties, 'Schema should have properties object');
  });

  it('should export schema to YAML file', () => {
    // Execute schema export command with YAML format
    const result = execSync(
      `npx tsx src/cli/index.ts schema --format yaml --output ${testOutputYamlPath}`,
      {
        cwd: process.cwd(),
        encoding: 'utf-8',
      },
    );

    // Verify success message
    assert.ok(result.includes('Schema exported to'));
    assert.ok(result.includes(testOutputYamlPath));

    // Verify file was created
    assert.ok(existsSync(testOutputYamlPath), 'YAML schema file should exist');

    // Verify file content is YAML format
    const content = readFileSync(testOutputYamlPath, 'utf-8');

    // Check for YAML-specific formatting
    assert.ok(content.includes('$schema:'), 'YAML should have $schema field');
    assert.ok(content.includes('title:'), 'YAML should have title field');
    assert.ok(
      content.includes('SAMARITAN Operation'),
      'YAML should contain title value',
    );
  });

  it('should output schema to stdout by default', () => {
    // Execute schema export command without output flag
    const result = execSync('npx tsx src/cli/index.ts schema', {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });

    // Verify stdout contains JSON schema
    assert.ok(result.includes('"$schema"'), 'Stdout should contain $schema');
    assert.ok(result.includes('"title"'), 'Stdout should contain title');
    assert.ok(
      result.includes('SAMARITAN Operation'),
      'Stdout should contain title value',
    );

    // Verify it's valid JSON
    const schema = JSON.parse(result);
    assert.strictEqual(schema.title, 'SAMARITAN Operation');
  });
});
