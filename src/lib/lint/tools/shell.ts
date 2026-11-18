import type { ToolProfile } from './types';

/** Programs that change state whatever their arguments. */
export const FILE_AND_PROCESS: ToolProfile = {
  id: 'coreutils',
  binaries: [
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
  ],
  mutating: [''],
};

export const RM: ToolProfile = {
  id: 'rm',
  binaries: ['rm'],
  spec: { combineShort: true },
};

export const CRONTAB: ToolProfile = {
  id: 'crontab',
  binaries: ['crontab'],
  // `crontab -r`, or `crontab <file>` / `crontab -` (replace).
  mutating: [{ option: '-r' }, '*'],
  backup: [{ option: '-l', redirect: true }],
};

export const SED: ToolProfile = {
  id: 'sed',
  binaries: ['sed'],
  spec: { valueOptions: ['-e', '-f'], attachedValueOnly: ['-i'] },
  mutating: [{ option: '-i' }, { option: '--in-place' }],
};

export const SET: ToolProfile = {
  id: 'set',
  binaries: ['set'],
  spec: { valueOptions: ['-o'], combineShort: true },
};

export const SHELLS: ToolProfile = {
  id: 'shells',
  binaries: ['bash', 'sh', 'zsh', 'dash'],
  spec: { valueOptions: ['-c', '-o', '-O'], combineShort: false },
};

export const SSH: ToolProfile = {
  id: 'ssh',
  binaries: ['ssh'],
  spec: {
    valueOptions: [
      '-p',
      '-i',
      '-l',
      '-o',
      '-F',
      '-J',
      '-L',
      '-R',
      '-D',
      '-b',
      '-c',
      '-E',
      '-e',
      '-I',
      '-m',
      '-O',
      '-Q',
      '-S',
      '-W',
      '-w',
      '-B',
    ],
    combineShort: true,
  },
};

export const CURL: ToolProfile = {
  id: 'curl',
  binaries: ['curl'],
  spec: {
    combineShort: true,
    valueOptions: [
      '-o',
      '-X',
      '-H',
      '-d',
      '-u',
      '-A',
      '-e',
      '-w',
      '-m',
      '-T',
      '-F',
      '-b',
      '-c',
      '-x',
      '-K',
      '-E',
      '-r',
      '-C',
      '-y',
      '-Y',
      '-z',
      '--output',
      '--request',
      '--header',
      '--data',
      '--data-raw',
      '--data-binary',
      '--user',
      '--user-agent',
      '--write-out',
      '--max-time',
      '--connect-timeout',
      '--retry',
      '--upload-file',
      '--form',
      '--cookie',
      '--proxy',
      '--cacert',
      '--cert',
      '--key',
    ],
  },
};

export const WGET: ToolProfile = {
  id: 'wget',
  binaries: ['wget'],
  spec: { valueOptions: ['-O', '-o', '-P', '--output-document'] },
};

export const JQ: ToolProfile = {
  id: 'jq',
  binaries: ['jq'],
  output: { default: 'json', textOptions: ['-r', '--raw-output', '-j'] },
};
