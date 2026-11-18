import type { NormalizedCommand } from '../command-model';
import type { ToolProfile } from './types';

/** `aws <service> <operation>` → the operation, else ''. */
export function awsOperation(cmd: NormalizedCommand): string {
  return cmd.executable === 'aws' ? (cmd.operands[1] ?? '') : '';
}

/** `aws <svc> create-*` operations that are operational actions, not resources. */
export const AWS_CREATE_ALLOWLIST = [
  'create-snapshot',
  'create-snapshots',
  'create-db-snapshot',
  'create-db-cluster-snapshot',
  'create-cluster-snapshot',
  'create-backup',
  'create-tags',
  'create-application-version',
  'create-user',
  'create-login-profile',
  'create-invalidation',
  'create-image',
];

export const AWS: ToolProfile = {
  id: 'aws',
  binaries: ['aws'],
  verbDepth: 2,
  spec: {
    longTakesValue: true,
    booleanOptions: [
      '--no-cli-pager',
      '--debug',
      '--no-verify-ssl',
      '--no-paginate',
      '--no-sign-request',
      '--dry-run',
      '--no-dry-run',
      '--cli-auto-prompt',
      '--no-cli-auto-prompt',
      '--recursive',
      '--quiet',
      '--only-show-errors',
      '--no-progress',
      '--human-readable',
      '--summarize',
      '--force',
      '--delete',
    ],
  },
  mutating: [
    's3 cp|mv|rm|sync|mb|rb',
    // `aws <service> <verb>-…` (s3 high-level commands are listed above).
    '* create-*|delete-*|update-*|put-*|modify-*|terminate-*|start-*|stop-*|reboot-*|run-*|attach-*|detach-*|associate-*|disassociate-*|register-*|deregister-*|enable-*|disable-*|import-*|restore-*|reset-*|set-*|tag-*|untag-*|add-*|remove-*|execute-*|deploy*|invoke*|publish*|send-*|cancel-*|authorize-*|revoke-*|replace-*|promote-*|failover-*',
  ],
  backup: ['* *snapshot*|*backup*'],
  deletesData: [
    '* delete-volume|delete-db-instance|delete-db-cluster|delete-stack|delete-table|delete-file-system|delete-bucket|delete-cache-cluster|delete-replication-group',
    's3 rb',
    { verb: 's3 rm', option: '--recursive' },
  ],
  resourceOperands: { matches: '^s3://' },
  output: { options: ['--output'] },
};
