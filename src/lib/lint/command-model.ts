import {
  type Assignment,
  type CommandContext,
  parseShell,
  type Redirect,
  type SimpleCommand,
} from './shell-lexer';

/**
 * A simple command split into what lint rules and `banned:` / `required:`
 * patterns match against: executable, assignments, options (with values),
 * operands and redirects.
 */
export interface CommandOption {
  name: string;
  value?: string;
}

export interface NormalizedCommand {
  /** Basename of the program run, after wrappers (`sudo`, `env`, …). */
  executable: string;
  /** The program as written (`./deploy.sh`, `/usr/bin/git`). */
  program: string;
  /** Wrappers in front of it, e.g. `['sudo']`, `['exec']`. */
  wrappers: string[];
  assignments: Assignment[];
  options: CommandOption[];
  /** Non-option words; for git/tmux/aws the subcommand is `operands[0]`. */
  operands: string[];
  redirects: Redirect[];
  context: CommandContext;
  line: number;
  /** Operator before this command (`&&`, `||`, `|`, `;`, …; '' at the start). */
  prefix: string;
}

interface BinarySpec {
  /** Options that take the next word (or `=value`) as their value. */
  valueOptions?: string[];
  /** Every `--long` option takes a value unless listed in `booleanOptions`. */
  longTakesValue?: boolean;
  booleanOptions?: string[];
  /** Short options whose value can only be attached (`-psecret`). */
  attachedValueOnly?: string[];
  /** `-abc` means `-a -b -c`. */
  combineShort?: boolean;
  /** Spec that applies after the first operand (the subcommand). */
  subcommands?: Record<string, BinarySpec>;
}

const GIT_SUB_DEFAULT: BinarySpec = { combineShort: true };

