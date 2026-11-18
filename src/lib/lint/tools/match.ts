import type { NormalizedCommand } from '../command-model';
import type { Verb } from './types';

const cache = new Map<string, RegExp>();

/** `delete-*` → /^delete-.*$/, `pvc|pv` → /^(?:pvc|pv)$/. */
function wordRegex(word: string): RegExp {
  let re = cache.get(word);
  if (!re) {
    const body = word
      .split('|')
      .map((alt) =>
        alt
          .split('*')
          .map((part) => part.replace(/[.+?^${}()[\]\\]/g, '\\$&'))
          .join('.*'),
      )
      .join('|');
    re = new RegExp(`^(?:${body})$`);
    cache.set(word, re);
  }
  return re;
}

function wordMatches(pattern: string, word: string | undefined): boolean {
  if (word === undefined) return false;
  if (pattern === '*') return true;
  const re = wordRegex(pattern);
  return re.test(word) || (word.includes('/') && re.test(word.split('/')[0]));
}

/** Does `cmd` match one profile entry? */
export function verbMatches(verb: Verb, cmd: NormalizedCommand): boolean {
  const v = typeof verb === 'string' ? { verb } : verb;
  if (v.verb !== undefined && v.verb !== '') {
    const words = v.verb.trim().split(/\s+/);
    if (!words.every((w, k) => wordMatches(w, cmd.operands[k]))) return false;
  }
  if (v.option !== undefined) {
    const option = cmd.options.find((o) => o.name === v.option);
    if (!option) return false;
    if (
      v.matches !== undefined &&
      !new RegExp(v.matches, 'i').test(option.value ?? '')
    )
      return false;
  }
  if (v.anyOperand !== undefined) {
    const wanted = new Set(v.anyOperand.map((w) => w.toUpperCase()));
    if (!cmd.operands.some((w) => wanted.has(w.toUpperCase()))) return false;
  }
  if (v.redirect && !cmd.redirects.some((r) => /^\d*>>?$/.test(r.op)))
    return false;
  return true;
}

export const anyVerbMatches = (
  verbs: Verb[] | undefined,
  cmd: NormalizedCommand,
): boolean => (verbs ?? []).some((v) => verbMatches(v, cmd));
