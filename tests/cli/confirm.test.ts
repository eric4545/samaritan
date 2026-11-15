import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { summarizeDescription } from '../../src/cli/commands/run';
import {
  confirmLine,
  confirmManualText,
  normalizeConfirm,
} from '../../src/lib/confirm';
import { currentOperator } from '../../src/lib/operator';
import { renderReport } from '../../src/lib/report-generator';
import { foldEvents, type SessionEvent } from '../../src/lib/session-log';

const CLI = join(process.cwd(), 'node_modules/.bin/tsx');
const INDEX = join(process.cwd(), 'src/cli/index.ts');

const OPERATION = `name: Confirm Gate
version: 1.0.0
description: confirm gate fixture
variables:
  APP: web-server
environments:
  - name: staging
    description: Staging
    variables:
      BOARD: https://example.com/board-staging
  - name: production
    description: Production
    variables:
      BOARD: https://example.com/board
steps:
  - name: Check the dashboard
    type: manual
    instruction: Open \${BOARD}
    confirm:
      prompt: Error rate below 1% for \${APP}?
      result: required
  - name: Announce
    type: manual
    instruction: Post the note
    confirm: Note posted?
    rollback:
      - name: Announce the rollback
        instruction: Post the rollback notice
        confirm: Rollback notice posted?
  - name: Close out
    type: manual
    instruction: Close the change
`;

