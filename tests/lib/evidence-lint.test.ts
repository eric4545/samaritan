import assert from 'node:assert';
import { describe, it } from 'node:test';
import { lintEvidenceResults } from '../../src/lib/evidence-lint';
import type { Operation } from '../../src/models/operation';

function operation(steps: unknown[], rollback?: unknown): Operation {
  return {
    name: 'Deploy web-server',
    environments: [{ name: 'staging' }, { name: 'production' }],
    steps,
    rollback,
  } as unknown as Operation;
}

const present = (p: string): boolean => p === '/ops/evidence/dashboard.png';

describe('lintEvidenceResults', () => {
  it('is quiet for results that render as written', () => {
    const op = operation([
      {
        name: 'Check dashboard',
        evidence: {
          results: {
            staging: [
              { type: 'screenshot', file: './evidence/dashboard.png' },
              { type: 'link', content: 'https://ci.example.com/job/42' },
              { type: 'command_output', content: 'ok' },
            ],
          },
        },
      },
    ]);
    assert.deepStrictEqual(lintEvidenceResults(op, '/ops', present), []);
  });

  it('flags a results key that is not an environment', () => {
    const op = operation([
      {
        name: 'Check dashboard',
        evidence: { results: { prod: [{ type: 'log', content: 'x' }] } },
      },
    ]);
    const [warning, ...rest] = lintEvidenceResults(op, '/ops', present);
    assert.match(warning, /evidence\.results\.prod is never rendered/);
    assert.match(warning, /environments: staging, production/);
    assert.strictEqual(rest.length, 0);
  });

  it('flags a missing file, a non-URL link and an image given as text', () => {
    const op = operation([
      {
        name: 'Check dashboard',
        evidence: {
          results: {
            staging: [
              { type: 'screenshot', file: './evidence/gone.png' },
              { type: 'link', content: 'the build page' },
              { type: 'screenshot', content: 'https://example.com/shot' },
            ],
          },
        },
      },
    ]);
    const warnings = lintEvidenceResults(op, '/ops', present);
    assert.strictEqual(warnings.length, 3);
    assert.match(warnings[0], /file not found: \.\/evidence\/gone\.png/);
    assert.match(warnings[1], /not an http\(s\) URL/);
    assert.match(warnings[2], /renders as a text block, not as an image/);
  });

  it('walks sub-steps, step rollbacks and the operation rollback', () => {
    const bad = { results: { qa: [{ type: 'log', content: 'x' }] } };
    const op = operation(
      [
        {
          name: 'Parent',
          sub_steps: [{ name: 'Child', evidence: bad }],
          rollback: [{ name: 'Undo parent', evidence: bad }],
        },
      ],
      { steps: [{ name: 'Global undo', evidence: bad }] },
    );
    const warnings = lintEvidenceResults(op, '/ops', present).join('\n');
    for (const name of ['Child', 'Undo parent', 'Global undo']) {
      assert.ok(warnings.includes(`Step "${name}"`), name);
    }
  });
});
