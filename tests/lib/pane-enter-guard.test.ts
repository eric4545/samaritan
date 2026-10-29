import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  type ArmedEnter,
  armEnter,
  checkEnterSafe,
  type PaneState,
} from '../../src/lib/pane-enter-guard';

const pane = (over: Partial<PaneState> = {}): PaneState => ({
  paneId: '%3',
  dead: false,
  inMode: false,
  synchronized: false,
  inputOff: false,
  currentCommand: 'bash',
  cursorX: 24,
  cursorY: 5,
  historySize: 10,
  cursorLine: '$ kubectl rollout status',
  ...over,
});

const armed = (): ArmedEnter => {
  const a = armEnter('kubectl rollout status', pane(), 100);
  assert.ok(!('reason' in a), 'fixture must arm');
  return a;
};

describe('armEnter', () => {
  it('arms when the paste sits at the cursor line', () => {
    const a = armEnter('kubectl rollout status\n', pane(), 100);
    assert.ok(!('reason' in a));
    assert.strictEqual(a.offset, 100);
  });

  it('arms on the LAST line of a multi-line block (PS2 prefix ok)', () => {
    const a = armEnter(
      'echo a \\\n  --flag b',
      pane({ cursorLine: '> --flag b' }),
      1,
    );
    assert.ok(!('reason' in a));
  });

  it('arms when a long line wrapped and the cursor row is its tail', () => {
    const a = armEnter(
      'echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-tail',
      pane({ cursorLine: 'aaaa-tail' }),
      1,
    );
    assert.ok(!('reason' in a));
  });

  it('refuses when the command is not at the cursor (already ran)', () => {
    const a = armEnter('kubectl rollout status', pane({ cursorLine: '$ ' }), 1);
    assert.ok('reason' in a);
    assert.match(a.reason, /not at the cursor/);
  });

  it('refuses without a pane state', () => {
    assert.ok('reason' in armEnter('ls', undefined, 0));
  });
});

describe('checkEnterSafe', () => {
  it('allows Enter when nothing changed', () => {
    assert.strictEqual(checkEnterSafe(armed(), pane(), 100), undefined);
  });

  const refusals: Array<[string, PaneState | undefined, number, RegExp]> = [
    ['pane gone', undefined, 100, /gone/],
    ['different pane', pane({ paneId: '%9' }), 100, /different pane/],
    ['dead pane', pane({ dead: true }), 100, /dead/],
    ['copy mode', pane({ inMode: true }), 100, /copy\/view mode/],
    ['synchronized', pane({ synchronized: true }), 100, /synchronize-panes/],
    ['input off', pane({ inputOff: true }), 100, /input disabled/],
    ['other program', pane({ currentCommand: 'vim' }), 100, /now runs vim/],
    ['new output', pane(), 101, /printed output/],
    ['cursor moved', pane({ cursorX: 20 }), 100, /prompt changed/],
    [
      'line edited',
      pane({ cursorLine: '$ kubectl rollout statuz' }),
      100,
      /prompt changed/,
    ],
    ['scrolled', pane({ historySize: 11 }), 100, /prompt changed/],
  ];
  for (const [name, now, offset, reason] of refusals) {
    it(`refuses: ${name}`, () => {
      assert.match(checkEnterSafe(armed(), now, offset) ?? '', reason);
    });
  }
});
