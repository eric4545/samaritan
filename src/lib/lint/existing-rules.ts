import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import yaml from 'js-yaml';
import type { Operation, Step } from '../../models/operation';
import { BUILTIN_VARIABLE_NAMES } from '../builtin-variables';
import {
  findDiscardedVerifyKeysInFile,
  formatDiscardedVerifyFinding,
} from '../deprecated-verify';
import { lintEvidenceResults } from '../evidence-lint';
import {
  formatExpectMatchFinding,
  formatExpectShellVarFinding,
  lintExpectMatches,
  lintExpectShellVars,
} from '../expect-lint';
import { formatRegexFinding, lintOperationRegex } from '../regex-lint';
import {
  formatFinding as formatShellcheckFinding,
  isShellcheckAvailable,
  lintOperationCommands,
} from '../shell-lint';
import { validateStepDeps } from '../step-deps';
import { duplicateStepIds, formatDuplicateStepId } from '../step-walk';
import type { RuleSetting } from './config';
import {
  expectStrings,
  type OperationRule,
  type OperationRuleContext,
  type RuleHit,
  type StepInfo,
  stepAt,
  type Tier,
  templateRefs,
} from './rule-types';

/** The operation reduced to one step (no sub-steps, no rollback). */
function only(ctx: OperationRuleContext, info: StepInfo): Operation {
  const step = {
    ...info.step,
    sub_steps: undefined,
    rollback: undefined,
    variants: undefined,
  } as Step;
  return { ...ctx.operation, steps: [step], rollback: undefined };
}

/** Run an existing whole-operation check one step at a time, keeping the step. */
function perStep<T>(
  ctx: OperationRuleContext,
  run: (op: Operation) => T[],
  format: (finding: T) => string,
  field?: string,
): RuleHit[] {
  return ctx.all.flatMap((info) =>
    run(only(ctx, info)).map((f) => ({
      message: format(f),
      step: info.step,
      field,
    })),
  );
}

const existing = (
  id: string,
  tier: Tier,
  defaultSeverity: RuleSetting,
  description: string,
  check: OperationRule['check'],
  extra: Partial<OperationRule> = {},
): OperationRule => ({
  kind: 'operation',
  id,
  tier,
  defaultSeverity,
  description,
  inValidate: 'already',
  check,
  ...extra,
});

const depsRule = (
  kind: string,
  tier: Tier,
  severity: RuleSetting,
  what: string,
  extra: Partial<OperationRule> = {},
) =>
  existing(
    `deps/${kind}`,
    tier,
    severity,
    what,
    (ctx) =>
      validateStepDeps(ctx.operation.steps)
        .filter((i) => i.kind === kind)
        .map((i) => ({
          message: i.message,
          step: ctx.operation.steps[i.stepIndex],
          field: 'needs',
        })),
    extra,
  );

/** `steps[2].rollback[0]` → ['steps', 2, 'rollback', 0]. */
/** Step fields that are parsed and then read by nothing, with the fix. */
function unusedFields(step: {
  retry?: unknown;
  manual_override?: unknown;
  manual_instructions?: unknown;
  approval?: object;
}): Array<[field: string, message: string]> {
  const found: Array<[string, string]> = [];
  if (step.retry !== undefined) {
    found.push([
      'retry',
      '`retry:` on a step does nothing: samaritan never re-runs a command. To poll until a check passes, use `expect.retry`.',
    ]);
  }
  if (step.manual_override === true) {
    found.push([
      'manual_override',
      '`manual_override` does nothing: no manual or run reads it. Remove it.',
    ]);
  }
  if (step.manual_instructions !== undefined) {
    found.push([
      'manual_instructions',
      '`manual_instructions` is not shown anywhere. Put the text in `instruction:`.',
    ]);
  }
  for (const key of Object.keys(step.approval ?? {})) {
    if (key === 'required') continue;
    found.push([
      'approval',
      key === 'approvers'
        ? '`approval.approvers` is not shown or enforced. Name the approver in `reviewer:` or the `instruction:`.'
        : key === 'timeout'
          ? '`approval.timeout` is not enforced. Remove it, or say the deadline in the `instruction:`.'
          : `\`approval.${key}\` is not read: only \`approval.required\` is. Remove it, or say it in the \`instruction:\`.`,
    ]);
  }
  return found;
}

