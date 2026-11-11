import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  hasUnresolvedVars,
  resolveVariableChains,
  resolveVars,
  resolveVarsSafe,
} from '../../src/lib/variable-resolver';

describe('resolveVars', () => {
  it('replaces ${VAR} from context', () => {
    assert.strictEqual(
      resolveVars('kubectl scale --replicas=${REPLICAS}', { REPLICAS: '3' }),
      'kubectl scale --replicas=3',
    );
  });

  it('resolves multiple vars in one string', () => {
    assert.strictEqual(
      resolveVars('ssh ${PREFIX}$USER@access.${ENV}.example.com', {
        PREFIX: 'admin-',
        ENV: 'dev',
      }),
      'ssh admin-$USER@access.dev.example.com',
    );
  });

  it('leaves $VAR (no braces) untouched for shell vars', () => {
    const result = resolveVars('echo $HOME and ${OP_VAR}', { OP_VAR: 'hello' });
    assert.ok(result.includes('$HOME'), 'Shell $HOME must stay untouched');
    assert.ok(result.includes('hello'), '${OP_VAR} must be resolved');
  });

  it('throws with a clear error listing unresolved ${VAR}', () => {
    assert.throws(
      () =>
        resolveVars('deploy to ${ENV} with key ${MISSING}', { ENV: 'prod' }),
      (err: Error) => {
        assert.ok(
          err.message.includes('MISSING'),
          'Error must name the missing var',
        );
        return true;
      },
    );
  });

  it('throws listing ALL unresolved vars', () => {
    assert.throws(
      () => resolveVars('${A} and ${B}', {}),
      (err: Error) => {
        assert.ok(err.message.includes('A'), 'Must list A');
        assert.ok(err.message.includes('B'), 'Must list B');
        return true;
      },
    );
  });

  it('returns unchanged string when no ${VAR} patterns present', () => {
    const input = 'kubectl get pods -n staging';
    assert.strictEqual(resolveVars(input, {}), input);
  });

  it('leaves shell parameter expansions (${X:?}, ${X:-…}) untouched without throwing', () => {
    const result = resolveVars(
      'kubectl delete "${POD:?no pod}" --region ${REGION:-us-east-1} in ${ENV}',
      { ENV: 'prod' },
    );
    assert.ok(result.includes('${POD:?no pod}'), '${POD:?} is a shell guard');
    assert.ok(result.includes('${REGION:-us-east-1}'), '${REGION:-} is shell');
    assert.ok(result.includes('in prod'), '${ENV} must still resolve');
  });
});

describe('resolveVarsSafe', () => {
  it('resolves known vars, leaves unknown as-is without throwing', () => {
    const result = resolveVarsSafe('${KNOWN} and ${UNKNOWN}', { KNOWN: 'yes' });
    assert.ok(result.includes('yes'), 'Known var must be resolved');
    assert.ok(result.includes('${UNKNOWN}'), 'Unknown var must stay as-is');
  });
});

describe('hasUnresolvedVars', () => {
  it('returns true when ${VAR} present and not in context', () => {
    assert.strictEqual(hasUnresolvedVars('${MISSING}', {}), true);
  });

  it('returns false when all ${VAR} resolved', () => {
    assert.strictEqual(hasUnresolvedVars('${ENV}', { ENV: 'prod' }), false);
  });

  it('returns false for plain strings with no vars', () => {
    assert.strictEqual(hasUnresolvedVars('kubectl get pods', {}), false);
  });

  it('returns false for shell parameter expansions like ${X:?}', () => {
    assert.strictEqual(hasUnresolvedVars('echo "${X:?unset}"', {}), false);
  });
});

describe('resolveVariableChains', () => {
  it('follows a value that references another variable', () => {
    const vars = resolveVariableChains({
      CACHE_ID: '${CACHE_ID_WEB}',
      CACHE_ID_WEB: 'cache-0001',
    });
    assert.strictEqual(vars.CACHE_ID, 'cache-0001');
  });

  it('does not depend on declaration order (reference declared first or last)', () => {
    const forward = resolveVariableChains({
      APP: 'web-server',
      FULL_NAME: '${APP}-staging',
    });
    const backward = resolveVariableChains({
      FULL_NAME: '${APP}-staging',
      APP: 'web-server',
    });
    assert.strictEqual(forward.FULL_NAME, 'web-server-staging');
    assert.strictEqual(backward.FULL_NAME, 'web-server-staging');
  });

  it('follows chains of any depth and embedded references', () => {
    const vars = resolveVariableChains({
      A: 'host-${B}.example.com',
      B: '${C}',
      C: '${D}-1',
      D: 'staging',
    });
    assert.strictEqual(vars.A, 'host-staging-1.example.com');
  });

  it('leaves unknown names literal for the shell', () => {
    const vars = resolveVariableChains({
      LOG_DIR: '${HOME}/logs/${APP}',
      APP: 'web-server',
    });
    assert.strictEqual(vars.LOG_DIR, '${HOME}/logs/web-server');
  });

  it('leaves cycles and self-references literal instead of looping', () => {
    const vars = resolveVariableChains({
      A: '${B}',
      B: '${A}',
      SELF: 'x-${SELF}',
    });
    // The walk stops where a reference would repeat; the value keeps a
    // literal placeholder rather than looping or throwing.
    assert.match(vars.A, /^\$\{[AB]\}$/);
    assert.match(vars.B, /^\$\{[AB]\}$/);
    assert.strictEqual(vars.SELF, 'x-${SELF}');
  });

  it('keeps non-string values and stringifies them when referenced', () => {
    const vars = resolveVariableChains({
      REPLICAS: 4,
      FLAG: '--replicas=${REPLICAS}',
    });
    assert.strictEqual(vars.REPLICAS, 4);
    assert.strictEqual(vars.FLAG, '--replicas=4');
  });

  it('leaves shell parameter expansions alone', () => {
    const vars = resolveVariableChains({
      APP: 'web-server',
      GUARD: '${APP:?unset} ${APP}',
    });
    assert.strictEqual(vars.GUARD, '${APP:?unset} web-server');
  });

  it('returns the same object when no value references a variable', () => {
    const input = { APP: 'web-server', HOME_DIR: '${HOME}' };
    assert.strictEqual(resolveVariableChains(input), input);
  });

  it('resolveVars and resolveVarsSafe resolve chains', () => {
    const vars = { CACHE_ID: '${CACHE_ID_WEB}', CACHE_ID_WEB: 'c-1' };
    assert.strictEqual(resolveVars('id=${CACHE_ID}', vars), 'id=c-1');
    assert.strictEqual(resolveVarsSafe('id=${CACHE_ID}', vars), 'id=c-1');
  });
});
