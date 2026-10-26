import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  attachHint,
  buildRelaunchCommands,
  buildSplitArgs,
  ensureWorkPane,
  findTaggedPane,
  pickCaptureStrategy,
  tmuxSessionName,
  WORK_PANE_OPTION,
  workPaneTag,
} from '../../src/lib/tmux-workspace';

describe('workPaneTag / tmuxSessionName', () => {
  it('derives a shell-safe tag from the operation name', () => {
    assert.strictEqual(workPaneTag('Deploy Web (prod)'), 'Deploy_Web__prod_');
    assert.strictEqual(workPaneTag(''), 'operation');
    assert.strictEqual(tmuxSessionName('deploy'), 'samaritan-deploy');
  });
});

describe('findTaggedPane', () => {
  it('returns the pane whose @samaritan option matches the tag', () => {
    const out = '%1\t\n%4\tother\n%7\tdeploy\n';
    assert.strictEqual(findTaggedPane(out, 'deploy'), '%7');
    assert.strictEqual(findTaggedPane(out, 'missing'), undefined);
    assert.strictEqual(findTaggedPane('', 'deploy'), undefined);
  });

  it('never returns the samaritan pane itself', () => {
    assert.strictEqual(
      findTaggedPane('%3\tdeploy\n', 'deploy', '%3'),
      undefined,
    );
  });
});

describe('buildSplitArgs', () => {
  it('splits beside the given pane without stealing focus and prints the id', () => {
    assert.deepStrictEqual(buildSplitArgs('%3', '/work'), [
      'split-window',
      '-h',
      '-d',
      '-P',
      '-F',
      '#{pane_id}',
      '-c',
      '/work',
      '-t',
      '%3',
    ]);
  });
});

describe('ensureWorkPane', () => {
  type Call = string[];
  const fakeTmux = (responses: Record<string, string>) => {
    const calls: Call[] = [];
    const run = (args: string[]) => {
      calls.push(args);
      const out = responses[args[0]];
      return out === undefined
        ? { status: 0, stdout: '' }
        : { status: 0, stdout: out };
    };
    return { calls, run };
  };

  it('reuses a tagged pane in the current window', () => {
    const { calls, run } = fakeTmux({ 'list-panes': '%3\t\n%9\tdeploy\n' });
    const pane = ensureWorkPane('deploy', { selfPane: '%3', cwd: '/w', run });
    assert.deepStrictEqual(pane, { paneId: '%9', reused: true });
    assert.ok(!calls.some((c) => c[0] === 'split-window'), 'no new split');
  });

  it('creates and tags a pane when none is tagged', () => {
    const { calls, run } = fakeTmux({
      'list-panes': '%3\t\n',
      'split-window': '%12\n',
    });
    const pane = ensureWorkPane('deploy', { selfPane: '%3', cwd: '/w', run });
    assert.deepStrictEqual(pane, { paneId: '%12', reused: false });
    assert.ok(
      calls.some(
        (c) =>
          c[0] === 'set-option' &&
          c.includes('%12') &&
          c.includes(WORK_PANE_OPTION) &&
          c.includes('deploy'),
      ),
      'new pane is tagged for reuse',
    );
  });

  it('returns undefined when tmux cannot split', () => {
    const run = (args: string[]) =>
      args[0] === 'split-window'
        ? { status: 1, stdout: '' }
        : { status: 0, stdout: '' };
    assert.strictEqual(
      ensureWorkPane('deploy', { selfPane: '%3', cwd: '/w', run }),
      undefined,
    );
  });
});

describe('buildRelaunchCommands', () => {
  const argv = ['/usr/bin/node', '/app/cli.js', 'run', 'op.yaml'];

  it('creates a new session running samaritan (attaches automatically)', () => {
    assert.deepStrictEqual(
      buildRelaunchCommands('samaritan-op', '/w', argv, false),
      [['new-session', '-s', 'samaritan-op', '-c', '/w', ...argv]],
    );
  });

  it('reuses an existing session: new window, then attach', () => {
    assert.deepStrictEqual(
      buildRelaunchCommands('samaritan-op', '/w', argv, true),
      [
        ['new-window', '-t', 'samaritan-op:', '-c', '/w', ...argv],
        ['attach-session', '-t', 'samaritan-op'],
      ],
    );
  });
});

describe('pickCaptureStrategy', () => {
  const base = {
    attach: undefined as string | undefined,
    hasSessions: false,
    mode: 'sidecar',
    inTmux: true,
    interactive: true,
    tmuxFlag: undefined as boolean | undefined,
  };

  it('honours --attach first, then sessions:', () => {
    assert.strictEqual(
      pickCaptureStrategy({ ...base, attach: 'x:0.0', hasSessions: true }),
      'attach',
    );
    assert.strictEqual(
      pickCaptureStrategy({ ...base, hasSessions: true }),
      'sessions',
    );
  });

  it('auto work pane inside tmux for an interactive sidecar run', () => {
    assert.strictEqual(pickCaptureStrategy(base), 'work-pane');
  });

  it('--no-tmux, piped stdin, or a non-sidecar mode turn it off', () => {
    assert.strictEqual(
      pickCaptureStrategy({ ...base, tmuxFlag: false }),
      'none',
    );
    assert.strictEqual(
      pickCaptureStrategy({ ...base, interactive: false }),
      'none',
    );
    assert.strictEqual(
      pickCaptureStrategy({ ...base, mode: 'manual' }),
      'none',
    );
  });

  it('outside tmux: relaunch only with --tmux', () => {
    assert.strictEqual(pickCaptureStrategy({ ...base, inTmux: false }), 'none');
    assert.strictEqual(
      pickCaptureStrategy({ ...base, inTmux: false, tmuxFlag: true }),
      'relaunch',
    );
  });

  it('--attach is sidecar-only (other modes fall through)', () => {
    assert.strictEqual(
      pickCaptureStrategy({ ...base, mode: 'manual', attach: 'x:0.0' }),
      'none',
    );
  });
});

describe('attachHint', () => {
  it('work pane: how to switch to it', () => {
    const h = attachHint({ kind: 'work-pane', target: '%12', reused: false });
    assert.ok(h.includes('%12') && h.includes('created'), h);
    assert.ok(h.includes('tmux select-pane -t %12'), h);
  });

  it('relaunch: how to come back after detaching', () => {
    const h = attachHint({
      kind: 'relaunch',
      target: 'samaritan-op',
      reused: true,
    });
    assert.ok(h.includes('reused'), h);
    assert.ok(h.includes('tmux attach -t samaritan-op'), h);
  });

  it('spawn-own sessions: attach outside tmux, switch-client inside', () => {
    const outside = attachHint({
      kind: 'sessions',
      target: 'samaritan-1',
      inTmux: false,
    });
    const inside = attachHint({
      kind: 'sessions',
      target: 'samaritan-1',
      inTmux: true,
    });
    assert.ok(outside.includes('tmux attach -t samaritan-1'), outside);
    assert.ok(inside.includes('tmux switch-client -t samaritan-1'), inside);
    assert.ok(!inside.includes('tmux attach'), 'never nest attach inside tmux');
  });

  it('--attach: names the pane', () => {
    const h = attachHint({ kind: 'attach', target: 'ops:0.1' });
    assert.ok(h.includes('ops:0.1'), h);
  });
});
