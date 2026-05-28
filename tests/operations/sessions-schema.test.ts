import assert from 'node:assert';
import { describe, it } from 'node:test';
import { parseFixture } from '../fixtures/fixtures';

describe('Sessions / execution-engine schema (issue #5)', () => {
  describe('with-sessions fixture', () => {
    it('parses sessions block on Operation', async () => {
      const op = await parseFixture('withSessions');
      assert.ok(op.sessions, 'sessions should be present');
      assert.ok(op.sessions.execution, 'execution session should exist');
      assert.strictEqual(
        op.sessions.execution.host,
        'prod-bastion.example.com',
      );
      assert.strictEqual(op.sessions.execution.user, 'deploy');
      assert.deepStrictEqual(op.sessions.execution.env, {
        KUBECONFIG: '/home/deploy/.kube/config',
      });
      assert.ok(op.sessions.verification, 'verification session should exist');
      assert.strictEqual(
        op.sessions.verification.host,
        'monitoring.example.com',
      );
    });

    it('parses run config on Operation', async () => {
      const op = await parseFixture('withSessions');
      assert.ok(op.run, 'run config should be present');
      assert.strictEqual(op.run.auto_send, false);
      assert.strictEqual(op.run.auto_exec, false);
    });

    it('parses step.session field', async () => {
      const op = await parseFixture('withSessions');
      const deployStep = op.steps[0];
      assert.strictEqual(deployStep.name, 'Deploy App');
      assert.strictEqual(deployStep.session, 'execution');
    });

    it('parses step.verify with session and expect (object form)', async () => {
      const op = await parseFixture('withSessions');
      const deployStep = op.steps[0];
      assert.ok(deployStep.verify, 'verify should be present');
      assert.strictEqual(deployStep.verify.session, 'verification');
      assert.strictEqual(deployStep.verify.command, 'kubectl get pods -n prod');
      const expect = deployStep.verify.expect as any;
      assert.ok(expect, 'expect should be present');
      assert.strictEqual(expect.contains, 'Running');
      assert.ok(expect.retry, 'retry should be present');
      assert.strictEqual(expect.retry.interval, '5s');
      assert.strictEqual(expect.retry.max, 12);
    });

    it('parses step.rollback as array (execution-engine format)', async () => {
      const op = await parseFixture('withSessions');
      const deployStep = op.steps[0];
      assert.ok(
        Array.isArray(deployStep.rollback),
        'rollback should be an array',
      );
      const rb = deployStep.rollback as any[];
      assert.strictEqual(rb.length, 2);
      assert.strictEqual(rb[0].command, 'kubectl rollout undo deployment/web');
      assert.strictEqual(rb[0].session, 'execution');
      assert.strictEqual(
        rb[1].command,
        'kubectl delete pod -l app=web --force',
      );
    });

    it('parses step.capture config', async () => {
      const op = await parseFixture('withSessions');
      const buildStep = op.steps[1];
      assert.strictEqual(buildStep.name, 'Build Image');
      assert.ok(buildStep.capture, 'capture should be present');
      assert.ok(buildStep.capture.IMAGE_ID, 'IMAGE_ID capture should exist');
      assert.strictEqual(
        buildStep.capture.IMAGE_ID.pattern,
        'Successfully built ([a-f0-9]+)',
      );
      assert.strictEqual(buildStep.capture.IMAGE_ID.group, 1);
      assert.ok(buildStep.capture.LAST_LINE, 'LAST_LINE capture should exist');
      assert.strictEqual(buildStep.capture.LAST_LINE.line, 'last');
    });

    it('parses verify string shorthand', async () => {
      const op = await parseFixture('withSessions');
      const buildStep = op.steps[1];
      assert.strictEqual(buildStep.verify, 'Successfully built');
    });
  });

  describe('with-capture-expect fixture', () => {
    it('parses without error', async () => {
      const op = await parseFixture('withCaptureExpect');
      assert.ok(op);
      assert.strictEqual(op.name, 'Capture and Expect Test');
      assert.strictEqual(op.steps.length, 4);
    });

    it('parses verify.expect with numeric assertions', async () => {
      const op = await parseFixture('withCaptureExpect');
      const podStep = op.steps[1];
      assert.ok(podStep.verify?.expect);
      const expect = podStep.verify?.expect as any;
      assert.strictEqual(expect.line_count_gte, 1);
      assert.strictEqual(expect.numeric_gte, 3);
    });

    it('parses verify with retry and captured var reference', async () => {
      const op = await parseFixture('withCaptureExpect');
      const deployStep = op.steps[2];
      const expect = deployStep.verify?.expect as any;
      assert.strictEqual(expect.contains, '${IMAGE_ID}');
      assert.strictEqual(expect.retry.max, 6);
    });
  });
});
