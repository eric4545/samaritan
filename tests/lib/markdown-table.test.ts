import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  escapeTableCodePipes,
  escapeTableText,
  tableCodeSpan,
} from '../../src/lib/markdown-table';

// The table splitter (GFM / markdown-it) removes exactly ONE backslash in
// front of every pipe before inline parsing; these helpers are written
// against that rule, so the expected strings below are what must reach it.

describe('escapeTableText', () => {
  it('escapes a bare pipe', () => {
    assert.strictEqual(escapeTableText('a|b'), 'a\\|b');
  });

  it('keeps a backslash that precedes a pipe (a\\|b stays a\\|b on screen)', () => {
    // splitter: a\\\|b -> a\\|b ; inline: \\ -> \  => "a\|b"
    assert.strictEqual(escapeTableText('a\\|b'), 'a\\\\\\|b');
  });

  it('doubles every backslash in a run before a pipe', () => {
    assert.strictEqual(escapeTableText('a\\\\|b'), 'a\\\\\\\\\\|b');
  });

  it('leaves other backslashes (author Markdown escapes) untouched', () => {
    assert.strictEqual(escapeTableText('C:\\temp \\*x\\*'), 'C:\\temp \\*x\\*');
  });
});

describe('escapeTableCodePipes', () => {
  it('escapes pipes but never backslashes (code spans keep them verbatim)', () => {
    assert.strictEqual(
      escapeTableCodePipes("grep 'a\\|b' f | wc -l"),
      "grep 'a\\\\|b' f \\| wc -l",
    );
  });
});

describe('tableCodeSpan', () => {
  it('wraps plain code in single backticks', () => {
    assert.strictEqual(tableCodeSpan('ls -la'), '`ls -la`');
  });

  it('fences code containing backticks with a longer run instead of \\`', () => {
    assert.strictEqual(
      tableCodeSpan('echo `date` > out'),
      '``echo `date` > out``',
    );
  });

  it('uses a fence longer than the longest backtick run', () => {
    assert.strictEqual(tableCodeSpan('a ``b`` c'), '```a ``b`` c```');
  });

  it('pads with spaces when the code starts or ends with a backtick', () => {
    assert.strictEqual(tableCodeSpan('`x`'), '`` `x` ``');
  });

  it('escapes pipes inside the span', () => {
    assert.strictEqual(tableCodeSpan('ps | grep x'), '`ps \\| grep x`');
  });
});
