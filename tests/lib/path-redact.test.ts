import assert from 'node:assert';
import { describe, it } from 'node:test';
import { redactLocalPaths } from '../../src/lib/path-redact';

describe('redactLocalPaths', () => {
  it('collapses the home directory to ~', () => {
    const out = redactLocalPaths('config at /home/alice/work/op.yaml', {
      home: '/home/alice',
    });
    assert.strictEqual(out, 'config at ~/work/op.yaml');
  });

  it('strips the run directory prefix to a relative remainder', () => {
    const out = redactLocalPaths(
      'MAIL_BODY_HTML=/tmp/operation/runs/JOB-1/email_body.html',
      { runDir: '/tmp/operation/runs/JOB-1' },
    );
    assert.strictEqual(out, 'MAIL_BODY_HTML=email_body.html');
  });

  it('strips the operation directory prefix', () => {
    const out = redactLocalPaths(
      'TEMPLATE_FILE="/tmp/operation/repository/rpsp-lambda/config/x.j2"',
      { opDir: '/tmp/operation/repository/rpsp-lambda' },
    );
    assert.strictEqual(out, 'TEMPLATE_FILE="config/x.j2"');
  });

  it('applies the longest matching prefix first (run dir nested under home)', () => {
    // Run dir is under home; it must strip to its own relative tail, not ~/...
    const out = redactLocalPaths('/home/bob/.samaritan/sessions/s1/out.log', {
      home: '/home/bob',
      runDir: '/home/bob/.samaritan/sessions/s1',
    });
    assert.strictEqual(out, 'out.log');
  });

  it('replaces every occurrence, not just the first', () => {
    const out = redactLocalPaths('/run/a.txt then /run/b.txt', {
      runDir: '/run',
    });
    assert.strictEqual(out, 'a.txt then b.txt');
  });

  it('reduces a bare directory reference (no trailing file) to empty/tilde', () => {
    assert.strictEqual(
      redactLocalPaths('cd /tmp/operation/runs/JOB-1', {
        runDir: '/tmp/operation/runs/JOB-1',
      }),
      'cd ',
    );
    assert.strictEqual(
      redactLocalPaths('home is /home/carol', { home: '/home/carol' }),
      'home is ~',
    );
  });

  it('leaves unrelated text and paths untouched', () => {
    const text = 'deployment.apps/web created\n/usr/bin/env python3';
    assert.strictEqual(redactLocalPaths(text, { home: '/home/dave' }), text);
  });

  it('is a no-op when no bases are provided', () => {
    const text = '/tmp/operation/runs/JOB-1/x';
    assert.strictEqual(redactLocalPaths(text, {}), text);
  });
});
