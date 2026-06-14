import assert from 'node:assert';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { EnvironmentLoader } from '../../src/operations/environment-loader';
import { parseOperation } from '../../src/operations/parser';

const EXAMPLES_DIR = resolve(process.cwd(), 'examples');

describe('EnvironmentLoader manifest resolution', () => {
  it('loads a manifest from the sibling environments/ directory', async () => {
    const loader = new EnvironmentLoader(EXAMPLES_DIR);
    const manifest = await loader.loadEnvironmentManifest('k8s-cluster');

    assert.strictEqual(manifest.kind, 'EnvironmentManifest');
    assert.strictEqual(manifest.metadata.name, 'k8s-cluster');
    const names = manifest.environments.map((e) => e.name);
    assert.deepStrictEqual(names, ['development', 'staging', 'production']);
  });

  it('throws a helpful error when a manifest is missing', async () => {
    const loader = new EnvironmentLoader(EXAMPLES_DIR);
    await assert.rejects(
      () => loader.loadEnvironmentManifest('does-not-exist'),
      /Environment manifest 'does-not-exist' not found/,
    );
  });

  it('resolves environments via from: against examples/environments/', async () => {
    const operation = await parseOperation(
      join(EXAMPLES_DIR, 'deployment-with-env-ref.yaml'),
    );

    const staging = operation.environments.find((e) => e.name === 'staging');
    assert.ok(staging, 'staging environment should be resolved');
    // Inherited from the manifest
    assert.strictEqual(staging.variables.NAMESPACE, 'staging');
    // Local override from the operation file
    assert.strictEqual(staging.variables.IMAGE_TAG, 'staging-latest');

    const production = operation.environments.find(
      (e) => e.name === 'production',
    );
    assert.ok(production, 'production environment should be resolved');
    assert.strictEqual(production.variables.NAMESPACE, 'prod');
    assert.strictEqual(production.approval_required, true);
  });
});
