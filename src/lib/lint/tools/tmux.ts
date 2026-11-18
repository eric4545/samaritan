import type { ToolProfile } from './types';

export const TMUX: ToolProfile = {
  id: 'tmux',
  binaries: ['tmux'],
  spec: { valueOptions: ['-L', '-S', '-f', '-c', '-T'], combineShort: true },
};

/** tmux commands sharing a first letter with the ones the rules look for. */
const TMUX_COMMANDS = [
  'kill-pane',
  'kill-server',
  'kill-session',
  'kill-window',
  'delete-buffer',
  'detach-client',
  'display-menu',
  'display-message',
  'display-panes',
  'display-popup',
  'send-keys',
  'send-prefix',
  'server-access',
  'set-buffer',
  'set-environment',
  'set-hook',
  'set-option',
  'set-window-option',
  'show-buffer',
  'show-environment',
  'show-hooks',
  'show-messages',
  'show-options',
  'show-prompt-history',
  'show-window-options',
  'source-file',
  'split-window',
  'start-server',
  'suspend-client',
  'swap-pane',
  'swap-window',
  'switch-client',
  'paste-buffer',
  'pipe-pane',
  'previous-layout',
  'previous-window',
  'list-buffers',
  'list-clients',
  'list-commands',
  'list-keys',
  'list-panes',
  'list-sessions',
  'list-windows',
  'load-buffer',
  'lock-client',
  'lock-server',
  'lock-session',
  'last-pane',
  'last-window',
  'link-window',
];
const TMUX_ALIASES: Record<string, string> = {
  killp: 'kill-pane',
  killw: 'kill-window',
  detach: 'detach-client',
  deleteb: 'delete-buffer',
  display: 'display-message',
  displayp: 'display-panes',
  menu: 'display-menu',
  popup: 'display-popup',
  send: 'send-keys',
  setb: 'set-buffer',
  pasteb: 'paste-buffer',
  loadb: 'load-buffer',
  pipep: 'pipe-pane',
  splitw: 'split-window',
  switchc: 'switch-client',
  lsp: 'list-panes',
  ls: 'list-sessions',
};

export const TMUX_KILL = new Set([
  'kill-pane',
  'kill-server',
  'kill-session',
  'kill-window',
  'detach-client',
]);
export const TMUX_INPUT = new Set([
  'send-keys',
  'set-buffer',
  'paste-buffer',
  'load-buffer',
]);

/** Resolve a tmux command word: alias, exact name, or unique prefix. */
export function resolveTmuxCommand(word: string): string | undefined {
  if (TMUX_ALIASES[word]) return TMUX_ALIASES[word];
  if (TMUX_COMMANDS.includes(word)) return word;
  const matches = TMUX_COMMANDS.filter((c) => c.startsWith(word));
  return matches.length === 1 ? matches[0] : undefined;
}
