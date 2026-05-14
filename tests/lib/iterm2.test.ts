import assert from 'node:assert';
import { describe, it } from 'node:test';
import { detectDisplayStrategy, isIterm2 } from '../../src/lib/iterm2';

describe('iTerm2 detection (issue #11)', () => {
  it('isIterm2() returns false when TERM_PROGRAM is not iTerm.app', () => {
    const original = process.env.TERM_PROGRAM;
    process.env.TERM_PROGRAM = 'xterm';
    try {
      assert.strictEqual(isIterm2(), false);
    } finally {
      if (original === undefined) {
        delete process.env.TERM_PROGRAM;
      } else {
        process.env.TERM_PROGRAM = original;
      }
    }
  });

  it('isIterm2() returns true when TERM_PROGRAM is iTerm.app', () => {
    const original = process.env.TERM_PROGRAM;
    process.env.TERM_PROGRAM = 'iTerm.app';
    try {
      assert.strictEqual(isIterm2(), true);
    } finally {
      if (original === undefined) {
        delete process.env.TERM_PROGRAM;
      } else {
        process.env.TERM_PROGRAM = original;
      }
    }
  });

  it('detectDisplayStrategy returns iterm2 in iTerm2 environment', () => {
    const original = process.env.TERM_PROGRAM;
    process.env.TERM_PROGRAM = 'iTerm.app';
    try {
      assert.strictEqual(detectDisplayStrategy(), 'iterm2');
    } finally {
      if (original === undefined) {
        delete process.env.TERM_PROGRAM;
      } else {
        process.env.TERM_PROGRAM = original;
      }
    }
  });

  it('detectDisplayStrategy returns non-iterm2 value in non-iTerm2 environment', () => {
    const original = process.env.TERM_PROGRAM;
    delete process.env.TERM_PROGRAM;
    try {
      const strategy = detectDisplayStrategy();
      assert.notStrictEqual(strategy, 'iterm2');
      assert.ok(
        ['tmux_split', 'print_instructions'].includes(strategy),
        `strategy should be tmux_split or print_instructions, got: ${strategy}`,
      );
    } finally {
      if (original !== undefined) process.env.TERM_PROGRAM = original;
    }
  });

  it('openDisplaySplits exports are callable', async () => {
    const { openDisplaySplits } = await import('../../src/lib/iterm2');
    assert.strictEqual(typeof openDisplaySplits, 'function');
  });
});
