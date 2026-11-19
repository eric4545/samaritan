import type {
  OperationRule,
  OperationRuleContext,
  RuleHit,
  StepInfo,
} from './rule-types';

/**
 * A phrase that hands the operator a decision with no condition and no
 * concrete action. `withAction`: only when the same line also names an
 * action (`retry as needed`), since the phrase alone is often plain prose.
 */
export interface VaguePhrase {
  pattern: RegExp;
  withAction?: boolean;
}

/** Built-in phrases (data). Teams add literal phrases with `lint.vague_phrases`. */
export const VAGUE_DECISION_PHRASES: readonly VaguePhrase[] = [
  { pattern: /\bconsider\s+(?:pausing|stopping|aborting)\b/i },
  // "surface them" with no destination; "surface them to/in/via X" names one.
  { pattern: /\bsurface\s+them\b(?!\s+(?:to|in|on|via|with)\s+\S)/i },
  { pattern: /\bas\s+needed\b/i, withAction: true },
  { pattern: /\bas\s+appropriate\b/i, withAction: true },
  { pattern: /\bif\s+necessary\b/i, withAction: true },
];

/** Verbs that make "as needed" / "if necessary" an instruction to act. */
const ACTION_VERB =
  /\b(?:re-?run|retry|restart|repeat|run|pause|stop|abort|roll\s*back|rollback|redeploy|reboot|escalate|scale|adjust|increase|decrease|update|apply|fix|investigate|wait|check|notify|page)\b/i;

const escapeRegex = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A team phrase: case-insensitive, whitespace-tolerant, word-bounded. */
function teamPhrase(phrase: string): VaguePhrase {
  const body = phrase.trim().split(/\s+/).map(escapeRegex).join('\\s+');
  return { pattern: new RegExp(`(?<![\\w])${body}(?![\\w])`, 'i') };
}

/**
 * The instruction's prose lines (1-based line numbers): lines inside a
 * ``` or ~~~ fence are literal paste content, and `inline code` is too.
 */
export function proseLines(text: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  let fence: string | undefined;
  text.split('\n').forEach((raw, k) => {
    const open = /^\s*(`{3,}|~{3,})/.exec(raw);
    if (open) {
      const marker = open[1][0];
      if (fence === undefined) fence = marker;
      else if (fence === marker) fence = undefined;
      return;
    }
    if (fence !== undefined) return;
    out.push({ line: k + 1, text: raw.replace(/`[^`]*`/g, ' ') });
  });
  return out;
}

function vagueHits(info: StepInfo, phrases: readonly VaguePhrase[]): RuleHit[] {
  const text = info.step.instruction;
  if (typeof text !== 'string' || text.trim() === '') return [];
  const multiline = text.includes('\n');
  const hits: RuleHit[] = [];
  for (const { line, text: prose } of proseLines(text)) {
    const where = multiline
      ? `step "${info.stepName}" (line ${line})`
      : `step "${info.stepName}"`;
    const matches = phrases
      .filter((p) => !p.withAction || ACTION_VERB.test(prose))
      .map((p) => p.pattern.exec(prose))
      .filter((m): m is RegExpExecArray => m !== null)
      .sort((a, b) => a.index - b.index);
    for (const match of matches) {
      hits.push({
        message: `${where}: "${match[0]}" leaves the decision to the operator; state the condition and the action (e.g. "STOP if <threshold>")`,
        step: info.step,
        field: 'instruction',
        commandLine: line,
      });
    }
  }
  return hits;
}

export const INSTRUCTION_RULES: OperationRule[] = [
  {
    kind: 'operation',
    id: 'instruction/vague-decision',
    tier: 3,
    defaultSeverity: 'warning',
    presetSeverity: 'error',
    strictSeverity: 'error',
    inValidate: 'warning',
    description:
      'An `instruction` that leaves a run-time decision to the operator with no condition or action ("consider pausing", "surface them", "retry as needed"). Fenced blocks and inline code are skipped; add phrases with `lint.vague_phrases`.',
    check: (ctx: OperationRuleContext) => {
      const phrases = [
        ...VAGUE_DECISION_PHRASES,
        ...ctx.config.vague_phrases.map(teamPhrase),
      ];
      return ctx.all.flatMap((info) => vagueHits(info, phrases));
    },
  },
];
