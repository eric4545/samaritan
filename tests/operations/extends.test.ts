import assert from 'node:assert';
import { describe, it } from 'node:test';
import { parseOperation } from '../../src/operations/parser';

const FIXTURE_DIR = 'tests/fixtures/operations/features/extends';

describe('Operation-level extends', () => {
  describe('step append order', () => {
    it('appends base steps before child steps (single base)', async () => {
      const op = await parseOperation(`${FIXTURE_DIR}/child-simple.yaml`);

      assert.strictEqual(op.steps.length, 5, 'base (3) + child (2) steps');
      assert.deepStrictEqual(
        op.steps.map((s) => s.name),
        [
          'Base Preflight Check',
          'Base Deploy Script',
          'Base Deploy Verification',
          'Child Deploy Script',
          'Child Smoke Test',
        ],
      );
    });

    it('appends multiple bases left-to-right before the child (array extends)', async () => {
      const op = await parseOperation(`${FIXTURE_DIR}/child-array.yaml`);

      assert.deepStrictEqual(
        op.steps.map((s) => s.name),
        ['Base A Step', 'Base B Step', 'Child Array Step'],
      );
    });

    it('merges a 3-level extends chain in order (base -> child -> grandchild)', async () => {
      const op = await parseOperation(`${FIXTURE_DIR}/chain-grandchild.yaml`);

      assert.deepStrictEqual(
        op.steps.map((s) => s.name),
        [
          'Base Preflight Check',
          'Base Deploy Script',
          'Base Deploy Verification',
          'Child Deploy Script',
          'Child Smoke Test',
          'Grandchild Final Step',
        ],
      );
    });
  });

  describe('scalar and tags precedence', () => {
    it('child scalar wins over base scalar', async () => {
      const op = await parseOperation(`${FIXTURE_DIR}/child-simple.yaml`);
      assert.strictEqual(
        op.description,
        'Child deployment operation extending the base deployment',
      );
      assert.deepStrictEqual(op.tags, ['child', 'deployment']);
    });

    it('later base wins over earlier base when the child does not override', async () => {
      const op = await parseOperation(`${FIXTURE_DIR}/child-array.yaml`);
      // category isn't set by the child, so base-b (later layer) wins over base-a
      assert.strictEqual(op.category, 'base-b-category');
      // description IS set by the child, so it wins over both bases
      assert.strictEqual(
        op.description,
        'Child extending two bases; later base wins on overlapping scalars',
      );
    });
  });

  describe('variables and common_variables spread-merge', () => {
    it('spreads common_variables from base into child, later base wins per key', async () => {
      const op = await parseOperation(`${FIXTURE_DIR}/child-array.yaml`);
      assert.strictEqual(op.common_variables?.A_VAR, 'from-a');
      assert.strictEqual(op.common_variables?.B_VAR, 'from-b');
      assert.strictEqual(op.common_variables?.SHARED_VAR, 'from-b');
    });

    it('spreads base common_variables and child variables together', async () => {
      const op = await parseOperation(`${FIXTURE_DIR}/child-simple.yaml`);
      assert.strictEqual(op.common_variables?.REGION, 'us-east-1');
      assert.strictEqual(op.common_variables?.SERVICE, 'base-web');
      assert.strictEqual(op.common_variables?.EXTRA_FLAG, 'enabled');
    });
  });

  describe('environments merge', () => {
    it('concatenates distinct-named environments from multiple bases', async () => {
      const op = await parseOperation(`${FIXTURE_DIR}/child-array.yaml`);
      assert.strictEqual(op.environments.length, 2);
      assert.deepStrictEqual(op.environments.map((e) => e.name).sort(), [
        'production',
        'staging',
      ]);
    });

    it('inherits base environments unchanged when the child declares none', async () => {
      const op = await parseOperation(`${FIXTURE_DIR}/child-simple.yaml`);
      assert.strictEqual(op.environments.length, 2);
      const staging = op.environments.find((e) => e.name === 'staging');
      assert.ok(staging);
      assert.strictEqual(staging?.variables.NAMESPACE, 'staging');
    });

    it('rebases a base file environments[].uses path so it resolves from the base directory', async () => {
      const op = await parseOperation(
        `${FIXTURE_DIR}/child-with-env-uses-base.yaml`,
      );
      const canary = op.environments.find((e) => e.name === 'canary');
      assert.ok(
        canary,
        'canary environment imported via base environments[].uses',
      );
      assert.strictEqual(canary?.variables.NAMESPACE, 'canary');
    });
  });

  describe('rollback merge', () => {
    it('inherits the base rollback plan when the child declares none', async () => {
      const op = await parseOperation(`${FIXTURE_DIR}/child-simple.yaml`);
      assert.ok(op.rollback);
      assert.strictEqual(op.rollback?.steps.length, 1);
      assert.strictEqual(op.rollback?.steps[0].name, 'Base Rollback');
      assert.strictEqual(op.rollback?.steps[0].sub_steps?.length, 1);
    });
  });

  describe('rebasing step-level uses: from a base file', () => {
    it('expands a base step-level uses: block relative to the base directory', async () => {
      const op = await parseOperation(
        `${FIXTURE_DIR}/child-with-uses-base.yaml`,
      );
      const names = op.steps.map((s) => s.name);
      assert.ok(
        names.includes('Base Health Check'),
        'base uses: block expanded using a path rebased to the base directory',
      );
      assert.ok(names.includes('Child Step After Reused Block'));
    });
  });

  describe('circular extends detection', () => {
    it('throws with a clear "Circular extends" message and chain', async () => {
      await assert.rejects(
        async () => parseOperation(`${FIXTURE_DIR}/cycle-a.yaml`),
        (err: any) => {
          return (
            /Circular extends/.test(err.message) &&
            Array.isArray(err.errors) &&
            err.errors.some((e: any) => /Circular extends/.test(e.message))
          );
        },
      );
    });
  });

  describe('extends field validation', () => {
    it('accepts a single string base', async () => {
      const op = await parseOperation(`${FIXTURE_DIR}/child-simple.yaml`);
      assert.ok(op.steps.length > 0);
    });

    it('accepts an array of string bases', async () => {
      const op = await parseOperation(`${FIXTURE_DIR}/child-array.yaml`);
      assert.ok(op.steps.length > 0);
    });

    it('rejects a non-string/array extends value', async () => {
      await assert.rejects(
        async () => parseOperation(`${FIXTURE_DIR}/invalid-extends-type.yaml`),
        (err: any) =>
          Array.isArray(err.errors) &&
          err.errors.some((e: any) => e.field === 'extends'),
      );
    });

    it('throws a clear error when the base file is missing', async () => {
      await assert.rejects(
        async () => parseOperation(`${FIXTURE_DIR}/missing-base.yaml`),
        (err: any) =>
          Array.isArray(err.errors) &&
          err.errors.some((e: any) =>
            /does-not-exist\.yaml|Failed to read file/.test(e.message),
          ),
      );
    });
  });
});
