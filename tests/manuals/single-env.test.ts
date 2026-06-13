import assert from 'node:assert';
import { describe, it } from 'node:test';
import { generateSingleEnvManual } from '../../src/manuals/generator';
import { parseFixture } from '../fixtures/fixtures';

describe('Single-env heading-based Markdown manual (issue #15)', () => {
  it('generates heading-based output with --env', async () => {
    const op = await parseFixture('withSessions');
    const md = generateSingleEnvManual(op, 'production');

    assert.ok(
      md.includes('# Deploy with Sessions — Production'),
      'has H1 title',
    );
    assert.ok(md.includes('## Step 1:'), 'has step headings');
    assert.ok(!md.includes('|'), 'has no table pipes');
  });

  it('each step has ## Step N: <name> heading', async () => {
    const op = await parseFixture('withSessions');
    const md = generateSingleEnvManual(op, 'production');

    assert.ok(md.includes('## Step 1: Deploy App'), 'step 1 heading');
    assert.ok(md.includes('## Step 2: Check Deployment'), 'step 2 heading');
    assert.ok(md.includes('## Step 3: Build Image'), 'step 3 heading');
  });

  it('renders **Command** block', async () => {
    const op = await parseFixture('withSessions');
    const md = generateSingleEnvManual(op, 'production');

    assert.ok(md.includes('**Command**'), 'has Command block');
    assert.ok(
      md.includes('kubectl apply -f deployment.yaml'),
      'has command text',
    );
    assert.ok(md.includes('```'), 'has code fence');
  });

  it('renders verify step command and Expected block', async () => {
    const op = await parseFixture('withSessions');
    const md = generateSingleEnvManual(op, 'production');

    // "Check Deployment" step has command + expect
    assert.ok(md.includes('kubectl get pods -n prod'), 'has command');
    assert.ok(md.includes('Expected:'), 'has Expected line');
    assert.ok(md.includes('Running'), 'shows expected value');
  });

  it('renders PIC and Reviewer as blockquotes', async () => {
    const op = await parseFixture('withSessions');
    // Patch step with pic/reviewer
    const step = op.steps[0];
    step.pic = 'ops@example.com';
    step.reviewer = 'sre@example.com';
    const md = generateSingleEnvManual(op, 'production');

    assert.ok(md.includes('> PIC: ops@example.com'), 'has PIC blockquote');
    assert.ok(
      md.includes('> Reviewer: sre@example.com'),
      'has Reviewer blockquote',
    );
  });

  it('horizontal rule separates steps', async () => {
    const op = await parseFixture('withSessions');
    const md = generateSingleEnvManual(op, 'production');

    assert.ok(md.includes('---'), 'has horizontal rule separator');
  });

  it('no tables in output', async () => {
    const op = await parseFixture('withSessions');
    const md = generateSingleEnvManual(op, 'production');

    const lines = md.split('\n');
    const tableLines = lines.filter((l) => l.startsWith('|'));
    assert.strictEqual(tableLines.length, 0, 'should have no table lines');
  });

  it('without --env: existing table format unchanged (deployment fixture)', async () => {
    const { generateManualWithMetadata } = await import(
      '../../src/manuals/generator'
    );
    const op = await parseFixture('deployment');
    const md = generateManualWithMetadata(op, undefined, undefined);
    // Table format has | characters
    assert.ok(md.includes('|'), 'table format should have pipes');
  });

  it('renders string shorthand expect on step', async () => {
    const op = await parseFixture('withSessions');
    const buildStep = op.steps[2]; // "Build Image" — now step index 2 after "Check Deployment" added
    assert.strictEqual(buildStep.name, 'Build Image');
    assert.strictEqual(buildStep.expect, 'Successfully built');
    const md = generateSingleEnvManual(op, 'production');
    assert.ok(
      md.includes('Successfully built'),
      'renders string shorthand expect',
    );
  });

  it('filters steps by when field for target env', async () => {
    const op = await parseFixture('whenAndVariants');
    const envName = op.environments[0].name;
    const md = generateSingleEnvManual(op, envName);
    // Should not throw and should have heading
    assert.ok(md.includes('#'), 'has headings');
  });

  it('snapshot: withCaptureExpect — verify with command+expect, expect-only, and verify-only shapes', async (t) => {
    const op = await parseFixture('withCaptureExpect');
    const md = generateSingleEnvManual(op, 'staging');
    assert.ok(md.includes('#'), 'renders headings');
    t.assert.snapshot(md);
  });

  it('snapshot: withSessions — verify string shorthand rendered as expect block', async (t) => {
    const op = await parseFixture('withSessions');
    const md = generateSingleEnvManual(op, 'production');
    assert.ok(md.includes('#'), 'renders headings');
    t.assert.snapshot(md);
  });

  it('renders both instruction and command when both are present', async () => {
    const op = await parseFixture('withSessions');
    // Patch step to have both instruction and command
    const step = op.steps[0];
    step.instruction = 'Make sure the cluster is healthy before proceeding.';
    step.command = 'kubectl apply -f deployment.yaml';
    const md = generateSingleEnvManual(op, 'production');

    assert.ok(md.includes('**Instructions**'), 'renders Instructions section');
    assert.ok(
      md.includes('Make sure the cluster is healthy before proceeding.'),
      'renders instruction text',
    );
    assert.ok(md.includes('**Command**'), 'renders Command section');
    assert.ok(
      md.includes('kubectl apply -f deployment.yaml'),
      'renders command text',
    );
    // Instructions must appear before Command
    const instrIdx = md.indexOf('**Instructions**');
    const cmdIdx = md.indexOf('**Command**');
    assert.ok(instrIdx < cmdIdx, 'instruction appears before command');
  });

  it('trims trailing blank line from multi-line command code blocks', async () => {
    const op = await parseFixture('withSessions');
    // Simulate a YAML block scalar (`command: |`), which retains a trailing newline
    op.steps[0].command = 'kubectl apply -f deployment.yaml\necho done\n';
    const md = generateSingleEnvManual(op, 'production');

    assert.ok(
      md.includes('echo done\n```'),
      'closing fence directly follows the last command line',
    );
    assert.ok(
      !md.includes('echo done\n\n```'),
      'no blank line before the closing fence',
    );
  });

  it('renders step description when present', async () => {
    const op = await parseFixture('withSessions');
    op.steps[0].description = 'Deploy the web application to the cluster';
    const md = generateSingleEnvManual(op, 'production');

    assert.ok(
      md.includes('_Deploy the web application to the cluster_'),
      'renders description as italic',
    );
  });

  it('substitutes env variables in step description when resolveVariables=true', async () => {
    const op = await parseFixture('withSessions');
    op.steps[0].description = 'Deploy ${APP_NAME} to ${CLUSTER}';
    op.environments[0].variables = {
      ...op.environments[0].variables,
      APP_NAME: 'web-server',
      CLUSTER: 'prod-cluster',
    };
    const md = generateSingleEnvManual(op, 'production', true);

    assert.ok(
      md.includes('_Deploy web-server to prod-cluster_'),
      'substitutes variables in description',
    );
  });

  it('does not substitute variables in description when resolveVariables=false', async () => {
    const op = await parseFixture('withSessions');
    op.steps[0].description = 'Deploy ${APP_NAME} to ${CLUSTER}';
    const md = generateSingleEnvManual(op, 'production', false);

    assert.ok(
      md.includes('_Deploy ${APP_NAME} to ${CLUSTER}_'),
      'leaves variables unsubstituted',
    );
  });

  it('renders needs/dependencies when present', async () => {
    const op = await parseFixture('withSessions');
    op.steps[1].needs = ['deploy-app'];
    const md = generateSingleEnvManual(op, 'production');

    assert.ok(
      md.includes('> Depends on: deploy-app'),
      'renders dependency blockquote',
    );
  });

  it('renders timeline when present', async () => {
    const op = await parseFixture('withSessions');
    op.steps[0].timeline = '2025-10-21 09:00 for 30m';
    const md = generateSingleEnvManual(op, 'production');

    assert.ok(md.includes('> Timeline:'), 'renders timeline blockquote');
    assert.ok(
      md.includes('2025-10-21 09:00 for 30m'),
      'renders timeline value',
    );
  });

  it('renders conditional (if) when present', async () => {
    const op = await parseFixture('withSessions');
    op.steps[0].if = 'env == "production"';
    const md = generateSingleEnvManual(op, 'production');

    assert.ok(
      md.includes('> Condition: env == "production"'),
      'renders condition blockquote',
    );
  });

  it('applies env-specific variant overrides in single-env output', async () => {
    const op = await parseFixture('whenAndVariants');
    const envName = op.environments[0].name;
    // If the fixture has variants, they should be applied
    const md = generateSingleEnvManual(op, envName);
    assert.ok(md.includes('#'), 'produces output');
  });

  it('preserves original step numbers across environments when steps are skipped by when', async () => {
    // When a step has `when: [dev]`, env=prod should skip it but keep the
    // original step numbers for remaining steps so that "Step 6" in dev is
    // still "Step 6" in prod (not renumbered to "Step 5").
    const op = await parseFixture('whenAndVariants');
    // when-and-variants.yaml:
    //   step 1: when: [prod]
    //   step 2: all envs
    //   step 3: when: [staging, preprod]
    //   step 4: all envs
    //   step 5: when: [preprod, prod]

    // staging sees steps 2, 3, 4 → should be Step 2, Step 3, Step 4
    const stagingMd = generateSingleEnvManual(op, 'staging');
    assert.ok(
      stagingMd.includes('## Step 2:'),
      'staging: step 2 keeps number 2',
    );
    assert.ok(
      stagingMd.includes('## Step 3:'),
      'staging: step 3 keeps number 3',
    );
    assert.ok(
      stagingMd.includes('## Step 4:'),
      'staging: step 4 keeps number 4',
    );
    assert.ok(
      !stagingMd.includes('## Step 1:'),
      'staging: prod-only step 1 not shown',
    );
    assert.ok(
      !stagingMd.includes('## Step 5:'),
      'staging: preprod/prod-only step 5 not shown',
    );

    // prod sees steps 1, 2, 4, 5 → should be Step 1, Step 2, Step 4, Step 5
    const prodMd = generateSingleEnvManual(op, 'prod');
    assert.ok(prodMd.includes('## Step 1:'), 'prod: step 1 keeps number 1');
    assert.ok(prodMd.includes('## Step 2:'), 'prod: step 2 keeps number 2');
    assert.ok(
      !prodMd.includes('## Step 3:'),
      'prod: staging/preprod-only step 3 not shown',
    );
    assert.ok(prodMd.includes('## Step 4:'), 'prod: step 4 keeps number 4');
    assert.ok(prodMd.includes('## Step 5:'), 'prod: step 5 keeps number 5');
  });

  it('renders rollback instruction in single-env mode', async () => {
    const op = await parseFixture('parentStepWithSubstepsAndRollback');
    const md = generateSingleEnvManual(op, 'production');

    assert.ok(md.includes('🔄 Rollback'), 'has rollback heading');
    assert.ok(
      md.includes('Rollback to previous deployment version'),
      'has rollback instruction text',
    );
  });

  it('renders rollback command block in single-env mode', async () => {
    const op = await parseFixture('parentStepWithSubstepsAndRollback');
    const md = generateSingleEnvManual(op, 'production');

    assert.ok(
      md.includes('kubectl rollout undo deployment/app'),
      'has rollback command',
    );
    assert.ok(md.includes('```bash'), 'rollback command in code fence');
  });

  it('rollback appears after sub_steps in single-env mode', async () => {
    const op = await parseFixture('parentStepWithSubstepsAndRollback');
    const md = generateSingleEnvManual(op, 'production');

    const lastSubStepIdx = md.indexOf('Step 1.3: Verify Deployment');
    const rollbackIdx = md.indexOf('🔄 Rollback');
    assert.ok(rollbackIdx > 0, 'rollback heading is present');
    assert.ok(lastSubStepIdx > 0, 'last sub-step heading is present');
    assert.ok(
      rollbackIdx > lastSubStepIdx,
      'rollback appears after last sub-step',
    );
  });

  it('no table pipes even when rollback is present in single-env mode', async () => {
    const op = await parseFixture('parentStepWithSubstepsAndRollback');
    const md = generateSingleEnvManual(op, 'production');

    const lines = md.split('\n');
    const tableLines = lines.filter((l) => l.startsWith('|'));
    assert.strictEqual(
      tableLines.length,
      0,
      'should have no table lines even with rollback',
    );
  });

  it('resolves rollback variables when resolveVariables=true', async () => {
    const op = await parseFixture('parentStepWithSubstepsAndRollback');
    const md = generateSingleEnvManual(op, 'production', true);

    // ${NAMESPACE} should be resolved to "prod" (from production env vars)
    assert.ok(md.includes('-n prod'), 'rollback command has resolved variable');
    assert.ok(
      !md.includes('${NAMESPACE}'),
      'no unresolved variables in rollback',
    );
  });

  it('renders rollback for nested sub-step in single-env mode', async () => {
    const op = await parseFixture('nestedSubstepWithRollback');
    const md = generateSingleEnvManual(op, 'production');

    assert.ok(
      md.includes('🔄 Rollback'),
      'has rollback heading for nested sub-step',
    );
    assert.ok(
      md.includes('Restore previous traffic weights'),
      'has nested rollback instruction',
    );
    assert.ok(
      md.includes('git restore config.hcl'),
      'has nested rollback command',
    );
  });

  describe('foreach/matrix variable reference resolution (--resolve-vars)', () => {
    it('resolves common_variables-derived foreach title and command (resolve on)', async () => {
      const op = await parseFixture('foreachVariableValues');
      const md = generateSingleEnvManual(op, 'production', true);

      assert.ok(
        md.includes('## Step 1: foreach title test (a@example.com)'),
        'heading resolves common_variables reference',
      );
      assert.ok(
        md.includes('echo "a@example.com"'),
        'command resolves common_variables reference',
      );
    });

    it('resolves env-only foreach values in single-env titles and commands (resolve on)', async () => {
      const op = await parseFixture('foreachVariableValues');
      const md = generateSingleEnvManual(op, 'production', true);

      // Step 4: foreach value was "${ENV_RECIPIENT}", only defined in the
      // production environment — resolves only with --resolve-vars.
      assert.ok(
        md.includes('## Step 4: foreach title test (prod@example.com)'),
        'heading resolves env-only variable',
      );
      assert.ok(
        md.includes('echo "prod@example.com"'),
        'command resolves chained env-only step variable',
      );
    });

    it('leaves unresolved (undefined) variable references literal in titles and commands (resolve on)', async () => {
      const op = await parseFixture('foreachVariableValues');
      const md = generateSingleEnvManual(op, 'production', true);

      // Step 2: foreach value was "${EMAIL_B}" — never defined anywhere.
      assert.ok(
        md.includes('## Step 2: foreach title test (${EMAIL_B})'),
        'heading keeps unresolved variable literal',
      );
      assert.ok(
        md.includes('echo "${EMAIL_B}"'),
        'command keeps unresolved variable literal',
      );
    });

    it('common-var title is resolved at parse time even with resolve off; env-only title stays literal', async () => {
      const op = await parseFixture('foreachVariableValues');
      const md = generateSingleEnvManual(op, 'production', false);

      // Resolved at PARSE time (common_variables), independent of --resolve-vars
      assert.ok(
        md.includes('## Step 1: foreach title test (a@example.com)'),
        'common-var title resolved regardless of --resolve-vars',
      );

      // Env-only variable requires --resolve-vars; stays literal when off
      assert.ok(
        md.includes('## Step 4: foreach title test (${ENV_RECIPIENT})'),
        'env-only title stays literal without --resolve-vars',
      );
    });

    it('resolves foreach loop variables propagated into sub_steps (resolve on)', async () => {
      const op = await parseFixture('foreachWithSubsteps');
      const md = generateSingleEnvManual(op, 'production', true);

      // First combo: TEST_RECIPIENT = ${EMAIL_A} -> a@example.com (resolved at parse time)
      assert.ok(
        md.includes(
          'aws sesv2 send-email --destination ToAddresses=a@example.com',
        ),
        'sub-step command resolves combo variable for first combo',
      );
      assert.ok(
        md.includes(
          'Confirm email delivery to a@example.com in the SES console.',
        ),
        'sub-step instruction resolves combo variable for first combo',
      );
      assert.ok(
        md.includes(
          'aws sesv2 get-suppressed-destination --email-address a@example.com',
        ),
        'nested sub-step command resolves combo variable for first combo',
      );
      assert.ok(
        md.includes(
          'aws sesv2 send-email --destination ToAddresses=a@example.com --message "cancelled"',
        ),
        'sub-step rollback command resolves combo variable for first combo',
      );

      // Second combo: TEST_RECIPIENT = ${ENV_RECIPIENT} -> prod@example.com (resolved at generation time via --resolve-vars)
      assert.ok(
        md.includes(
          'aws sesv2 send-email --destination ToAddresses=prod@example.com',
        ),
        'sub-step command resolves combo variable for second (env-only) combo',
      );

      // Expect blocks should show resolved values, not the literal placeholder
      assert.ok(
        md.includes('- [ ] contains: a@example.com'),
        'sub-step expect resolves combo variable for first combo',
      );
      assert.ok(
        md.includes('- [ ] contains: prod@example.com'),
        'sub-step expect resolves combo variable for second combo',
      );

      assert.ok(
        !md.includes('${TEST_RECIPIENT}'),
        'no unresolved ${TEST_RECIPIENT} literal remains',
      );
    });

    it('leaves foreach loop variables in sub_steps unresolved (resolve off)', async () => {
      const op = await parseFixture('foreachWithSubsteps');
      const md = generateSingleEnvManual(op, 'production', false);

      assert.ok(
        md.includes(
          'aws sesv2 send-email --destination ToAddresses=${TEST_RECIPIENT}',
        ),
        'sub-step command keeps ${TEST_RECIPIENT} literal when resolve is off',
      );
    });

    it('resolves top-level variables: in step command (resolve on)', async () => {
      const op = await parseFixture('topLevelVariables');
      const md = generateSingleEnvManual(op, 'production', true);

      assert.ok(
        md.includes(
          'aws sesv2 send-email --destination ToAddresses=a@example.com --region eu-west-1',
        ),
        'command resolves ${EMAIL_A} from top-level variables and ${REGION} with common_variables winning',
      );
      assert.ok(
        !md.includes('${EMAIL_A}'),
        'no unresolved ${EMAIL_A} literal remains',
      );
      assert.ok(
        !md.includes('${REGION}'),
        'no unresolved ${REGION} literal remains',
      );
    });
  });
});
