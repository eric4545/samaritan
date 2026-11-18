import { hasOption, type NormalizedCommand } from './command-model';

/** `aws <service> <operation>` → the operation, else ''. */
export function awsOperation(cmd: NormalizedCommand): string {
  return cmd.executable === 'aws' ? (cmd.operands[1] ?? '') : '';
}

const AWS_MUTATING_PREFIXES = [
  'create-',
  'delete-',
  'update-',
  'put-',
  'modify-',
  'terminate-',
  'start-',
  'stop-',
  'reboot-',
  'run-',
  'attach-',
  'detach-',
  'associate-',
  'disassociate-',
  'register-',
  'deregister-',
  'enable-',
  'disable-',
  'import-',
  'restore-',
  'reset-',
  'set-',
  'tag-',
  'untag-',
  'add-',
  'remove-',
  'execute-',
  'deploy',
  'invoke',
  'publish',
  'send-',
  'cancel-',
  'authorize-',
  'revoke-',
  'replace-',
  'promote-',
  'failover-',
];
const S3_MUTATING = new Set(['cp', 'mv', 'rm', 'sync', 'mb', 'rb']);
const KUBECTL_MUTATING = new Set([
  'apply',
  'create',
  'delete',
  'patch',
  'replace',
  'edit',
  'scale',
  'annotate',
  'label',
  'taint',
  'cordon',
  'uncordon',
  'drain',
  'set',
  'expose',
  'autoscale',
]);
const ROLLOUT_MUTATING = new Set(['restart', 'undo', 'pause', 'resume']);
const SQL_MUTATING =
  /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke)\b/i;
const REDIS_MUTATING = new Set([
  'SET',
  'DEL',
  'FLUSHALL',
  'FLUSHDB',
  'EXPIRE',
  'HSET',
  'HDEL',
  'LPUSH',
  'RPUSH',
  'SADD',
  'SREM',
  'ZADD',
  'ZREM',
  'RENAME',
  'CONFIG',
]);
const ALWAYS_MUTATING = new Set([
  'rm',
  'rmdir',
  'mv',
  'truncate',
  'chmod',
  'chown',
  'dd',
  'kill',
  'pkill',
  'killall',
  'reboot',
  'shutdown',
  'dropdb',
  'createdb',
]);

/** Does this command change state (a heuristic, used by tier-3 rules)? */
export function isMutating(cmd: NormalizedCommand): boolean {
  const [sub, second] = cmd.operands;
  switch (cmd.executable) {
    case 'aws': {
      if (sub === 's3') return S3_MUTATING.has(second ?? '');
      const op = second ?? '';
      return AWS_MUTATING_PREFIXES.some((p) => op.startsWith(p));
    }
    case 'kubectl':
    case 'oc':
      return (
        KUBECTL_MUTATING.has(sub ?? '') ||
        (sub === 'rollout' && ROLLOUT_MUTATING.has(second ?? ''))
      );
    case 'helm':
      return ['install', 'upgrade', 'uninstall', 'delete', 'rollback'].includes(
        sub ?? '',
      );
    case 'git':
      return ['push', 'commit', 'merge', 'rebase', 'reset', 'revert'].includes(
        sub ?? '',
      );
    case 'systemctl':
      return [
        'start',
        'stop',
        'restart',
        'reload',
        'enable',
        'disable',
        'mask',
        'kill',
      ].includes(sub ?? '');
    case 'service':
      return ['start', 'stop', 'restart', 'reload'].includes(second ?? '');
    case 'terraform':
    case 'tofu':
      return ['apply', 'destroy', 'import', 'taint'].includes(sub ?? '');
    case 'docker':
    case 'podman':
      return ['run', 'rm', 'stop', 'kill', 'restart', 'push', 'rmi'].includes(
        sub ?? '',
      );
    case 'psql':
    case 'mysql':
    case 'mariadb': {
      const sql = cmd.options.find((o) => ['-c', '-e'].includes(o.name))?.value;
      return sql !== undefined && SQL_MUTATING.test(sql);
    }
    case 'redis-cli':
      return cmd.operands.some((w) => REDIS_MUTATING.has(w.toUpperCase()));
    case 'crontab':
      return hasOption(cmd, '-r') || cmd.operands.length > 0;
    case 'sed':
      return hasOption(cmd, '-i') || hasOption(cmd, '--in-place');
    default:
      return ALWAYS_MUTATING.has(cmd.executable);
  }
}

