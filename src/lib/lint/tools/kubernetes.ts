import type { ToolProfile } from './types';

/** Kinds whose deletion takes everything under them along. */
export const CLUSTER_SCOPED_KINDS = new Set([
  'ns',
  'namespace',
  'namespaces',
  'pv',
  'persistentvolume',
  'persistentvolumes',
  'no',
  'node',
  'nodes',
  'clusterrole',
  'clusterroles',
  'clusterrolebinding',
  'clusterrolebindings',
  'crd',
  'crds',
  'customresourcedefinition',
  'customresourcedefinitions',
  'sc',
  'storageclass',
  'storageclasses',
]);

export const KUBECTL: ToolProfile = {
  id: 'kubectl',
  binaries: ['kubectl', 'oc'],
  spec: {
    valueOptions: [
      '-n',
      '-o',
      '-l',
      '-f',
      '-c',
      '--context',
      '--namespace',
      '--kubeconfig',
      '--selector',
      '--output',
      '--filename',
      '--container',
    ],
  },
  mutating: [
    'apply|create|delete|patch|replace|edit|scale|annotate|label|taint|cordon|uncordon|drain|set|expose|autoscale',
    'rollout restart|undo|pause|resume',
  ],
  // `--dry-run=client|server` (and the old bare `--dry-run`) changes nothing;
  // `--dry-run=none` is a real run.
  dryRun: [{ option: '--dry-run', matches: '^(?!none$)' }],
  deletesData: [
    'delete pvc|pv|persistentvolumeclaim|persistentvolumeclaims|persistentvolume|persistentvolumes|statefulset|statefulsets|sts',
  ],
  resourceOperands: { index: 2 },
  output: { options: ['-o', '--output'] },
};

export const HELM: ToolProfile = {
  id: 'helm',
  binaries: ['helm'],
  mutating: ['install|upgrade|uninstall|delete|rollback'],
};

export const VELERO: ToolProfile = {
  id: 'velero',
  binaries: ['velero'],
  backup: ['backup'],
};
