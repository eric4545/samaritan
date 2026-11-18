/**
 * A small, deterministic shell lexer for procedure lint.
 *
 * It splits a step's `command` text into simple commands (argv, leading
 * `NAME=value` assignments, redirects) without running or expanding anything:
 * `$VAR`, `${VAR}` and `${VAR:?msg}` stay as literal text, so results never
 * depend on the host environment or working directory.
 *
 * Supported: quotes and escapes, `\`-continuations, `#` comments, newlines and
 * `;` `&&` `||` `|` `&` as command boundaries, `( … )` subshells, `$( … )`
 * substitutions (also inside double quotes, analysed recursively), redirects
 * (`2>&1`, `>>`, `<<<`), and the `if`/`while`/`until`/`for`/`{ }` keywords.
 *
 * Anything else that could hide a command is reported in `unsupported`, never
 * skipped silently: heredocs (the lines after `<<` are not analysed), process
 * substitution, backticks, `case`, function definitions.
 */

export type CommandContext = 'top' | 'subshell' | 'substitution';

export interface Redirect {
  op: string;
  target: string;
}

export interface Assignment {
  name: string;
  value: string;
}

export interface SimpleCommand {
  /** Words after assignments and redirects, quotes removed. */
  argv: string[];
  assignments: Assignment[];
  redirects: Redirect[];
  /** `top`: runs in the operation's shell itself. */
  context: CommandContext;
  /** 1-based line of the command's first word within the command text. */
  line: number;
}

export interface ParsedShell {
  commands: SimpleCommand[];
  /** Distinct constructs that were not (fully) analysed. */
  unsupported: string[];
}

type Token =
  | { kind: 'word'; value: string; line: number }
  | { kind: 'op'; value: string; line: number }
  | { kind: 'redir'; value: string; line: number };

const LEADING_KEYWORDS = new Set([
  'if',
  'then',
  'elif',
  'else',
  'do',
  'while',
  'until',
  '!',
  '{',
  'time',
  'fi',
  'done',
  '}',
  'esac',
]);

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Index just after the `)` closing a `(` opened before `start`. */
function findClosingParen(text: string, start: number): number {
  let depth = 1;
  let i = start;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === "'") {
      const end = text.indexOf("'", i + 1);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    if (c === '"') {
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') i++;
        else if (text[i] === '$' && text[i + 1] === '(') {
          i = findClosingParen(text, i + 2) - 1;
        }
        i++;
      }
      i++;
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return text.length;
}

/** Index just after the `}` closing a `${` opened before `start`. */
function findClosingBrace(text: string, start: number): number {
  let depth = 1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '\\') {
      i++;
      continue;
    }
    if (text[i] === '{') depth++;
    if (text[i] === '}' && --depth === 0) return i + 1;
  }
  return text.length;
}

function countLines(text: string): number {
  let n = 0;
  for (const c of text) if (c === '\n') n++;
  return n;
}

interface LexState {
  tokens: Token[];
  nested: ParsedShell[];
  nestedLines: number[];
  unsupported: Set<string>;
}

function lex(text: string, state: LexState): void {
  let i = 0;
  let line = 1;
  let word = '';
  let inWord = false;
  let wordLine = 1;
  let stopAtNewline = false;

  const startWord = () => {
    if (!inWord) {
      inWord = true;
      wordLine = line;
    }
  };
  const flush = () => {
    if (inWord)
      state.tokens.push({ kind: 'word', value: word, line: wordLine });
    word = '';
    inWord = false;
  };
  const op = (value: string) => {
    flush();
    state.tokens.push({ kind: 'op', value, line });
  };
  const substitution = (inner: string, atLine: number, kind: string) => {
    state.nested.push(parseShell(inner, 'substitution'));
    state.nestedLines.push(atLine - 1);
    if (kind !== '$(') state.unsupported.add(kind);
  };

  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];

    if (c === '\\') {
      if (next === '\n') {
        i += 2;
        line++;
        continue;
      }
      startWord();
      word += next ?? '';
      i += 2;
      continue;
    }
    if (c === "'") {
      startWord();
      const end = text.indexOf("'", i + 1);
      const stop = end === -1 ? text.length : end;
      const chunk = text.slice(i + 1, stop);
      word += chunk;
      line += countLines(chunk);
      i = stop + 1;
      continue;
    }
    if (c === '"') {
      startWord();
      i++;
      while (i < text.length && text[i] !== '"') {
        const d = text[i];
        if (d === '\\' && '$`"\\\n'.includes(text[i + 1] ?? '')) {
          if (text[i + 1] === '\n') line++;
          else word += text[i + 1];
          i += 2;
          continue;
        }
        if (d === '$' && text[i + 1] === '(' && text[i + 2] !== '(') {
          const end = findClosingParen(text, i + 2);
          substitution(text.slice(i + 2, end - 1), line, '$(');
          word += '$(…)';
          line += countLines(text.slice(i, end));
          i = end;
          continue;
        }
        if (d === '`') {
          const end = text.indexOf('`', i + 1);
          const stop = end === -1 ? text.length : end;
          substitution(text.slice(i + 1, stop), line, 'backticks');
          word += '`…`';
          i = stop + 1;
          continue;
        }
        if (d === '\n') line++;
        word += d;
        i++;
      }
      i++;
      continue;
    }
    if (c === '$' && next === '(') {
      startWord();
      if (text[i + 2] === '(') {
        // $(( arithmetic )): no commands inside.
        const end = findClosingParen(text, i + 2);
        word += text.slice(i, end);
        i = end;
        continue;
      }
      const end = findClosingParen(text, i + 2);
      substitution(text.slice(i + 2, end - 1), line, '$(');
      word += '$(…)';
      line += countLines(text.slice(i, end));
      i = end;
      continue;
    }
    if (c === '$' && next === '{') {
      startWord();
      const end = findClosingBrace(text, i + 2);
      word += text.slice(i, end);
      i = end;
      continue;
    }
    if (c === '`') {
      startWord();
      const end = text.indexOf('`', i + 1);
      const stop = end === -1 ? text.length : end;
      substitution(text.slice(i + 1, stop), line, 'backticks');
      word += '`…`';
      i = stop + 1;
      continue;
    }
    if ((c === '<' || c === '>') && next === '(' && !inWord) {
      const end = findClosingParen(text, i + 2);
      startWord();
      substitution(text.slice(i + 2, end - 1), line, 'process substitution');
      word += `${c}(…)`;
      i = end;
      continue;
    }
    if (c === '#' && !inWord) {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (c === '\n') {
      op('\n');
      line++;
      i++;
      if (stopAtNewline) {
        state.unsupported.add('heredoc');
        return;
      }
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      flush();
      i++;
      continue;
    }
    if (c === '&' && next === '>') {
      flush();
      const value = text[i + 2] === '>' ? '&>>' : '&>';
      state.tokens.push({ kind: 'redir', value, line });
      i += value.length;
      continue;
    }
    if (c === '<' || c === '>') {
      // A run of digits right before the operator is its fd: `2>&1`.
      let fd = '';
      if (inWord && /^\d+$/.test(word)) {
        fd = word;
        word = '';
        inWord = false;
      }
      flush();
      const three = text.slice(i, i + 3);
      const two = text.slice(i, i + 2);
      let value: string;
      if (three === '<<<') value = '<<<';
      else if (three === '<<-') value = '<<-';
      else if (['>>', '>&', '>|', '<<', '<&', '<>'].includes(two)) value = two;
      else value = c;
      if (value === '<<' || value === '<<-') stopAtNewline = true;
      state.tokens.push({ kind: 'redir', value: fd + value, line });
      i += value.length;
      continue;
    }
    if (c === '&' || c === '|' || c === ';') {
      const two = text.slice(i, i + 2);
      if (['&&', '||', ';;', '|&', ';&'].includes(two)) {
        op(two);
        i += 2;
      } else {
        op(c);
        i++;
      }
      continue;
    }
    if (c === '(' || c === ')') {
      op(c);
      i++;
      continue;
    }
    startWord();
    word += c;
    i++;
  }
  flush();
  if (stopAtNewline) state.unsupported.add('heredoc');
}

