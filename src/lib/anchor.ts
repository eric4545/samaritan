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
 * Anchor id for a step's rollback in `aggregate_step_rollbacks` mode. The inline
 * jump-link after the step and the folded entry in the operation-level Rollback
 * Plan both compute this from the SAME source step, so the link resolves to its
 * target without any string parsing of provenance labels.
 */
export function stepRollbackAnchor(step: Pick<Step, 'id' | 'name'>): string {
  return `rollback-${resolveStepKey(step)}`;
}
