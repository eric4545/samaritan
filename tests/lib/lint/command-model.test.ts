import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  compilePattern,
  matchesPattern,
  parseCommands,
} from '../../../src/lib/lint/command-model';

const one = (text: string) => parseCommands(text).commands[0];

describe('normalizeCommand', () => {
  it('splits --flag=value into option + value', () => {
    assert.deepStrictEqual(one('aws s3 ls --max-results=1').options, [
      { name: '--max-results', value: '1' },
    ]);
  });

  it('expands combined short flags for git subcommands', () => {
    assert.deepStrictEqual(
      one('git add -Av').options.map((o) => o.name),
      ['-A', '-v'],
    );
    assert.deepStrictEqual(one('git commit -am msg').options, [
      { name: '-a' },
      { name: '-m', value: 'msg' },
    ]);
  });

  it('resolves the subcommand after global options and their values', () => {
    const cmd = one('git -C staging -c a=b push origin feature');
    assert.deepStrictEqual(cmd.operands, ['push', 'origin', 'feature']);
    assert.deepStrictEqual(cmd.options, [
      { name: '-C', value: 'staging' },
      { name: '-c', value: 'a=b' },
    ]);
  });

  it('unwraps sudo / env / exec / timeout and keeps env assignments', () => {
    const cmd = one('sudo -u web env AWS_PAGER= timeout 30 aws s3 ls');
    assert.strictEqual(cmd.executable, 'aws');
    assert.deepStrictEqual(cmd.wrappers, ['sudo', 'env', 'timeout']);
    assert.deepStrictEqual(cmd.assignments, [{ name: 'AWS_PAGER', value: '' }]);
    assert.strictEqual(one('exec >log 2>&1').executable, '');
    assert.strictEqual(one('/usr/bin/git status').executable, 'git');
  });

  it('reads mysql -p<value> as an attached value, bare -p as a prompt', () => {
    assert.deepStrictEqual(one('mysql -psecret db').options, [
      { name: '-p', value: 'secret' },
    ]);
    assert.deepStrictEqual(one('mysql -p db').options, [{ name: '-p' }]);
  });
});

describe('banned / required pattern matching', () => {
  const matches = (pattern: string, text: string) =>
    parseCommands(text).commands.some((c) =>
      matchesPattern(compilePattern(pattern), c),
    );

  it('matches whole tokens, flags anywhere, combined short flags', () => {
    assert.ok(matches('git add -A', 'git add -A'));
    assert.ok(matches('git add -A', 'git add -Av'));
    assert.ok(matches('git add -A', 'git add file -A'));
    assert.ok(!matches('git add -A', 'git add -u'));
    assert.ok(!matches('git add -A', 'echo git add -A'));
  });

  it('matches split flag values and assignments', () => {
    assert.ok(matches('aws --max-results', 'aws s3 ls --max-results=1'));
    assert.ok(matches('aws --max-results', 'aws s3 ls --max-results 1'));
    assert.ok(matches('AWS_PAGER=', 'AWS_PAGER="" aws s3 ls'));
    assert.ok(matches('AWS_PAGER=', 'AWS_PAGER=less aws s3 ls'));
    assert.ok(!matches('AWS_PAGER=', 'aws s3 ls'));
  });

  it('treats * as a whole-token wildcard, operands as an ordered prefix', () => {
    assert.ok(matches('tmux send-keys *', 'tmux send-keys -t ops Enter'));
    assert.ok(!matches('tmux send-keys *', 'tmux send-keys'));
    assert.ok(matches('aws *', 'aws s3 ls'));
    assert.ok(!matches('aws s3*', 'aws s3 ls'), '* is not a substring glob');
  });

  it('analyses commands inside $( )', () => {
    assert.ok(matches('aws *', 'ACCOUNT=$(aws sts get-caller-identity)'));
  });

  it('rejects a pattern that is not one simple command', () => {
    assert.throws(() => compilePattern('a && b'), /one simple command/);
  });
});
