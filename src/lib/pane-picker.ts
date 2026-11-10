/**
 * The `[t]` pane picker, pure: render the numbered list and resolve what the
 * operator typed against a FRESH `list-panes`, not the list printed earlier.
 *
 * tmux renumbers panes when one closes, and the printed list goes stale the
 * moment panes change. A number therefore picks the pane by its stable id
 * (`%3`) from the list it was printed in, and that id must still exist in the
 * live list — otherwise the picker says so and prints the current list.
 */

import type { TmuxPaneInfo } from './tmux-session';

/** One picker row: `  2) work:deploy.0  zsh  (%3)`. */
export function renderPaneRow(pane: TmuxPaneInfo, index: number): string {
  const cmd = pane.currentCommand ? `  ${pane.currentCommand}` : '';
  const self = pane.isSelf ? '  (this pane — samaritan)' : '';
  return `      ${index + 1}) ${pane.name || pane.target}${cmd}  (${pane.id})${self}`;
}

export type PanePick =
  | { kind: 'cancel' }
  | { kind: 'refresh' }
  /** A listed pane that is still there: attach by its id. */
  | { kind: 'pane'; pane: TmuxPaneInfo }
  /** A listed number whose pane closed since the list was printed. */
  | { kind: 'gone'; pane: TmuxPaneInfo }
  /** Anything else: a raw tmux target (`work:deploy.0`, `%3`) for tmux to check. */
  | { kind: 'target'; target: string };

/**
 * Resolve the picker answer. `shown` is the list the numbers refer to;
 * `live` is `list-panes` read now. A typed name that matches a live pane's
 * picker name resolves to that pane (its id), so a renamed or renumbered
 * window never redirects the attach.
 */
export function resolvePanePick(
  answer: string,
  shown: readonly TmuxPaneInfo[],
  live: readonly TmuxPaneInfo[],
): PanePick {
  const a = answer.trim();
  if (!a) return { kind: 'cancel' };
  if (a.toLowerCase() === 'r') return { kind: 'refresh' };
  const n = Number.parseInt(a, 10);
  if (String(n) === a && n >= 1 && n <= shown.length) {
    const picked = shown[n - 1];
    const now = live.find((p) => p.id === picked.id);
    return now ? { kind: 'pane', pane: now } : { kind: 'gone', pane: picked };
  }
  const byName = live.filter((p) => p.name === a || p.id === a);
  if (byName.length === 1) return { kind: 'pane', pane: byName[0] };
  return { kind: 'target', target: a };
}
