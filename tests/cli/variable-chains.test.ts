import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { parseOperation } from '../../src/operations/parser';
import { getFixturePath } from '../fixtures/fixtures';

// A variable whose value references another variable must resolve to the
// same text in every consumer: parse, validate, every manual format (single
// env and multi-env) and the run. A run once pasted a literal `${OTHER}`
// that the manual had resolved.

const CLI = 'node_modules/.bin/tsx';
const INDEX = 'src/cli/index.ts';
const fixture = getFixturePath('variableChains');
const PLACEHOLDER = /\$\{\w+\}/;
const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

function runCli(
  args: string[],
  input?: string,
): { out: string; status: number | null } {
  const result = spawnSync(CLI, [INDEX, ...args], {
    encoding: 'utf8',
    input,
    timeout: 30_000,
  });
  return {
    out: (result.stdout ?? '') + (result.stderr ?? ''),
    status: result.status,
  };
}

describe('variable chains: every consumer resolves them', () => {
  const tmpDirs: string[] = [];
  const makeDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'samaritan-chains-'));
    tmpDirs.push(dir);
    return dir;
  };
  after(() => {
    for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
  });

  describe('parse', () => {
    it('follows chains inside a uses: template and its with: values', async () => {
      const op = await parseOperation(fixture, { group: 'web' });
      const probe = op.steps.find((s) => s.name.startsWith('Probe'));
      assert.ok(probe, 'the uses: step is expanded');
      // PROBE_PORT -> PROBE_PORT_BASE (template defaults), PROBE_ALIAS ->
      // PROBE_NICK (with: -> with:) resolve at parse time; the outer
      // NAMESPACE / APP_HOST references stay for the selected environment.
      assert.equal(
        probe.instruction,
        'Probe ${APP_HOST} on port 8081 as probe-${NAMESPACE}',
      );
      assert.equal(probe.command, 'curl -s https://${APP_HOST}:8081/health');
    });

    it('bakes a foreach value that chains through common variables', async () => {
      const op = await parseOperation(fixture, { group: 'web' });
      const zone = op.steps.find((s) => s.name.startsWith('Check zone'));
      assert.equal(zone?.name, 'Check zone (zone-a)');
      assert.equal(zone?.command, 'echo zone zone-a on ${APP_HOST}');
    });
  });

  describe('validate', () => {
    it('passes with no variable warnings (step variables count as defined)', () => {
      const result = runCli(['validate', fixture]);
      assert.equal(result.status, 0, result.out);
      assert.ok(
        !/Variable '\w+'/.test(result.out),
        `no variable warnings expected:\n${result.out}`,
      );
    });

    it('warns when a chained value references an undefined variable', () => {
      const dir = makeDir();
      const typo = join(dir, 'typo.yaml');
      writeFileSync(
        typo,
        readFileSync(fixture, 'utf-8')
          .replace(
            'host.${NAMESPACE}.example.com',
            'host.${NAMESPCE}.example.com',
          )
          .replace(
            '../../templates/',
            join(process.cwd(), 'tests/fixtures/templates/'),
          ),
      );
      const result = runCli(['validate', typo]);
      assert.match(
        result.out,
        /Variable 'APP_HOST' references '\$\{NAMESPCE\}', which is not defined in environment 'staging'/,
      );
    });
  });

  describe('generate manual --env --resolve-vars', () => {
    const expected = [
      'Deploy web-server-staging',
      'echo deploying web-server-staging/stable to host.staging.example.com',
      'deployed web-server-staging/stable',
      'echo undo host.staging.example.com',
      'Check zone (zone-a)',
      'echo zone zone-a on host.staging.example.com',
      'Probe host.staging.example.com on port 8081 as probe-staging',
      'curl -s https://host.staging.example.com:8081/health',
      'Global undo web-server-staging',
    ];
    for (const format of ['markdown', 'confluence', 'adf', 'html'] as const) {
      it(`${format}: no placeholder is left`, () => {
        const output = join(makeDir(), `manual.${format}`);
        const result = runCli([
          'generate',
          'manual',
          fixture,
          '--group',
          'web',
          '--env',
          'staging',
          '--resolve-vars',
          '-f',
          format,
          '-o',
          output,
        ]);
        assert.equal(result.status, 0, result.out);
        const manual = readFileSync(output, 'utf-8');
        const leftover = manual.match(PLACEHOLDER);
        assert.equal(
          leftover,
          null,
          `unresolved ${leftover?.[0]} in ${format}`,
        );
        for (const text of expected) {
          assert.ok(manual.includes(text), `${format} must include "${text}"`);
        }
      });
    }
  });

  describe('generate manual (multi-env) --resolve-vars', () => {
    it('resolves each environment column and the environments overview', () => {
      const output = join(makeDir(), 'manual.md');
      const result = runCli([
        'generate',
        'manual',
        fixture,
        '--group',
        'web',
        '--resolve-vars',
        '-o',
        output,
      ]);
      assert.equal(result.status, 0, result.out);
      const manual = readFileSync(output, 'utf-8');
      for (const env of ['staging', 'production']) {
        assert.ok(
          manual.includes(
            `curl -s https://host.${env}.example.com:8081/health`,
          ),
        );
        assert.ok(manual.includes(`APP_HOST: "host.${env}.example.com"`));
      }
      // The name cell is shared by both environment columns, so a value
      // that differs per environment stays a placeholder there (by design).
      assert.ok(manual.includes('Step 1: Deploy ${RELEASE}'));
    });
  });

  describe('run', () => {
    const steps: Array<[number, string[]]> = [
      [
        1,
        [
          'MANUAL: Deploy web-server-staging',
          'Deploy to https://staging.example.com',
          'Target host.staging.example.com',
          'echo deploying web-server-staging/stable to host.staging.example.com',
          'contains: deployed web-server-staging/stable',
        ],
      ],
      [
        2,
        [
          'MANUAL: Check zone (zone-a)',
          'echo zone zone-a on host.staging.example.com',
        ],
      ],
      [
        3,
        [
          'MANUAL: Probe host.staging.example.com',
          'Probe host.staging.example.com on port 8081 as probe-staging',
          'curl -s https://host.staging.example.com:8081/health',
          'contains: healthy probe-staging',
        ],
      ],
    ];
    for (const [step, texts] of steps) {
      it(`step ${step} shows the same resolved text as the manual`, () => {
        const result = runCli(
          [
            'run',
            fixture,
            '--group',
            'web',
            '--env',
            'staging',
            '--mode',
            'manual',
            '--from-step',
            String(step),
          ],
          'q\n',
        );
        const screen = result.out.replace(ANSI_RE, '');
        const shown = screen.slice(screen.indexOf(`[Step ${step} `));
        for (const text of texts) {
          assert.ok(shown.includes(text), `run must show "${text}":\n${shown}`);
        }
        const stepBlock = shown.slice(0, shown.indexOf('Execution aborted'));
        assert.equal(stepBlock.match(PLACEHOLDER), null, stepBlock);
      });
    }
  });
});
