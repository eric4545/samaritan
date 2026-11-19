import { COMMAND_RULES, protectedPushTargets } from './command-lint';
import type { RuleSetting } from './config';
import { EXISTING_RULES } from './existing-rules';
import { EXPECT_RULES } from './expect-consistency';
import { INSTRUCTION_RULES } from './instruction-lint';
import type { OperationRule, Rule } from './rule-types';
import { FLOW_RULES } from './step-dataflow';
import { resolveTmuxCommand } from './tools/tmux';

export type {
  CommandRule,
  OperationRule,
  Rule,
  RuleHit,
  Tier,
} from './rule-types';
export { protectedPushTargets, resolveTmuxCommand };

/** Reported by the engine for a `# samaritan-lint-…` comment it cannot use. */
export const INVALID_DIRECTIVE_RULE: OperationRule = {
  kind: 'operation',
  id: 'lint/invalid-directive',
  tier: 1,
  defaultSeverity: 'warning',
  inValidate: 'warning',
  description:
    'A `# samaritan-lint-disable…` comment naming a rule that does not exist.',
  check: () => [],
};

/** The canonical rule registry: the single source of rule ids. */
export const RULES: readonly Rule[] = [
  ...COMMAND_RULES,
  ...FLOW_RULES,
  ...EXPECT_RULES,
  ...INSTRUCTION_RULES,
  ...EXISTING_RULES,
  INVALID_DIRECTIVE_RULE,
];

export const RULE_IDS: ReadonlySet<string> = new Set(RULES.map((r) => r.id));

/**
 * Built-in presets for `extends:`.
 * - `samaritan:recommended`: the defaults (what you get without `extends`).
 * - `samaritan:strict`: the `--strict` profile, what `validate --strict`
 *   tightens, as severities.
 * - `samaritan:all`: every rule on at its preset level, opt-in rules included.
 */
export const BUILTIN_PRESETS: Record<string, Record<string, RuleSetting>> = {
  'samaritan:recommended': {},
  'samaritan:strict': Object.fromEntries(
    RULES.filter((r) => r.strictSeverity).map((r) => [
      r.id,
      r.strictSeverity as RuleSetting,
    ]),
  ),
  'samaritan:all': Object.fromEntries(
    RULES.map((r) => [
      r.id,
      r.presetSeverity ??
        (r.defaultSeverity === 'off' ? 'warning' : r.defaultSeverity),
    ]),
  ),
};

/** What the config loader needs to know about the registry. */
export const LINT_REGISTRY = { ids: RULE_IDS, presets: BUILTIN_PRESETS };
