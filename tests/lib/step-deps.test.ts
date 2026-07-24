import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  buildStepDepGraph,
  dependentsOf,
  sortStepsByDependencies,
  unmetNeeds,
  validateStepDeps,
} from '../../src/lib/step-deps';
import type { Step } from '../../src/models/operation';

function step(partial: Partial<Step> & { name: string }): Step {
  return { type: 'manual', ...partial } as Step;
}

describe('buildStepDepGraph', () => {
  it('resolves needs by id and by name', () => {
    const steps = [
      step({ name: 'Build', id: 'build' }),
      step({ name: 'Push', needs: ['build'] }),
      step({ name: 'Deploy', needs: ['Push'] }),
    ];
    const g = buildStepDepGraph(steps);
    assert.deepStrictEqual(g.needsByIndex, [[], [0], [1]]);
    assert.deepStrictEqual(g.dependentsByIndex, [[1], [2], []]);
    assert.deepStrictEqual(g.unknownRefs, []);
  });

  it('collects unknown refs without throwing', () => {
    const steps = [step({ name: 'A', needs: ['ghost'] })];
    const g = buildStepDepGraph(steps);
    assert.deepStrictEqual(g.unknownRefs, [{ stepIndex: 0, ref: 'ghost' }]);
  });

  it('a foreach-source ref depends on all expanded instances', () => {
    const steps = [
      step({ name: 'Deploy (us)', foreachSource: { name: 'Deploy' } }),
      step({ name: 'Deploy (eu)', foreachSource: { name: 'Deploy' } }),
      step({ name: 'Verify', needs: ['Deploy'] }),
    ];
    const g = buildStepDepGraph(steps);
    assert.deepStrictEqual(g.needsByIndex[2], [0, 1]);
  });
});

describe('validateStepDeps', () => {
  it('flags unknown refs as unknown-ref', () => {
    const issues = validateStepDeps([step({ name: 'A', needs: ['ghost'] })]);
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].kind, 'unknown-ref');
  });

  it('flags self references', () => {
    const issues = validateStepDeps([
      step({ name: 'A', id: 'a', needs: ['a'] }),
    ]);
    assert.ok(issues.some((i) => i.kind === 'self-ref'));
  });

  it('flags forward references', () => {
    const issues = validateStepDeps([
      step({ name: 'First', needs: ['Second'] }),
      step({ name: 'Second' }),
    ]);
    assert.ok(issues.some((i) => i.kind === 'forward-ref'));
  });

  it('detects a two-node cycle', () => {
    const issues = validateStepDeps([
      step({ name: 'A', id: 'a', needs: ['b'] }),
      step({ name: 'B', id: 'b', needs: ['a'] }),
    ]);
    assert.ok(issues.some((i) => i.kind === 'cycle'));
  });

  it('detects a longer cycle', () => {
    const issues = validateStepDeps([
      step({ name: 'A', id: 'a', needs: ['c'] }),
      step({ name: 'B', id: 'b', needs: ['a'] }),
      step({ name: 'C', id: 'c', needs: ['b'] }),
    ]);
    assert.ok(issues.some((i) => i.kind === 'cycle'));
  });

  it('flags sub-step needs as ignored', () => {
    const issues = validateStepDeps([
      step({
        name: 'Parent',
        sub_steps: [step({ name: 'Child', needs: ['x'] })],
      }),
    ]);
    assert.ok(issues.some((i) => i.kind === 'sub-step-needs'));
  });

  it('flags ambiguous refs (duplicate-named unrelated steps)', () => {
    const issues = validateStepDeps([
      step({ name: 'Deploy' }),
      step({ name: 'Deploy' }),
      step({ name: 'Verify', needs: ['Deploy'] }),
    ]);
    assert.ok(issues.some((i) => i.kind === 'ambiguous-ref'));
  });

  it('does not flag a foreach fan-out as ambiguous', () => {
    const issues = validateStepDeps([
      step({ name: 'Deploy (us)', foreachSource: { name: 'Deploy' } }),
      step({ name: 'Deploy (eu)', foreachSource: { name: 'Deploy' } }),
      step({ name: 'Verify', needs: ['Deploy'] }),
    ]);
    assert.ok(!issues.some((i) => i.kind === 'ambiguous-ref'));
  });

  it('is clean for a valid backward chain', () => {
    const issues = validateStepDeps([
      step({ name: 'Build', id: 'build' }),
      step({ name: 'Deploy', needs: ['build'] }),
    ]);
    assert.deepStrictEqual(issues, []);
  });
});

describe('sortStepsByDependencies', () => {
  it('keeps document order when there are no needs', () => {
    const steps = [
      step({ name: 'A' }),
      step({ name: 'B' }),
      step({ name: 'C' }),
    ];
    assert.deepStrictEqual(
      sortStepsByDependencies(steps).map((s) => s.name),
      ['A', 'B', 'C'],
    );
  });

  it('is cycle-safe (appends cyclic remainder in doc order, no throw)', () => {
    const steps = [
      step({ name: 'A', id: 'a', needs: ['b'] }),
      step({ name: 'B', id: 'b', needs: ['a'] }),
    ];
    const sorted = sortStepsByDependencies(steps);
    assert.deepStrictEqual(sorted.map((s) => s.name).sort(), ['A', 'B']);
  });
});

describe('dependentsOf', () => {
  it('returns the transitive dependents in ascending order', () => {
    const steps = [
      step({ name: 'A', id: 'a' }),
      step({ name: 'B', id: 'b', needs: ['a'] }),
      step({ name: 'C', id: 'c', needs: ['b'] }),
      step({ name: 'D', needs: ['a'] }),
    ];
    const g = buildStepDepGraph(steps);
    assert.deepStrictEqual(dependentsOf(g, 0), [1, 2, 3]);
    assert.deepStrictEqual(dependentsOf(g, 1), [2]);
    assert.deepStrictEqual(dependentsOf(g, 2), []);
  });
});

describe('unmetNeeds', () => {
  it('returns direct needs failing the predicate', () => {
    const steps = [
      step({ name: 'A', id: 'a' }),
      step({ name: 'B', id: 'b' }),
      step({ name: 'C', needs: ['a', 'b'] }),
    ];
    const g = buildStepDepGraph(steps);
    // only step 0 is satisfied → step 1 is unmet for C
    assert.deepStrictEqual(
      unmetNeeds(g, 2, (i) => i === 0),
      [1],
    );
    assert.deepStrictEqual(
      unmetNeeds(g, 2, () => true),
      [],
    );
  });
});