function ev(partial: Partial<SessionEvent> & { type: string }): SessionEvent {
  return {
    ts: '2026-01-01T00:00:00.000Z',
    session_id: 's1',
    ...partial,
  } as SessionEvent;
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** One answer per prompt, a second apart (readline drops batched lines). */
function runSequenced(args: string[], inputs: string[]): string {
  const piped = inputs
    .map((line) => `printf ${shQuote(`${line}\\n`)}`)
    .join('; sleep 1; ');
  const cmd = `(sleep 1; ${piped}; sleep 1) | timeout 40 ${shQuote(CLI)} ${shQuote(INDEX)} ${args.map(shQuote).join(' ')}`;
  const result = spawnSync('bash', ['-c', cmd], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  return (result.stdout ?? '') + (result.stderr ?? '');
}

function cli(args: string[]): string {
  const result = spawnSync(CLI, [INDEX, ...args], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  return (result.stdout ?? '') + (result.stderr ?? '');
}

describe('confirm: lib', () => {
  it('normalises the string and object forms', () => {
    assert.deepStrictEqual(normalizeConfirm('Posted?'), {
      prompt: 'Posted?',
      result: 'optional',
    });
    assert.deepStrictEqual(
      normalizeConfirm({ prompt: ' Healthy? ', result: 'required' }),
      { prompt: 'Healthy?', result: 'required' },
    );
    assert.strictEqual(normalizeConfirm(undefined), undefined);
    assert.strictEqual(normalizeConfirm('   '), undefined);
  });

  it('resolves variables in the prompt and renders the manual line', () => {
    const confirm = normalizeConfirm('Up for ${APP}?', (text) =>
      text.replace('${APP}', 'web-server'),
    );
    assert.strictEqual(confirm?.prompt, 'Up for web-server?');
    assert.strictEqual(
      confirmManualText({ prompt: 'Healthy?', result: 'required' }),
      'Confirm: Healthy? (record the result)',
    );
    assert.strictEqual(
      confirmLine('Posted?'),
      'Confirm: Posted? (result optional)',
    );
    assert.strictEqual(confirmLine(undefined), undefined);
  });
});

describe('operator fallback', () => {
  it('prefers $USER, then $LOGNAME, then the OS account', () => {
    assert.strictEqual(currentOperator({ USER: 'alice' }), 'alice');
    assert.strictEqual(currentOperator({ LOGNAME: 'bob' }), 'bob');
    assert.strictEqual(
      currentOperator({}, () => 'carol'),
      'carol',
    );
    assert.strictEqual(
      currentOperator({}, () => {
        throw new Error('no passwd entry');
      }),
      'unknown',
    );
  });
});

describe('run banner description', () => {
  it('keeps the first paragraph and marks that more follows', () => {
    assert.strictEqual(
      summarizeDescription(
        'Deploy the\nweb server.\n\nRun with:\n  --env staging\n',
      ),
      'Deploy the web server. […]',
    );
    assert.strictEqual(summarizeDescription('One line'), 'One line');
    assert.strictEqual(summarizeDescription(undefined), '');
  });
});

describe('confirm: validate, manuals, run', () => {
  let dir: string;
  let op: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'sam-confirm-'));
    op = join(dir, 'confirm-gate.yaml');
    writeFileSync(op, OPERATION);
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  const manual = (args: string[], name: string): string => {
    const out = join(dir, name);
    cli(['generate', 'manual', op, '--resolve-vars', '-o', out, ...args]);
    return readFileSync(out, 'utf8');
  };

  it('validate accepts both forms and rejects an unknown result mode', () => {
    assert.match(cli(['validate', op]), /validation passed/);
    const bad = join(dir, 'bad.yaml');
    writeFileSync(bad, OPERATION.replace('result: required', 'result: maybe'));
    const out = cli(['validate', bad]);
    assert.match(out, /validation failed/);
    assert.match(out, /confirm/);
  });

  it('multi-env Markdown shows the gate in the step cell and the rollback', () => {
    const md = manual([], 'multi.md');
    assert.match(
      md,
      /Step 1: Check the dashboard.*☑️ <em>Confirm: Error rate below 1% for web-server\? \(record the result\)<\/em>/,
    );
    assert.match(md, /☑️ <em>Confirm: Note posted\? \(result optional\)<\/em>/);
    assert.match(md, /- \[ \] ☑️ Confirm: Rollback notice posted\?/);
  });

  it('single-env Markdown shows the gate as a checkbox', () => {
    const md = manual(['--env', 'staging'], 'single.md');
    assert.match(
      md,
      /- \[ \] ☑️ Confirm: Error rate below 1% for web-server\? \(record the result\)/,
    );
    assert.match(md, /- \[ \] ☑️ Confirm: Rollback notice posted\?/);
  });

  it('Confluence and ADF show the gate', () => {
    const wiki = manual(['-f', 'confluence'], 'out.confluence');
    assert.match(wiki, /\(\?\) Confirm: Error rate below 1% for web-server\?/);
    assert.match(wiki, /\* \[ \] Confirm: Rollback notice posted\?/);
    const adf = manual(['-f', 'adf'], 'out.adf');
    assert.match(adf, /☑️ Confirm: Error rate below 1% for web-server\?/);
    assert.match(adf, /☑️ Confirm: Rollback notice posted\?/);
  });

  it('diff reports a confirm that differs between environments', () => {
    const varied = join(dir, 'varied.yaml');
    writeFileSync(varied, OPERATION.replace('for ${APP}?', 'on ${BOARD}?'));
    const out = cli(['diff', varied, 'staging', 'production']);
    assert.match(out, /board-staging\?/);
    assert.match(out, /confirm/);
  });

  it('run: n keeps the step open, y records who/what, the report says CONFIRMED', () => {
    const out = runSequenced(
      ['run', op, '--env', 'staging'],
      // step 1: ↵ → n · ↵ → y → result · step 2: r → ↵ (entry done) → y → ↵
      // (no result); a rolled-back step is left, so step 3: ↵
      ['', 'n', '', 'y', 'rate 0.3 over 5 minutes', 'r', '', 'y', '', ''],
    );
    assert.match(
      out,
      /Confirm before done: Error rate below 1% for web-server\?/,
    );
    assert.match(out, /Not confirmed — not marked done/);

    const runs = join(dir, '.samaritan-runs');
    const runDir = join(runs, readdirSync(runs)[0]);
    const events = readFileSync(join(runDir, 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const actions = events
      .filter((e) => /confirm/.test(e.action ?? ''))
      .map((e) => `${e.action}@${e.step}${e.context ? `:${e.context}` : ''}`);
    assert.deepStrictEqual(actions, [
      'confirm_declined@0',
      'confirmed_out_of_band@0',
      'confirmed@0',
      'confirmed_out_of_band@1:rollback',
      'confirmed@2',
    ]);

    const report = readFileSync(join(runDir, 'report.md'), 'utf8');
    assert.match(report, /^# Evidence Report: confirm-gate\.yaml$/m);
    assert.match(report, /- Confirmed out of band: Step 1$/m);
    assert.match(
      report,
      /\*\*Confirmation \(out of band\)\*\*: ✅ CONFIRMED by \S+ at .* UTC \(answered "no" 1× first\)\n- Asked: Error rate below 1% for web-server\?\n- Result: rate 0\.3 over 5 minutes/,
    );
    assert.match(
      report,
      / {2}- Asked: Rollback notice posted\?\n {2}- Result: _\(none recorded\)_/,
    );
    // Step 3 has no gate: a plain completion, told apart in the overview.
    assert.match(
      report,
      /\| 1 \| Check the dashboard \| ✅ completed \| ☑️ confirmed \|/,
    );
    assert.match(report, /\| 3 \| Close out \| ✅ completed \| — \|/);
    // The rolled-back step says so, in the overview and in its heading.
    assert.match(report, /\| 2 \| Announce \| ↩ rolled back \|/);
    assert.match(report, /^## Step 2: Announce ↩ \(rolled back\)$/m);
  });

  it('run: a required result cannot be left empty', () => {
    const out = runSequenced(
      ['run', op, '--env', 'staging'],
      ['', 'y', '', '', 'q'],
    );
    assert.match(out, /A result is required here/);
    assert.match(out, /needs the result you saw/);
    assert.doesNotMatch(out, /Step marked complete/);
  });
});

describe('confirm: fold + report', () => {
  const render = (events: SessionEvent[]): string =>
    renderReport(events, foldEvents(events));

  it('a gate only ever answered "no" reads NOT CONFIRMED', () => {
    const md = render([
      ev({ type: 'session_start', op: 'op.yaml', total_steps: 1 }),
      ev({ type: 'step_start', step: 0, name: 'Check' }),
      ev({
        type: 'user_input',
        action: 'confirm_declined',
        step: 0,
        actor: 'alice',
        prompt: 'Healthy?',
      }),
      ev({ type: 'step_skip', step: 0, name: 'Check' }),
      ev({ type: 'session_end', status: 'completed' }),
    ]);
    assert.match(md, /❌ NOT CONFIRMED \(answered "no" 1×\)/);
    assert.doesNotMatch(md, /Confirmed out of band:/);
    assert.match(md, /\| 1 \| Check \| ⏭ skipped \| ❌ not confirmed \|/);
  });

  it('a multi-line result is fenced under the bullet', () => {
    const md = render([
      ev({ type: 'session_start', op: 'op.yaml' }),
      ev({ type: 'step_start', step: 0, name: 'Check' }),
      ev({
        type: 'user_input',
        action: 'confirmed_out_of_band',
        step: 0,
        actor: 'alice',
        prompt: 'Healthy?',
        result: 'p50 12ms\np99 80ms',
      }),
      ev({ type: 'step_complete', step: 0 }),
    ]);
    assert.match(
      md,
      /- Result:\n\n {2}```\n {2}p50 12ms\n {2}p99 80ms\n {2}```/,
    );
  });

  it('logs written before confirm existed render without the block', () => {
    const md = render([
      ev({ type: 'session_start', op: 'op.yaml' }),
      ev({ type: 'step_start', step: 0, name: 'Old step' }),
      ev({ type: 'user_input', action: 'confirmed', step: 0, actor: 'alice' }),
      ev({ type: 'step_complete', step: 0 }),
    ]);
    assert.doesNotMatch(md, /Confirmation \(out of band\)/);
    assert.match(md, /\| 1 \| Old step \| ✅ completed \| — \| — \|/);
  });

  it('the title keeps a relative path and drops an absolute directory', () => {
    const md = render([
      ev({ type: 'session_start', op: '/srv/runbooks/deploy.yaml' }),
    ]);
    assert.match(md, /^# Evidence Report: deploy\.yaml$/m);
  });
});