/**
 * Parse shell text into simple commands. Nested `$( … )` commands are
 * returned too, with context `substitution`.
 */
export function parseShell(
  text: string,
  context: CommandContext = 'top',
): ParsedShell {
  const state: LexState = {
    tokens: [],
    nested: [],
    nestedLines: [],
    unsupported: new Set(),
  };
  lex(text, state);

  const commands: SimpleCommand[] = [];
  const contexts: CommandContext[] = [context];
  let words: { value: string; line: number }[] = [];
  let redirects: Redirect[] = [];
  let pendingRedir: string | undefined;

  const close = () => {
    const current = contexts[contexts.length - 1];
    let argv = words.map((w) => w.value);
    const line = words[0]?.line ?? 1;
    while (argv.length > 0 && LEADING_KEYWORDS.has(argv[0])) {
      argv = argv.slice(1);
    }
    const skip =
      argv[0] === 'for' ||
      argv[0] === 'select' ||
      argv[0] === '[[' ||
      argv[0] === 'case' ||
      argv[0] === 'function';
    if (argv[0] === 'case') state.unsupported.add('case');
    if (argv[0] === 'function') state.unsupported.add('function definition');

    if (!skip && (argv.length > 0 || redirects.length > 0)) {
      const assignments: Assignment[] = [];
      while (argv.length > 0 && ASSIGNMENT.test(argv[0])) {
        const eq = argv[0].indexOf('=');
        assignments.push({
          name: argv[0].slice(0, eq),
          value: argv[0].slice(eq + 1),
        });
        argv = argv.slice(1);
      }
      commands.push({ argv, assignments, redirects, context: current, line });
    }
    words = [];
    redirects = [];
  };

  for (let t = 0; t < state.tokens.length; t++) {
    const token = state.tokens[t];
    if (token.kind === 'redir') {
      pendingRedir = token.value;
      continue;
    }
    if (token.kind === 'word') {
      if (pendingRedir !== undefined) {
        redirects.push({ op: pendingRedir, target: token.value });
        pendingRedir = undefined;
      } else {
        words.push({ value: token.value, line: token.line });
      }
      continue;
    }
    if (pendingRedir !== undefined) {
      redirects.push({ op: pendingRedir, target: '' });
      pendingRedir = undefined;
    }
    if (token.value === '(') {
      const nextToken = state.tokens[t + 1];
      if (words.length > 0 && nextToken?.value === ')') {
        state.unsupported.add('function definition');
        words = [];
        t++;
        continue;
      }
      close();
      contexts.push('subshell');
      continue;
    }
    if (token.value === ')') {
      close();
      if (contexts.length > 1) contexts.pop();
      continue;
    }
    close();
  }
  if (pendingRedir !== undefined) {
    redirects.push({ op: pendingRedir, target: '' });
  }
  close();

  state.nested.forEach((nested, k) => {
    const offset = state.nestedLines[k];
    for (const cmd of nested.commands) {
      commands.push({ ...cmd, line: cmd.line + offset });
    }
    for (const u of nested.unsupported) state.unsupported.add(u);
  });

  return { commands, unsupported: [...state.unsupported] };
}
