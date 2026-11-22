/**
 * Tool profiles: what lint knows about one command-line tool, as data.
 *
 * A profile is the plugin unit. Built-in profiles live next to this file
 * (one module per tool family); a team adds its own, or extends a built-in
 * one, with `lint.tools` in `samaritan.config.yaml` (and shares them through
 * `extends:` presets). Rules never name a tool's verbs or options themselves:
 * they ask the registry (`registry.ts`).
 */

/** How a program's options parse. */
export interface BinarySpec {
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
  /** Spec for a subcommand not listed in `subcommands`. */
  subcommandDefault?: BinarySpec;
}

/**
 * Which invocations a profile entry means. A string is `{ verb }`. Every
 * condition given must hold.
 *
 * `verb`: words matched against the start of the operands, in order. In a
 * word, `*` is any text and `|` separates alternatives (`delete-*`,
 * `pvc|pv`); a lone `*` is any one word; `''` matches any invocation. A word
 * like `pvc/data-0` is matched by its part before `/` too (kubectl
 * `kind/name`).
 */
export type Verb =
  | string
  | {
      verb?: string;
      /** This option is present (and its value matches `matches`, a regex). */
      option?: string;
      matches?: string;
      /** Some operand is one of these words (case-insensitive). */
      anyOperand?: string[];
      /** The command writes its output to a file (`> file`). */
      redirect?: boolean;
    };

export interface ToolProfile {
  /** Short name, for messages and merging (`kubectl`). */
  id: string;
  /** Program names it applies to (`kubectl`, `oc`). */
  binaries: string[];
  spec?: BinarySpec;
  /** How many operands name the action (`aws rds delete-db-instance`: 2). */
  verbDepth?: number;
  /** Invocations that change state. */
  mutating?: Verb[];
  /**
   * Invocations that only preview a change (`kubectl … --dry-run=client`):
   * never mutating, whatever `mutating` says.
   */
  dryRun?: Verb[];
  /** Invocations that take a backup or snapshot. */
  backup?: Verb[];
  /** Invocations that delete data a backup should precede. */
  deletesData?: Verb[];
  /** Options whose value names a resource (`--stack-name`). */
  resourceOptions?: string[];
  /**
   * Operands that name a resource: by index (kubectl: 2, `kind name`; also
   * the name in `kind/name`), or every operand matching a regex (`^s3://`).
   */
  resourceOperands?: { index?: number; matches?: string };
  /** How the command declares its output format. */
  output?: {
    /** Option whose value is the format (`-o`, `--output`). */
    options?: string[];
    /** Format when no option says otherwise (`jq`: json). */
    default?: string;
    /** Options that make the output plain text (`jq -r`). */
    textOptions?: string[];
  };
}
