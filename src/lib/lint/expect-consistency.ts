import type { NormalizedCommand } from './command-model';
import {
  expectChecks,
  type OperationRule,
  type RuleHit,
  type StepInfo,
  stepAt,
} from './rule-types';

const LITERAL_FIELDS = [
  'contains',
  'not_contains',
  'any_line_contains',
  'no_line_contains',
];
const REGEX_FIELDS = [
  'matches',
  'all_lines_match',
  'any_line_matches',
  'no_line_matches',
];
/** Regex syntax that means nothing in a literal comparison. */
const REGEX_SYNTAX =
  /\.\*|\.\+|\\[dswDSWb.]|\[[^\]]*-[^\]]*\]|^\^|[^\\]\$$|\(\?|\|/;
const REGEX_META = /[.*+?^${}()|[\]\\]/;

const hit = (info: StepInfo, message: string): RuleHit => ({
  message: `${stepAt(info)}: ${message}`,
  step: info.step,
  field: 'expect',
});

const containsVsMatches: OperationRule = {
  kind: 'operation',
  id: 'expect/contains-vs-matches',
  tier: 3,
  defaultSeverity: 'warning',
  inValidate: 'warning',
  description:
    'A literal check (`contains`, `any_line_contains`, …) holding regex syntax (`.*`, `\\d`, `^…$`), or a regex check holding no regex syntax at all. Reports how the value is compared; it never suggests switching (a literal `[ERROR]` is valid).',
  check(ctx) {
    const hits: RuleHit[] = [];
    for (const info of ctx.all) {
      for (const check of expectChecks(info.step.expect)) {
        for (const field of LITERAL_FIELDS) {
          const value = check[field];
          if (typeof value === 'string' && REGEX_SYNTAX.test(value)) {
            hits.push(
              hit(
                info,
                `\`${field}: ${JSON.stringify(value)}\` is compared as literal text, character for character; regex syntax in it is not interpreted`,
              ),
            );
          }
        }
        for (const field of REGEX_FIELDS) {
          const value = check[field];
          if (typeof value === 'string' && !REGEX_META.test(value)) {
            hits.push(
              hit(
                info,
                `\`${field}: ${JSON.stringify(value)}\` has no regex syntax and is unanchored: it passes wherever the text appears in the output`,
              ),
            );
          }
        }
      }
    }
    return hits;
  },
};

/** The command whose output the step's `expect` sees (last top-level one). */
function outputCommand(info: StepInfo): NormalizedCommand | undefined {
  const top = info.commands.filter((c) => c.context !== 'substitution');
  return top[top.length - 1];
}

const TEXT_FIELDS = [...LITERAL_FIELDS, ...REGEX_FIELDS, 'equals'];

const jsonShape: OperationRule = {
  kind: 'operation',
  id: 'expect/json-shape',
  tier: 3,
  defaultSeverity: 'warning',
  inValidate: 'warning',
  description:
    'An `expect` that contradicts the output format the command declares: a JSON fragment (`"key": value`) or `equals` checked as text against `--output json` / `-o json`, or `jsonpath` on output that is not JSON (`-o jsonpath=…`, `--output text`, `jq -r`).',
  check(ctx) {
    const hits: RuleHit[] = [];
    for (const info of ctx.all) {
      const format = ctx.tools.outputFormat(outputCommand(info));
      if (!format) continue;
      for (const check of expectChecks(info.step.expect)) {
        if (format === 'json' && check.jsonpath === undefined) {
          for (const field of TEXT_FIELDS) {
            const value = check[field];
            if (typeof value !== 'string') continue;
            if (field === 'equals' || /"\s*:/.test(value)) {
              hits.push(
                hit(
                  info,
                  `the command prints JSON; \`${field}: ${JSON.stringify(value)}\` depends on the printer's spacing and key order (\`jsonpath:\` reads one value)`,
                ),
              );
            }
          }
        }
        if (
          format !== 'json' &&
          format !== 'yaml' &&
          check.jsonpath !== undefined
        ) {
          hits.push(
            hit(
              info,
              `\`jsonpath: ${check.jsonpath}\` parses the output as JSON, but the command prints \`${format}\``,
            ),
          );
        }
      }
    }
    return hits;
  },
};

const multilineContains: OperationRule = {
  kind: 'operation',
  id: 'expect/multiline-contains',
  tier: 3,
  defaultSeverity: 'warning',
  inValidate: 'warning',
  description:
    'A substring check spanning several lines: it matches only if those lines appear exactly so (wrapping, trailing spaces and interleaved output break it); `any_line_contains` / `no_line_contains` with a newline can never match one line.',
  check(ctx) {
    const hits: RuleHit[] = [];
    for (const info of ctx.all) {
      for (const check of expectChecks(info.step.expect)) {
        for (const field of LITERAL_FIELDS) {
          const value = check[field];
          if (typeof value !== 'string' || !value.trim().includes('\n'))
            continue;
          hits.push(
            hit(
              info,
              field.includes('line_')
                ? `\`${field}\` holds a newline and compares one line at a time: it can never match`
                : `\`${field}\` spans ${value.trim().split('\n').length} lines; it matches only if they appear exactly so in the capture`,
            ),
          );
        }
      }
    }
    return hits;
  },
};

export const EXPECT_RULES: OperationRule[] = [
  containsVsMatches,
  jsonShape,
  multilineContains,
];
