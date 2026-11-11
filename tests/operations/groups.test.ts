import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  parseOperation,
  parseOperationForGroup,
} from '../../src/operations/parser';
import { getFixturePath } from '../fixtures/fixtures';

const fixture = getFixturePath('deploymentWithGroups');
const stepNames = (op: { steps: { name: string }[] }): string[] =>
  op.steps.map((s) => s.name);

describe('operation groups', () => {
  const tmpDirs: string[] = [];
  after(() => {
    for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
  });

  /** Write an operation YAML (plus optional sibling files) to a temp dir. */
  const writeOperation = (
    yaml: string,
    extraFiles: Record<string, string> = {},
  ): string => {
    const dir = mkdtempSync(join(tmpdir(), 'samaritan-groups-'));
    tmpDirs.push(dir);
    for (const [name, content] of Object.entries(extraFiles)) {
      writeFileSync(join(dir, name), content);
    }
    const file = join(dir, 'operation.yaml');
    writeFileSync(file, yaml);
    return file;
  };

  const HEADER = `name: Service Deployment
version: 1.0.0
groups:
  - name: web-server
    variables: { APP: web-server, REGION: from-group }
  - name: api-gateway
    variables: { APP: api-gateway }
environments:
  - name: staging
    variables: { REGION: from-env }
`;

  describe('without a selected group', () => {
    it('keeps every step and records the declared groups', async () => {
      const operation = await parseOperation(fixture);

      assert.deepEqual(
        operation.groups?.map((g) => g.name),
        ['web-server', 'api-gateway'],
      );
      assert.equal(operation.group, undefined);
      assert.equal(operation.name, 'Service Deployment');
      assert.deepEqual(stepNames(operation), [
        'Check cluster access',
        'Deploy ${APP}',
        'Purge the CDN',
        'Probe the cache',
        'Announce the release',
        'Verify rollout',
      ]);
      assert.deepEqual(operation.steps[2].groups, ['web-server']);
      // Group variables are not applied until a group is chosen.
      assert.equal(operation.variables.staging.APP, undefined);
    });
  });

  describe('projected onto a group', () => {
    it('drops the steps of other groups', async () => {
      const web = await parseOperation(fixture, { group: 'web-server' });
      assert.deepEqual(stepNames(web), [
        'Check cluster access',
        'Deploy ${APP}',
        'Purge the CDN',
        'Announce the release',
        'Verify rollout',
      ]);

      const api = await parseOperation(fixture, { group: 'api-gateway' });
      assert.deepEqual(stepNames(api), [
        'Check cluster access',
        'Deploy ${APP}',
        'Probe the cache',
        'Verify rollout',
      ]);
    });

    it('titles the operation with the group and records the selection', async () => {
      const web = await parseOperation(fixture, { group: 'web-server' });
      assert.equal(web.name, 'Service Deployment (web-server)');
      assert.equal(web.group, 'web-server');
    });

    it('adds the group variables to every environment', async () => {
      const api = await parseOperation(fixture, { group: 'api-gateway' });
      assert.equal(api.variables.staging.APP, 'api-gateway');
      assert.equal(api.variables.production.REPLICAS, 2);
      assert.equal(
        api.common_variables?.CACHE_HOST,
        'cache.${NAMESPACE}.example.com',
      );
      // The environment's own variables are still there.
      assert.equal(api.variables.production.NAMESPACE, 'production');
    });

    it('lets an environment variable override a group variable', async () => {
      const file = writeOperation(`${HEADER}steps:
  - name: Deploy
    type: manual
    command: echo \${APP} \${REGION}
`);
      const web = await parseOperation(file, { group: 'web-server' });
      assert.equal(web.variables.staging.REGION, 'from-env');
      assert.equal(web.variables.staging.APP, 'web-server');
    });

    it('lets a group variable override common_variables', async () => {
      const file = writeOperation(`${HEADER}common_variables:
  APP: default-app
  OWNER: sre-team
steps:
  - name: Deploy
    type: manual
    command: echo \${APP}
`);
      const api = await parseOperation(file, { group: 'api-gateway' });
      assert.equal(api.variables.staging.APP, 'api-gateway');
      assert.equal(api.variables.staging.OWNER, 'sre-team');
    });

    it('filters step-level rollback entries', async () => {
      const web = await parseOperation(fixture, { group: 'web-server' });
      assert.deepEqual(
        web.steps[1].rollback?.map((r) => r.name),
        ['Roll back ${APP}'],
      );
      const api = await parseOperation(fixture, { group: 'api-gateway' });
      assert.deepEqual(
        api.steps[1].rollback?.map((r) => r.name),
        ['Roll back ${APP}', 'Flush the cache after rollback'],
      );
    });

    it('filters sub-steps, operation rollback steps and rollback sub-steps', async () => {
      const file = writeOperation(`${HEADER}steps:
  - name: Deploy
    type: manual
    sub_steps:
      - name: Common sub-step
        type: manual
        command: echo common
      - name: Web sub-step
        type: manual
        groups: [web-server]
        command: echo web
rollback:
  steps:
    - name: Restore
      command: echo restore
      sub_steps:
        - name: Restore web assets
          groups: [web-server]
          command: echo assets
        - name: Restore config
          command: echo config
    - name: Flush cache
      groups: [api-gateway]
      command: echo flush
`);
      const api = await parseOperation(file, { group: 'api-gateway' });
      assert.deepEqual(
        api.steps[0].sub_steps?.map((s) => s.name),
        ['Common sub-step'],
      );
      assert.deepEqual(
        api.rollback?.steps.map((s) => s.name),
        ['Restore', 'Flush cache'],
      );
      assert.deepEqual(
        api.rollback?.steps[0].sub_steps?.map((s) => s.name),
        ['Restore config'],
      );

      const web = await parseOperation(file, { group: 'web-server' });
      assert.deepEqual(
        web.steps[0].sub_steps?.map((s) => s.name),
        ['Common sub-step', 'Web sub-step'],
      );
      assert.deepEqual(
        web.rollback?.steps.map((s) => s.name),
        ['Restore'],
      );
      assert.deepEqual(
        web.rollback?.steps[0].sub_steps?.map((s) => s.name),
        ['Restore web assets', 'Restore config'],
      );
    });

    it('does not load a uses: file that belongs to another group', async () => {
      // The file does not exist: only the api-gateway projection may fail.
      const file = writeOperation(`${HEADER}steps:
  - name: Deploy
    type: manual
    command: echo deploy
  - uses: ./missing-steps.yaml
    groups: [api-gateway]
`);
      const web = await parseOperation(file, { group: 'web-server' });
      assert.deepEqual(stepNames(web), ['Deploy']);
      await assert.rejects(parseOperation(file, { group: 'api-gateway' }));
    });

    it('filters steps inside a uses: file by group', async () => {
      const file = writeOperation(
        `${HEADER}steps:
  - uses: ./shared.yaml
`,
        {
          'shared.yaml': `- name: Shared check
  type: manual
  command: echo check
- name: Web only check
  type: manual
  groups: [web-server]
  command: echo web
`,
        },
      );
      const api = await parseOperation(file, { group: 'api-gateway' });
      assert.deepEqual(stepNames(api), ['Shared check']);
      const web = await parseOperation(file, { group: 'web-server' });
      assert.deepEqual(stepNames(web), ['Shared check', 'Web only check']);
    });
  });

  describe('errors', () => {
    it('rejects a group that is not declared', async () => {
      await assert.rejects(
        parseOperation(fixture, { group: 'batch-worker' }),
        /Group 'batch-worker' not found.*Available: web-server, api-gateway/,
      );
    });

    it('rejects --group on an operation without groups', async () => {
      await assert.rejects(
        parseOperation(getFixturePath('deployment'), { group: 'web-server' }),
        /declares no `groups:`/,
      );
    });

    it('rejects a step that names an undeclared group, with or without a selection', async () => {
      const file = writeOperation(`${HEADER}steps:
  - name: Deploy
    type: manual
    groups: [web-servr]
    command: echo deploy
`);
      for (const group of [undefined, 'web-server']) {
        await assert.rejects(parseOperation(file, { group }), (error: any) => {
          assert.equal(error.errors[0].field, 'steps[0].groups');
          assert.match(
            error.errors[0].message,
            /Unknown group\(s\): web-servr\. Declared groups: web-server, api-gateway/,
          );
          return true;
        });
      }
    });

    it('rejects step groups when the operation declares none', async () => {
      const file = writeOperation(`name: Service Deployment
version: 1.0.0
steps:
  - name: Deploy
    type: manual
    groups: [web-server]
    command: echo deploy
`);
      await assert.rejects(parseOperation(file), (error: any) => {
        assert.match(
          error.errors[0].message,
          /Unknown group\(s\): web-server\. The operation declares no top-level `groups:`/,
        );
        return true;
      });
    });

    it('rejects duplicate group names', async () => {
      const file = writeOperation(`name: Service Deployment
version: 1.0.0
groups:
  - name: web-server
  - name: web-server
steps:
  - name: Deploy
    type: manual
    command: echo deploy
`);
      await assert.rejects(parseOperation(file), /Duplicate group name/);
    });
  });

  describe('parseOperationForGroup', () => {
    it('requires a group when the operation defines groups', async () => {
      await assert.rejects(
        parseOperationForGroup(fixture),
        /defines groups \(web-server, api-gateway\)\. Choose one with --group/,
      );
    });

    it('parses the selected group', async () => {
      const operation = await parseOperationForGroup(fixture, 'api-gateway');
      assert.equal(operation.group, 'api-gateway');
    });

    it('needs no group for an operation without groups', async () => {
      const operation = await parseOperationForGroup(
        getFixturePath('deployment'),
      );
      assert.equal(operation.groups, undefined);
    });
  });
});
