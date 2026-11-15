import type { ConfirmSpec } from '../models/operation';

/**
 * `confirm:` — a gate the operator satisfies OUTSIDE the attached pane (a
 * dashboard, a browser check, another operator's terminal). The run asks the
 * question before the step can be marked done and records the answer, so the
 * report can tell an asserted gate from a step that was simply passed.
 */
export interface ResolvedConfirm {
  prompt: string;
  /** `required`: the step cannot be confirmed without a typed/pasted result. */
  result: 'optional' | 'required';
}

/** Normalise the YAML forms (`confirm: "…?"` or `{prompt, result}`). */
export function normalizeConfirm(
  spec: ConfirmSpec | undefined,
  resolve: (text: string) => string = (text) => text,
): ResolvedConfirm | undefined {
  if (spec === undefined || spec === null) return undefined;
  const raw = typeof spec === 'string' ? { prompt: spec } : spec;
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : '';
  if (!prompt) return undefined;
  return {
    prompt: resolve(prompt),
    result: raw.result === 'required' ? 'required' : 'optional',
  };
}

/** The one-line form every manual format shows next to the step. */
export function confirmManualText(confirm: ResolvedConfirm): string {
  return `Confirm: ${confirm.prompt} (${
    confirm.result === 'required' ? 'record the result' : 'result optional'
  })`;
}

/** The prompt for the result, after the operator answered `y`. */
export function confirmResultPrompt(confirm: ResolvedConfirm): string {
  return confirm.result === 'required'
    ? '    Result (required: what you saw) > '
    : '    Result (optional, ↵ to skip) > ';
}

/** `confirmManualText` for a step's raw `confirm:`, or undefined when unset. */
export function confirmLine(
  spec: ConfirmSpec | undefined,
  resolve?: (text: string) => string,
): string | undefined {
  const confirm = normalizeConfirm(spec, resolve);
  return confirm && confirmManualText(confirm);
}
