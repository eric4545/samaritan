import type { Step } from '../models/operation';

/**
 * Slugify a human name into a Markdown/HTML anchor-safe token: lowercase,
 * non-alphanumeric runs collapsed to single hyphens, no leading/trailing hyphen.
 * Shared by manual generators (heading anchors, run-manifest step keys) and the
 * global-rollback aggregator so an inline jump-link and its target agree.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Stable per-step key: the authored `id` when present, else the slugified name.
 * Used both to match run-manifest evidence to steps and to derive rollback
 * jump-link anchors.
 */
export function resolveStepKey(step: Pick<Step, 'id' | 'name'>): string {
  return step.id ?? slugify(step.name);
}

/**
 * Human-readable heading for a step's folded rollback entry in
 * `aggregate_step_rollbacks` mode — e.g. `Rollback for "Deploy app"`. The inline
 * jump-link label AND the target heading in the Rollback Plan are BOTH this text,
 * so a reader searching the phrase finds the link and its destination together.
 *
 * Kept emoji-free and punctuation-light so its `slugify` matches the slug a
 * GitHub-style renderer derives from the rendered heading — that equality is what
 * makes `stepRollbackAnchor` a working jump target (see below). Uses the RAW
 * `step.name` (not variable-resolved) so the anchor is resolution-independent,
 * matching how the provenance label is built in `buildGlobalRollback`.
 */
export function stepRollbackHeadingText(step: Pick<Step, 'name'>): string {
  return `Rollback for "${step.name}"`;
}

/**
 * Anchor id for a step's rollback in `aggregate_step_rollbacks` mode, derived by
 * slugifying `stepRollbackHeadingText` so the id ALWAYS equals the slug that a
 * Markdown renderer generates from the target heading. Markdown points the inline
 * jump-link at that heading slug (renderer-safe: sanitizers such as GitHub's
 * prefix hand-authored `<a id>` with `user-content-` and give no clean-fragment
 * alias, but heading-derived anchors get one). Confluence/ADF reuse the same id
 * string for their native anchor macros. Computed from the SAME source step at
 * the link site and the target site, so the two never drift.
 */
export function stepRollbackAnchor(step: Pick<Step, 'name'>): string {
  return slugify(stepRollbackHeadingText(step));
}
