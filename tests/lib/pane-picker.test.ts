import assert from 'node:assert';
import { describe, it } from 'node:test';
import { renderPaneRow, resolvePanePick } from '../../src/lib/pane-picker';
import type { TmuxPaneInfo } from '../../src/lib/tmux-session';

const pane = (over: Partial<TmuxPaneInfo>): TmuxPaneInfo => ({
  id: '%1',
  target: 'work:0.0',
  name: 'work:0.0',
  currentCommand: 'bash',
  title: '',
  isSelf: false,
  ...over,
});

const deploy = pane({ id: '%3', target: 'work:1.0', name: 'work:deploy.0' });
const logs = pane({ id: '%4', target: 'work:1.1', name: 'work:deploy.1' });

describe('renderPaneRow', () => {
  it('shows the named target, the program and the stable id', () => {
    assert.strictEqual(
      renderPaneRow(deploy, 0),
      '      1) work:deploy.0  bash  (%3)',
    );
  });

  it('marks samaritan’s own pane', () => {
    assert.match(
      renderPaneRow(pane({ isSelf: true }), 1),
      /^ {6}2\) work:0\.0 {2}bash {2}\(%1\) {2}\(this pane — samaritan\)$/,
    );
  });
});

describe('resolvePanePick — answered against a fresh list-panes', () => {
  it('Enter cancels, r refreshes', () => {
    assert.deepStrictEqual(resolvePanePick('', [deploy], [deploy]), {
      kind: 'cancel',
    });
    assert.deepStrictEqual(resolvePanePick(' R ', [deploy], [deploy]), {
      kind: 'refresh',
    });
  });

  it('a number picks the listed pane by id, even after it was renumbered', () => {
    // Pane 0 of the window closed after the list was printed: the pane the
    // operator meant is now work:1.0, and work:1.1 is someone else.
    const renumbered = { ...logs, target: 'work:1.0', name: 'work:deploy.0' };
    const pick = resolvePanePick('2', [deploy, logs], [renumbered]);
    assert.deepStrictEqual(pick, { kind: 'pane', pane: renumbered });
  });

  it('a number whose pane closed is reported gone, never re-pointed', () => {
    assert.deepStrictEqual(resolvePanePick('1', [deploy, logs], [logs]), {
      kind: 'gone',
      pane: deploy,
    });
  });

  it('a typed name or id resolves to the live pane', () => {
    assert.deepStrictEqual(
      resolvePanePick('work:deploy.1', [], [deploy, logs]),
      {
        kind: 'pane',
        pane: logs,
      },
    );
    assert.deepStrictEqual(resolvePanePick('%3', [], [deploy, logs]), {
      kind: 'pane',
      pane: deploy,
    });
  });

  it('anything else is a raw target for tmux to check', () => {
    for (const a of ['other:0.1', '3', '0', '1.5'])
      assert.deepStrictEqual(
        resolvePanePick(a, [deploy, logs], [deploy, logs]),
        {
          kind: 'target',
          target: a,
        },
      );
  });
});