/** Does this command take a backup or a snapshot (presence heuristic)? */
export function isBackup(cmd: NormalizedCommand): boolean {
  const op = awsOperation(cmd);
  if (/snapshot|backup/.test(op)) return true;
  if (
    ['pg_dump', 'pg_dumpall', 'mysqldump', 'mongodump'].includes(cmd.executable)
  )
    return true;
  if (cmd.executable === 'velero' && cmd.operands[0] === 'backup') return true;
  if (cmd.executable === 'crontab' && hasOption(cmd, '-l')) {
    return cmd.redirects.some((r) => r.op.endsWith('>') || r.op.endsWith('>>'));
  }
  return [...cmd.operands, ...cmd.redirects.map((r) => r.target)].some((w) =>
    /backup|snapshot|\.bak\b/i.test(w),
  );
}

/** Deletions of data that a backup should precede. */
export function isDataDeletion(cmd: NormalizedCommand): boolean {
  const op = awsOperation(cmd);
  if (
    [
      'delete-volume',
      'delete-db-instance',
      'delete-db-cluster',
      'delete-stack',
      'delete-table',
      'delete-file-system',
      'delete-bucket',
      'delete-cache-cluster',
      'delete-replication-group',
    ].includes(op)
  )
    return true;
  if (cmd.executable === 'aws' && cmd.operands[0] === 's3') {
    return (
      cmd.operands[1] === 'rb' ||
      (cmd.operands[1] === 'rm' && hasOption(cmd, '--recursive'))
    );
  }
  if (cmd.executable === 'kubectl' && cmd.operands[0] === 'delete') {
    const kind = (cmd.operands[1] ?? '').split('/')[0];
    return [
      'pvc',
      'pv',
      'persistentvolumeclaim',
      'persistentvolumeclaims',
      'persistentvolume',
      'persistentvolumes',
      'statefulset',
      'statefulsets',
      'sts',
    ].includes(kind);
  }
  if (cmd.executable === 'dropdb') return true;
  if (['psql', 'mysql', 'mariadb'].includes(cmd.executable)) {
    const sql = cmd.options.find((o) => ['-c', '-e'].includes(o.name))?.value;
    return sql !== undefined && /\b(drop|truncate)\b/i.test(sql);
  }
  return false;
}

/** Shell variable names (not SAMARITAN ones) referenced in a word. */
export function shellVarsIn(
  word: string,
  declared: ReadonlySet<string>,
): string[] {
  const names: string[] = [];
  for (const m of word.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (!declared.has(m[1])) names.push(m[1]);
  }
  return names;
}

/** Last path component, without quotes. */
export function baseName(path: string): string {
  const clean = path.replace(/^["']|["']$/g, '');
  return clean.slice(clean.lastIndexOf('/') + 1);
}

/** `kubectl delete`, `aws rds delete-db-instance`: program + subcommand, no values. */
export function describeCommand(cmd: NormalizedCommand): string {
  const words = cmd.operands
    .slice(0, cmd.executable === 'aws' ? 2 : 1)
    .filter((w) => !w.includes('$') && !w.includes('…'));
  return [cmd.executable, ...words].join(' ');
}

const ID_OPTION =
  /^--(stack-name|[a-z-]*-ids?|[a-z-]*-identifier|[a-z-]*-name|[a-z-]*-arn|bucket|key)$/;

/**
 * Resource identifiers a command names, where they are written statically:
 * `--stack-name web`, `--db-instance-identifier db`, `--volume-id vol-1`,
 * `kubectl delete pvc data-web-0`. Placeholders (`${DB}`) count as written:
 * two steps naming `${DB}` name the same resource.
 */
export function resourceIds(cmd: NormalizedCommand): string[] {
  const ids = cmd.options
    .filter((o) => ID_OPTION.test(o.name) && o.value)
    .map((o) => o.value as string);
  if (['kubectl', 'oc'].includes(cmd.executable)) {
    const [, kind, name] = cmd.operands;
    if (kind?.includes('/')) ids.push(kind.split('/')[1]);
    else if (name) ids.push(name);
  }
  if (cmd.executable === 'aws' && cmd.operands[0] === 's3') {
    ids.push(...cmd.operands.slice(2).filter((w) => w.startsWith('s3://')));
  }
  return ids;
}

/** Does `cmd` mention any of `ids` (as an option value or a word)? */
export function mentionsAny(cmd: NormalizedCommand, ids: string[]): boolean {
  const words = [
    ...cmd.operands,
    ...cmd.options.map((o) => o.value ?? ''),
    ...cmd.redirects.map((r) => r.target),
  ];
  return ids.some((id) => words.some((w) => w === id || w.includes(id)));
}
