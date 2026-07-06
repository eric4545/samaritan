/**
 * Strip operator-local absolute path prefixes from report text so a shared
 * report doesn't leak machine-specific locations. Keeps the meaningful tail of
 * each path — only the environment-specific prefix is removed:
 *
 *   <home>/work/op.yaml              -> ~/work/op.yaml
 *   <runDir>/email_body.html         -> email_body.html
 *   <opDir>/scripts/deploy.sh        -> scripts/deploy.sh
 *
 * The home directory collapses to `~`; the run and operation directories are
 * stripped to a relative remainder. All occurrences are replaced (commands,
 * output, and evidence content can each carry the same prefix multiple times).
 */

export interface RedactionBases {
  /** Operator home directory (collapses to `~`). */
  home?: string;
  /** Directory the run log/report lives in (stripped to relative). */
  runDir?: string;
  /** Directory the operation file lives in (stripped to relative). */
  opDir?: string;
}

import { isAbsolute } from 'node:path';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A base is only safe to strip when it's an absolute directory of real length —
 * a relative or root-ish base (`.`, `/`, ``) would match stray characters like
 * the `.` in `a@b.com` and mangle the report.
 */
function isUsableBase(prefix: string | undefined): prefix is string {
  if (!prefix) return false;
  const trimmed = prefix.replace(/\/+$/, '');
  return trimmed.length > 1 && isAbsolute(trimmed);
}

/**
 * Replace every occurrence of a directory prefix in `text`. A trailing path
 * separator on the prefix is consumed too, so `<dir>/file` -> `<replacement>file`
 * and a bare `<dir>` -> `<replacement>` (with any trailing slash removed).
 */
function replacePrefix(
  text: string,
  prefix: string,
  replacement: string,
): string {
  if (!prefix) return text;
  const trimmed = prefix.replace(/\/+$/, '');
  if (!trimmed) return text;
  const re = new RegExp(`${escapeRegExp(trimmed)}(/)?`, 'g');
  return text.replace(re, (_m, slash) =>
    slash ? replacement : replacement.replace(/\/$/, ''),
  );
}

export function redactLocalPaths(text: string, bases: RedactionBases): string {
  if (!text) return text;

  // Apply the most specific (longest) base first so a runDir/opDir nested under
  // home is stripped to its own relative tail rather than partially rewritten
  // to `~/...`.
  const rules: Array<{ prefix: string; replacement: string }> = [];
  if (isUsableBase(bases.runDir))
    rules.push({ prefix: bases.runDir, replacement: '' });
  if (isUsableBase(bases.opDir))
    rules.push({ prefix: bases.opDir, replacement: '' });
  if (isUsableBase(bases.home))
    rules.push({ prefix: bases.home, replacement: '~/' });
  rules.sort((a, b) => b.prefix.length - a.prefix.length);

  let out = text;
  for (const { prefix, replacement } of rules) {
    out = replacePrefix(out, prefix, replacement);
  }
  return out;
}