/** Whether the operation file sets `key` at its top level (raw YAML). */
function hasTopLevelKey(file: string, key: string): boolean {
  try {
    const raw = yaml.load(readFileSync(file, 'utf8'));
    return !!raw && typeof raw === 'object' && key in raw;
  } catch {
    return false;
  }
}

function parsePath(text: string): (string | number)[] {
  return [...text.matchAll(/([A-Za-z_]+)|\[(\d+)\]/g)].map((m) =>
    m[2] !== undefined ? Number(m[2]) : m[1],
  );
}

const LEGACY_BUILTINS = ['DATE', 'TIME', 'USER', 'environment'];

export const EXISTING_RULES: OperationRule[] = [
  existing(
    'steps/duplicate-id',
    1,
    'error',
    'Two top-level steps share an `id`.',
    (ctx) =>
      duplicateStepIds(ctx.operation.steps).map((d) => ({
        message: formatDuplicateStepId(d),
        step: ctx.operation.steps[d.positions[1] - 1],
        field: 'id',
      })),
  ),
  existing(
    'expect/invalid-regex',
    1,
    'error',
    'An `expect` regex field that does not compile, so the check can never pass.',
    (ctx) =>
      perStep(
        ctx,
        (op) => lintOperationRegex(op).filter((f) => f.level === 'error'),
        formatRegexFinding,
        'expect',
      ),
  ),
  existing(
    'expect/redos-prone',
    2,
    'warning',
    'An `expect` regex with nested unbounded quantifiers (`(a+)+`).',
    (ctx) =>
      perStep(
        ctx,
        (op) => lintOperationRegex(op).filter((f) => f.level !== 'error'),
        formatRegexFinding,
        'expect',
      ),
    { strictSeverity: 'error' },
  ),
  existing(
    'expect/shell-var-never-resolves',
    2,
    'warning',
    'A bare `$NAME` in `expect` that is not an operation variable is compared literally.',
    (ctx) =>
      perStep(ctx, lintExpectShellVars, formatExpectShellVarFinding, 'expect'),
  ),
  existing(
    'expect/token-from-command',
    2,
    'warning',
    'An `expect` substring that also appears in the command can pass on the echoed command line.',
    (ctx) =>
      perStep(
        ctx,
        (op) => lintExpectMatches(op).filter((f) => f.kind === 'self-match'),
        formatExpectMatchFinding,
        'expect',
      ),
  ),
  existing(
    'expect/bare-number',
    2,
    'warning',
    'A bare number in `contains` also matches longer numbers (`2` matches `12`).',
    (ctx) =>
      perStep(
        ctx,
        (op) => lintExpectMatches(op).filter((f) => f.kind === 'bare-number'),
        formatExpectMatchFinding,
        'expect',
      ),
  ),
  depsRule('cycle', 1, 'error', 'Steps whose `needs` form a cycle.'),
  depsRule('self-ref', 1, 'error', 'A step that `needs` itself.'),
  depsRule('forward-ref', 1, 'error', 'A step that `needs` a later step.'),
  depsRule('unknown-ref', 2, 'warning', 'A `needs` entry that names no step.', {
    strictSeverity: 'error',
  }),
  depsRule(
    'ambiguous-ref',
    2,
    'warning',
    'A `needs` entry that matches several steps.',
  ),
  depsRule(
    'sub-step-needs',
    2,
    'warning',
    '`needs` on a sub-step (only top-level `needs` are honoured).',
  ),
  existing(
    'compat/discarded-verify',
    2,
    'warning',
    'Keys under a deprecated `verify:` that the parser discards.',
    (ctx) =>
      findDiscardedVerifyKeysInFile(ctx.operationFile).map((f) => ({
        message: formatDiscardedVerifyFinding(f),
        path: [...parsePath(f.path), 'verify'],
      })),
  ),
  existing(
    'evidence/results',
    2,
    'warning',
    '`evidence.results` entries for an unknown environment, a missing file or a mismatched type.',
    (ctx) =>
      perStep(
        ctx,
        (op) => lintEvidenceResults(op, dirname(resolve(ctx.operationFile))),
        (message) => message,
        'evidence',
      ),
  ),
  existing(
    'evidence/no-types',
    2,
    'warning',
    '`evidence.required` with no `evidence.types`: the operator is not told what to record.',
    (ctx) =>
      ctx.all
        .filter(
          (i) =>
            i.step.evidence?.required &&
            (i.step.evidence.types ?? []).length === 0,
        )
        .map((i) => ({
          message: `${stepAt(i)}: evidence required but no evidence types specified`,
          step: i.step,
          field: 'evidence',
        })),
  ),
  existing(
    'shell/shellcheck',
    2,
    'off',
    'shellcheck over every `command` and `script` (needs shellcheck on PATH; skipped otherwise).',
    (ctx) =>
      isShellcheckAvailable()
        ? ctx.all.flatMap((info) =>
            lintOperationCommands(only(ctx, info), ctx.operationFile).map(
              (f) => ({
                message: formatShellcheckFinding(f),
                step: info.step,
                field: f.source,
                commandLine: f.source === 'command' ? f.line : undefined,
              }),
            ),
          )
        : [],
    { presetSeverity: 'warning', strictSeverity: 'warning' },
  ),
  existing(
    'vars/undefined',
    2,
    'warning',
    'A `${NAME}` that no environment, `common_variables`, group, step `variables`, built-in or `capture:` defines.',
    (ctx) => {
      const captured = new Set(
        ctx.all.flatMap((i) => Object.keys((i.step as Step).capture ?? {})),
      );
      const hits: RuleHit[] = [];
      for (const info of ctx.all) {
        const names = new Set([
          ...templateRefs(info.step.command),
          ...templateRefs(info.step.instruction),
          ...expectStrings(info.step.expect).flatMap(templateRefs),
        ]);
        for (const name of names) {
          if (
            info.declaredVariables.has(name) ||
            captured.has(name) ||
            LEGACY_BUILTINS.includes(name)
          )
            continue;
          hits.push({
            message: `${stepAt(info)}: \`\${${name}}\` is not defined in any environment and no step captures it`,
            step: info.step,
          });
        }
      }
      return hits;
    },
  ),
  existing(
    'vars/shadows-builtin',
    2,
    'warning',
    'A user variable named like a built-in run-time variable (`CURRENT_DATE`, …): the user value wins.',
    (ctx) => {
      const builtins = new Set<string>(BUILTIN_VARIABLE_NAMES);
      const scopes: Record<string, unknown>[] = [
        ctx.operation.common_variables ?? {},
        ...Object.values(ctx.operation.variables ?? {}),
        ...ctx.all.map((i) => (i.step as Step).variables ?? {}),
      ];
      const shadowed = new Set(
        scopes
          .flatMap((vars) => Object.keys(vars ?? {}))
          .filter((k) => builtins.has(k)),
      );
      return [...shadowed].map((name) => ({
        message: `Variable '${name}' shadows a built-in run-time variable; your value will be used instead of the built-in`,
      }));
    },
  ),
  existing(
    'rollback/empty',
    2,
    'warning',
    'A rollback entry with no `command`, `script`, `instruction` or `sub_steps`: choosing it does nothing.',
    (ctx) =>
      ctx.all
        .filter(
          (i) =>
            i.rollback &&
            !i.step.command &&
            !i.step.script &&
            !i.step.instruction &&
            (i.step.sub_steps ?? []).length === 0,
        )
        .map((i) => ({
          message: `${stepAt(i)}: rollback entry has nothing to do (no command, script, instruction or sub-steps)`,
          step: i.step,
        })),
    { inValidate: 'warning' },
  ),
  existing(
    'style/hardcoded-env',
    3,
    'off',
    'An environment name written literally in a command or instruction (outside `${…}`): the step does the same thing in every environment.',
    (ctx) => {
      const envs = ctx.environments.filter((e) => e.length >= 3);
      const hits: RuleHit[] = [];
      for (const info of ctx.all) {
        for (const [field, text] of [
          ['command', info.step.command],
          ['instruction', info.step.instruction],
        ] as const) {
          if (!text) continue;
          const plain = text.replace(/\$\{[^}]*\}/g, '');
          const found = envs.find((e) =>
            new RegExp(
              `(^|[^A-Za-z0-9_-])${e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_-])`,
            ).test(plain),
          );
          if (!found) continue;
          hits.push({
            message: `${stepAt(info)}: environment name '${found}' is hardcoded in the ${field}; use a variable`,
            step: info.step,
            field,
          });
        }
      }
      return hits;
    },
    { strictSeverity: 'warning', presetSeverity: 'warning' },
  ),
  existing(
    'style/hardcoded-identity',
    3,
    'warning',
    'An account id inside an ARN (`arn:…:123456789012:…`), a personal `admin.<name>` account, or a name from `lint.identities` written literally in a command or instruction. A bare 12-digit number (an image tag) is not flagged.',
    (ctx) => {
      const names = ctx.config.identities;
      const hits: RuleHit[] = [];
      for (const info of ctx.all) {
        for (const [field, text] of [
          ['command', info.step.command],
          ['instruction', info.step.instruction],
        ] as const) {
          if (!text) continue;
          const arn = /arn:aws[a-z-]*:[a-z0-9-]*:[a-z0-9-]*:(\d{12}):/.exec(
            text,
          );
          if (arn) {
            hits.push({
              message: `${stepAt(info)}: account id ${arn[1]} is hardcoded in an ARN; use a variable`,
              step: info.step,
              field,
            });
          }
          const who = names.find((n) =>
            new RegExp(
              `(^|[^A-Za-z0-9_.-])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_-])`,
            ).test(text),
          );
          if (who) {
            hits.push({
              message: `${stepAt(info)}: '${who}' (from lint.identities) is hardcoded in the ${field}`,
              step: info.step,
              field,
            });
          }
          // A personal admin account (`admin.alice`, `admin.alice@example.com`).
          // One label after `admin.` (not a dotted host like admin.example.com).
          const admin =
            /(^|[^A-Za-z0-9_./-])(admin\.[A-Za-z][\w-]*)(?=@|\s|$|["':])/.exec(
              text,
            );
          if (admin) {
            hits.push({
              message: `${stepAt(info)}: personal admin account '${admin[2]}' is hardcoded in the ${field}; use a variable`,
              step: info.step,
              field,
            });
          }
        }
      }
      return hits;
    },
    { inValidate: 'warning' },
  ),
  {
    kind: 'operation',
    id: 'compat/unused-field',
    tier: 2,
    defaultSeverity: 'warning',
    inValidate: 'warning',
    description:
      'A step field the parser accepts but nothing reads (`retry`, `manual_override`, `manual_instructions`, any `approval` key but `required`).',
    check: (ctx) =>
      ctx.all.flatMap((info) =>
        unusedFields(info.step).map(([field, message]) => ({
          message: `step "${info.stepName}": ${message}`,
          step: info.step,
          field,
        })),
      ),
  },
  {
    kind: 'operation',
    id: 'compat/common-variables',
    tier: 3,
    defaultSeverity: 'off',
    strictSeverity: 'warning',
    presetSeverity: 'warning',
    description:
      'Top-level `common_variables:`, the older name of `variables:`.',
    check: (ctx) =>
      hasTopLevelKey(ctx.operationFile, 'common_variables')
        ? [
            {
              message:
                '`common_variables:` is the older name of `variables:`. Rename it to `variables:` (when both set a name, `common_variables` wins).',
              path: ['common_variables'],
            },
          ]
        : [],
  },
];