const SPECS: Record<string, BinarySpec> = {
  git: {
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
  },
  tmux: {
    valueOptions: ['-L', '-S', '-f', '-c', '-T'],
    combineShort: true,
  },
  aws: {
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
  mysql: {
    valueOptions: ['-u', '-h', '-P', '-e', '-D', '--user', '--host'],
    attachedValueOnly: ['-p'],
  },
  kubectl: {
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
  set: { valueOptions: ['-o'], combineShort: true },
  bash: { valueOptions: ['-c', '-o', '-O'], combineShort: false },
  ssh: {
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
  rm: { combineShort: true },
  curl: {
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
  wget: { valueOptions: ['-O', '-o', '-P', '--output-document'] },
  sed: { valueOptions: ['-e', '-f'], attachedValueOnly: ['-i'] },
  chmod: {},
};
SPECS.mariadb = SPECS.mysql;
SPECS.mysqldump = SPECS.mysql;
SPECS.mysqladmin = SPECS.mysql;
SPECS.sh = SPECS.bash;
SPECS.zsh = SPECS.bash;
SPECS.dash = SPECS.bash;

/** Wrappers and the options of theirs that take a value. */
const WRAPPERS: Record<string, string[]> = {
  sudo: ['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-U'],
  doas: ['-u', '-C'],
  env: ['-u', '-C', '-S'],
  nohup: [],
  time: [],
  command: [],
  exec: ['-a'],
  nice: ['-n'],
  timeout: ['-s', '-k', '--signal', '--kill-after'],
};

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

function basename(word: string): string {
  const slash = word.lastIndexOf('/');
  return slash === -1 ? word : word.slice(slash + 1);
}

/** Strip wrappers; returns the wrapped argv and any `env NAME=v` assignments. */
function unwrap(argv: string[]): {
  argv: string[];
  wrappers: string[];
  assignments: Assignment[];
} {
  const wrappers: string[] = [];
  const assignments: Assignment[] = [];
  let rest = argv;
  while (rest.length > 0 && basename(rest[0]) in WRAPPERS) {
    const name = basename(rest[0]);
    const valued = WRAPPERS[name];
    wrappers.push(name);
    rest = rest.slice(1);
    while (rest.length > 0 && rest[0].startsWith('-') && rest[0] !== '-') {
      const flag = rest[0];
      rest = rest.slice(1);
      if (flag === '--') break;
      if (valued.includes(flag) && rest.length > 0) rest = rest.slice(1);
    }
    if (name === 'env') {
      while (rest.length > 0 && ASSIGNMENT.test(rest[0])) {
        const eq = rest[0].indexOf('=');
        assignments.push({
          name: rest[0].slice(0, eq),
          value: rest[0].slice(eq + 1),
        });
        rest = rest.slice(1);
      }
    }
    // `timeout 30 cmd`: the duration is an operand of timeout, not the program.
    if (name === 'timeout' && rest.length > 0) rest = rest.slice(1);
  }
  return { argv: rest, wrappers, assignments };
}

function takesValue(spec: BinarySpec, name: string, next?: string): boolean {
  if (spec.valueOptions?.includes(name)) return next !== undefined;
  if (
    spec.longTakesValue &&
    name.startsWith('--') &&
    !spec.booleanOptions?.includes(name)
  ) {
    return next !== undefined && !next.startsWith('-');
  }
  return false;
}

/** Split argv (after the executable) into options and operands. */
function splitArgs(
  args: string[],
  rootSpec: BinarySpec,
): { options: CommandOption[]; operands: string[] } {
  const options: CommandOption[] = [];
  const operands: string[] = [];
  let spec = rootSpec;
  let endOfOptions = false;

  for (let k = 0; k < args.length; k++) {
    const word = args[k];
    const next = args[k + 1];
    if (endOfOptions || word === '-' || !word.startsWith('-')) {
      if (operands.length === 0 && spec.subcommands) {
        spec = spec.subcommands[word] ?? GIT_SUB_DEFAULT;
      }
      operands.push(word);
      continue;
    }
    if (word === '--') {
      endOfOptions = true;
      continue;
    }
    if (word.startsWith('--')) {
      const eq = word.indexOf('=');
      if (eq !== -1) {
        options.push({ name: word.slice(0, eq), value: word.slice(eq + 1) });
      } else if (takesValue(spec, word, next)) {
        options.push({ name: word, value: next });
        k++;
      } else {
        options.push({ name: word });
      }
      continue;
    }
    // Short option(s).
    const head = word.slice(0, 2);
    if (spec.attachedValueOnly?.includes(head)) {
      options.push(
        word.length > 2 ? { name: head, value: word.slice(2) } : { name: head },
      );
      continue;
    }
    if (word.length > 2 && spec.combineShort) {
      for (let c = 1; c < word.length; c++) {
        const name = `-${word[c]}`;
        if (spec.valueOptions?.includes(name)) {
          const attached = word.slice(c + 1);
          if (attached) options.push({ name, value: attached });
          else {
            options.push({ name, value: next });
            if (next !== undefined) k++;
          }
          break;
        }
        options.push({ name });
      }
      continue;
    }
    if (word.length > 2 && spec.valueOptions?.includes(head)) {
      options.push({ name: head, value: word.slice(2) });
      continue;
    }
    if (takesValue(spec, word, next)) {
      options.push({ name: word, value: next });
      k++;
      continue;
    }
    options.push({ name: word });
  }
  return { options, operands };
}

export function normalizeCommand(cmd: SimpleCommand): NormalizedCommand {
  const { argv, wrappers, assignments } = unwrap(cmd.argv);
  const executable = argv.length > 0 ? basename(argv[0]) : '';
  const { options, operands } = splitArgs(
    argv.slice(1),
    SPECS[executable] ?? {},
  );
  return {
    executable,
    program: argv[0] ?? '',
    wrappers,
    assignments: [...cmd.assignments, ...assignments],
    options,
    operands,
    redirects: cmd.redirects,
    context: cmd.context,
    line: cmd.line,
    prefix: cmd.prefix,
  };
}

/** Parse and normalize every simple command in a shell text. */
export function parseCommands(text: string): {
  commands: NormalizedCommand[];
  unsupported: string[];
} {
  const parsed = parseShell(text);
  return {
    commands: parsed.commands.map(normalizeCommand),
    unsupported: parsed.unsupported,
  };
}

export function hasOption(cmd: NormalizedCommand, name: string): boolean {
  return cmd.options.some((o) => o.name === name);
}

/**
 * A `banned:` / `required:` pattern, parsed with the same lexer as commands.
 * Every part must be present: the executable, each assignment (name; value
 * too when the pattern gives one), each option (and its value when given),
 * and the operands as a prefix in order. `*` is a whole-token wildcard.
 */
export function compilePattern(pattern: string): NormalizedCommand {
  const parsed = parseShell(pattern);
  if (parsed.commands.length !== 1) {
    throw new Error(`pattern must be one simple command: '${pattern}'`);
  }
  return normalizeCommand(parsed.commands[0]);
}

const tokenMatches = (want: string, have: string | undefined): boolean =>
  want === '*' ? have !== undefined : want === have;

export function matchesPattern(
  pattern: NormalizedCommand,
  cmd: NormalizedCommand,
): boolean {
  if (pattern.executable && !tokenMatches(pattern.executable, cmd.executable)) {
    return false;
  }
  for (const a of pattern.assignments) {
    const found = cmd.assignments.find((b) => b.name === a.name);
    if (!found) return false;
    if (a.value !== '' && !tokenMatches(a.value, found.value)) return false;
  }
  for (const o of pattern.options) {
    const found = cmd.options.some(
      (b) =>
        b.name === o.name &&
        (o.value === undefined || tokenMatches(o.value, b.value)),
    );
    if (!found) return false;
  }
  return pattern.operands.every((op, k) => tokenMatches(op, cmd.operands[k]));
}
