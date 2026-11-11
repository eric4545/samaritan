import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SessionState } from '../../src/lib/session-state';
import {
  substituteExpectVars,
  substituteVariables,
} from '../../src/lib/step-resolution';
import { interpolateExpect } from '../../src/lib/tui';
import { resolveVars } from '../../src/lib/variable-resolver';

// Three engines substitute `${VAR}`: the manuals (`substituteVariables`), the
// run TUI display and `[p]` paste (`resolveVars`) and the run's verify /
// automatic send (`SessionState.interpolate`). A run once pasted a literal
// `${OTHER}` that the manual had resolved, because the engines disagreed on
// a value that references another variable. They must produce identical
// text for identical inputs.

interface Case {
  name: string;
  vars: Record<string, string>;
  template: string;
  expected: string;
}

const CASES: Case[] = [
  {
    name: 'group variable chains to an environment variable',
    vars: {
      CACHE_ID: '${CACHE_ID_WEB}',
      TARGET_REGION: '${DEFAULT_REGION}',
      CACHE_ID_WEB: 'cache-0001',
      DEFAULT_REGION: 'us-east-1',
    },
    template: 'describe --id ${CACHE_ID} --region ${TARGET_REGION}',
    expected: 'describe --id cache-0001 --region us-east-1',
  },
  {
    name: 'environment variable chains to a group variable (declared earlier)',
    vars: { APP: 'web-server', FULL_NAME: '${APP}-staging' },
    template: 'echo ${FULL_NAME}',
    expected: 'echo web-server-staging',
  },
  {
    name: 'embedded reference, three hops',
    vars: {
      PROBE_HOST: 'probe.${ENV_ALIAS}.example.com',
      ENV_ALIAS: '${ENV_CODE}',
      ENV_CODE: 'stg',
    },
    template: 'ssh ${PROBE_HOST} uptime',
    expected: 'ssh probe.stg.example.com uptime',
  },
  {
    name: 'unknown name inside a value is left for the shell',
    vars: { LOG_DIR: '${HOME}/logs', APP: 'api-gateway' },
    template: 'ls ${LOG_DIR}/${APP}',
    expected: 'ls ${HOME}/logs/api-gateway',
  },
  {
    name: 'cycle stays literal',
    vars: { A: '${B}', B: '${A}' },
    template: '[${A}]',
    expected: '[${A}]',
  },
];

function interpolate(vars: Record<string, string>, template: string): string {
  const state = new SessionState();
  for (const [key, value] of Object.entries(vars)) state.capture(key, value);
  return state.interpolate(template);
}

describe('variable substitution parity: manuals vs run', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const manual = substituteVariables(c.template, c.vars);
      assert.equal(manual, c.expected, 'substituteVariables (manuals)');
      assert.equal(
        resolveVars(c.template, c.vars),
        manual,
        'resolveVars (run display / [p] paste)',
      );
      assert.equal(
        interpolate(c.vars, c.template),
        manual,
        'SessionState.interpolate (run [v] verify / send)',
      );
    });
  }

  it('step.variables chain the same way in every engine', () => {
    const env = { CACHE_ID_WEB: 'cache-0001' };
    const step = { TARGET: '${CACHE_ID_WEB}', LABEL: 'node ${TARGET}' };
    assert.equal(substituteVariables('${LABEL}', env, step), 'node cache-0001');
  });

  it('expect values chain the same in the manual and in [v] verify', () => {
    const vars = { CACHE_ID: '${CACHE_ID_WEB}', CACHE_ID_WEB: 'c-1' };
    const expect = { contains: 'id=${CACHE_ID}' };
    const state = new SessionState();
    for (const [key, value] of Object.entries(vars)) state.capture(key, value);
    assert.deepEqual(interpolateExpect(expect, state), { contains: 'id=c-1' });
    assert.deepEqual(substituteExpectVars(expect, vars), {
      contains: 'id=c-1',
    });
  });
});
