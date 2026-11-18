import type { ToolProfile } from './types';

export const GIT: ToolProfile = {
  id: 'git',
  binaries: ['git'],
  spec: {
    // Global options before the subcommand; their values are not operands.
    valueOptions: [
      '-C',
      '-c',
      '--git-dir',
      '--work-tree',
      '--namespace',
      '--super-prefix',
      '--config-env',
    ],
    subcommands: {
      push: {
        combineShort: true,
        valueOptions: [
          '-o',
          '--push-option',
          '--repo',
          '--receive-pack',
          '--exec',
        ],
      },
      add: { combineShort: true, valueOptions: ['--chmod'] },
      commit: {
        combineShort: true,
        valueOptions: [
          '-m',
          '-F',
          '-c',
          '-C',
          '-t',
          '--message',
          '--file',
          '--author',
          '--date',
        ],
      },
    },
    subcommandDefault: { combineShort: true },
  },
  mutating: ['push|commit|merge|rebase|reset|revert'],
};
