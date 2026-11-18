import assert from 'node:assert';
import { describe, it } from 'node:test';
import { parseShell } from '../../src/lib/lint/shell-lexer';

const argvs = (text: string) => parseShell(text).commands.map((c) => c.argv);

describe('parseShell: token-shape contract', () => {
  it('splits on && || | ; & and newlines, never inside quotes', () => {
    assert.deepStrictEqual(argvs('a 1 && b "x && y" || c | d; e & f\ng'), [
      ['a', '1'],
      ['b', 'x && y'],
      ['c'],
      ['d'],
      ['e'],
      ['f'],
      ['g'],
    ]);
  });

  it('joins backslash continuations into one command', () => {
    assert.deepStrictEqual(argvs('git push \\\n  origin HEAD:main'), [
      ['git', 'push', 'origin', 'HEAD:main'],
    ]);
  });

  it('strips comments, also before the command', () => {
    assert.deepStrictEqual(argvs('# force push\ngit push origin x # tail'), [
      ['git', 'push', 'origin', 'x'],
    ]);
    assert.deepStrictEqual(argvs('echo a#b'), [['echo', 'a#b']]);
  });

  it('keeps $VAR, ${VAR} and ${VAR:?msg} as literal text (no host expansion)', () => {
    process.env.LINT_TEST_VAR = 'expanded';
    assert.deepStrictEqual(
      argvs('echo $LINT_TEST_VAR ${LINT_TEST_VAR} "${LINT_TEST_VAR:?not set}"'),
      [
        [
          'echo',
          '$LINT_TEST_VAR',
          '${LINT_TEST_VAR}',
          '${LINT_TEST_VAR:?not set}',
        ],
      ],
    );
    delete process.env.LINT_TEST_VAR;
  });

  it('analyses $( ) recursively, also inside double quotes', () => {
    const parsed = parseShell(
      'A=$(aws sts x) && echo "$(git push o HEAD:main)"',
    );
    assert.deepStrictEqual(parsed.commands[0].assignments, [
      { name: 'A', value: '$(…)' },
    ]);
    const inner = parsed.commands.filter((c) => c.context === 'substitution');
    assert.deepStrictEqual(
      inner.map((c) => c.argv),
      [
        ['aws', 'sts', 'x'],
        ['git', 'push', 'o', 'HEAD:main'],
      ],
    );
  });

  it('marks ( ) subshells and keeps if/then/fi bodies at top level', () => {
    const parsed = parseShell('if true; then exit 1; fi\n( exit 2 )');
    assert.deepStrictEqual(
      parsed.commands.map((c) => [c.argv.join(' '), c.context]),
      [
        ['true', 'top'],
        ['exit 1', 'top'],
        ['exit 2', 'subshell'],
      ],
    );
  });

  it('separates leading assignments and redirects (fd prefix included)', () => {
    const [cmd] = parseShell('AWS_PAGER="" aws s3 ls 2>&1 >>out.log').commands;
    assert.deepStrictEqual(cmd.assignments, [{ name: 'AWS_PAGER', value: '' }]);
    assert.deepStrictEqual(cmd.argv, ['aws', 's3', 'ls']);
    assert.deepStrictEqual(cmd.redirects, [
      { op: '2>&', target: '1' },
      { op: '>>', target: 'out.log' },
    ]);
  });

  it('skips for-loop word lists but analyses the loop body', () => {
    assert.deepStrictEqual(argvs('for i in a b; do echo $i; done'), [
      ['echo', '$i'],
    ]);
  });

  it('records line numbers per command', () => {
    const lines = parseShell('a\n\nb \\\n c\nd').commands.map((c) => c.line);
    assert.deepStrictEqual(lines, [1, 3, 5]);
  });

  it('reports unsupported constructs instead of skipping them silently', () => {
    const cases: [string, string][] = [
      ['cat <<EOF\ngit push origin HEAD:main\nEOF', 'heredoc'],
      ['diff <(ls a) <(ls b)', 'process substitution'],
      ['echo `date`', 'backticks'],
      ['case $x in a) echo;; esac', 'case'],
      ['f() { echo; }', 'function definition'],
      ['function f { echo; }', 'function definition'],
    ];
    for (const [text, construct] of cases) {
      assert.ok(
        parseShell(text).unsupported.includes(construct),
        `${JSON.stringify(text)} should report ${construct}`,
      );
    }
    // Lines after a heredoc start are not analysed as commands.
    assert.deepStrictEqual(argvs('cat <<EOF\ngit push origin HEAD:main\nEOF'), [
      ['cat'],
    ]);
    // A here-string is a plain redirect, not a heredoc.
    assert.deepStrictEqual(parseShell('cat <<< "x"').unsupported, []);
  });
});
