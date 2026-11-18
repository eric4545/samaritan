import type { NormalizedCommand } from '../command-model';
import { BUILTIN_PROFILES } from './index';
import { anyVerbMatches } from './match';
import type { BinarySpec, ToolProfile } from './types';

const unique = <T>(list: T[]): T[] => [...new Set(list)];

function mergeSpec(a?: BinarySpec, b?: BinarySpec): BinarySpec | undefined {
  if (!a) return b;
  if (!b) return a;
  // Only settings `b` gives win: an unset field must not erase `a`'s.
  const defined = Object.fromEntries(
    Object.entries(b).filter(([, v]) => v !== undefined),
  ) as BinarySpec;
  return {
    ...a,
    ...defined,
    valueOptions: unique([
      ...(a.valueOptions ?? []),
      ...(b.valueOptions ?? []),
    ]),
    booleanOptions: unique([
      ...(a.booleanOptions ?? []),
      ...(b.booleanOptions ?? []),
    ]),
    attachedValueOnly: unique([
      ...(a.attachedValueOnly ?? []),
      ...(b.attachedValueOnly ?? []),
    ]),
    subcommands: { ...(a.subcommands ?? {}), ...(b.subcommands ?? {}) },
  };
}

/** Two profiles for one program: lists add up, the later spec settings win. */
function mergeProfiles(a: ToolProfile, b: ToolProfile): ToolProfile {
  return {
    id: a.id === b.id ? a.id : `${a.id}+${b.id}`,
    binaries: unique([...a.binaries, ...b.binaries]),
    spec: mergeSpec(a.spec, b.spec),
    verbDepth: b.verbDepth ?? a.verbDepth,
    mutating: [...(a.mutating ?? []), ...(b.mutating ?? [])],
    backup: [...(a.backup ?? []), ...(b.backup ?? [])],
    deletesData: [...(a.deletesData ?? []), ...(b.deletesData ?? [])],
    resourceOptions: unique([
      ...(a.resourceOptions ?? []),
      ...(b.resourceOptions ?? []),
    ]),
    resourceOperands: b.resourceOperands ?? a.resourceOperands,
    output:
      a.output || b.output
        ? {
            options: unique([
              ...(a.output?.options ?? []),
              ...(b.output?.options ?? []),
            ]),
            default: b.output?.default ?? a.output?.default,
            textOptions: unique([
              ...(a.output?.textOptions ?? []),
              ...(b.output?.textOptions ?? []),
            ]),
          }
        : undefined,
  };
}

/** Option names whose value names a resource, for every program. */
const GENERIC_ID_OPTION =
  /^--(stack-name|[a-z-]*-ids?|[a-z-]*-identifier|[a-z-]*-name|[a-z-]*-arn|bucket|key)$/;

/**
 * What lint knows about programs: the built-in profiles plus a team's
 * `lint.tools`, merged per program name.
 */
export class ToolRegistry {
  private byBinary = new Map<string, ToolProfile>();

  constructor(private readonly profiles: readonly ToolProfile[]) {
    for (const profile of profiles) {
      for (const binary of profile.binaries) {
        const known = this.byBinary.get(binary);
        this.byBinary.set(
          binary,
          known ? mergeProfiles(known, profile) : profile,
        );
      }
    }
  }

  /** A registry with more profiles applied on top of this one's. */
  with(profiles: readonly ToolProfile[]): ToolRegistry {
    if (profiles.length === 0) return this;
    return new ToolRegistry([...this.profiles, ...profiles]);
  }

  profile(executable: string): ToolProfile | undefined {
    return this.byBinary.get(executable);
  }

  /** Every program some profile describes. */
  binaries(): string[] {
    return [...this.byBinary.keys()];
  }

  /** How `executable`'s options parse (bound, so it can be passed around). */
  specOf = (executable: string): BinarySpec | undefined =>
    this.byBinary.get(executable)?.spec;

  isMutating(cmd: NormalizedCommand): boolean {
    return anyVerbMatches(this.profile(cmd.executable)?.mutating, cmd);
  }

  isBackup(cmd: NormalizedCommand): boolean {
    return anyVerbMatches(this.profile(cmd.executable)?.backup, cmd);
  }

  isDataDeletion(cmd: NormalizedCommand): boolean {
    return anyVerbMatches(this.profile(cmd.executable)?.deletesData, cmd);
  }

  /** How many operands name the action (`aws rds delete-db-instance`: 2). */
  verbDepth(cmd: NormalizedCommand): number {
    return this.profile(cmd.executable)?.verbDepth ?? 1;
  }

  /**
   * Resource identifiers a command names where they are written statically
   * (`--stack-name web`, `kubectl delete pvc data-0`, `s3://bucket`).
   * Placeholders (`${DB}`) count as written: two steps naming `${DB}` name
   * the same resource.
   */
  resourceIds(cmd: NormalizedCommand): string[] {
    const profile = this.profile(cmd.executable);
    const extra = new Set(profile?.resourceOptions ?? []);
    const ids = cmd.options
      .filter(
        (o) => o.value && (GENERIC_ID_OPTION.test(o.name) || extra.has(o.name)),
      )
      .map((o) => o.value as string);
    const operands = profile?.resourceOperands;
    if (operands?.index !== undefined) {
      const kind = cmd.operands[operands.index - 1];
      if (kind?.includes('/')) ids.push(kind.split('/')[1]);
      else if (cmd.operands[operands.index])
        ids.push(cmd.operands[operands.index]);
    }
    if (operands?.matches !== undefined) {
      const re = new RegExp(operands.matches);
      ids.push(...cmd.operands.filter((w) => re.test(w)));
    }
    return ids;
  }

  /** `json`, `jsonpath`, `text`, … as the command declares it, else undefined. */
  outputFormat(cmd: NormalizedCommand | undefined): string | undefined {
    if (!cmd) return undefined;
    const output = this.profile(cmd.executable)?.output;
    if (!output) return undefined;
    if (
      output.textOptions?.some((t) => cmd.options.some((o) => o.name === t))
    ) {
      return 'text';
    }
    const value = cmd.options.find((o) =>
      output.options?.includes(o.name),
    )?.value;
    if (value) {
      // `-o=json`, `jsonpath={.x}`, `custom-columns=NAME:.x` → the format name.
      return value.replace(/^=/, '').split(/[={]/)[0];
    }
    return output.default;
  }
}

/** The built-in profiles only. */
export const BUILTIN_TOOLS = new ToolRegistry(BUILTIN_PROFILES);
