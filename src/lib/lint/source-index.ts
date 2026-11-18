import { existsSync, readFileSync } from 'node:fs';
import {
  type Document,
  isMap,
  isScalar,
  LineCounter,
  type Node,
  Parser,
  parseDocument,
  visit,
} from 'yaml';

/** A position in a source file, 1-based. */
export interface SourceLocation {
  file: string;
  line: number;
  column: number;
  /** Line a `disable-next-line` directive must sit above (the field's key). */
  anchorLine: number;
}

export type DirectiveKind = 'disable' | 'disable-next-line' | 'disable-line';

export interface Directive {
  kind: DirectiveKind;
  /** Rule ids; empty means every rule. */
  rules: string[];
  /** Line of the comment. */
  line: number;
  column: number;
  /** First line after the comment that is not blank or a comment. */
  nextCodeLine: number;
  /** For `disable`: the YAML node starting on `nextCodeLine` (inclusive lines). */
  range?: [number, number];
}

interface SourceFile {
  lines: string[];
  doc: Document;
  counter: LineCounter;
  directives: Directive[];
}

const DIRECTIVE =
  /^#\s*samaritan-lint-(disable-next-line|disable-line|disable)\b(.*)$/;

/** Every comment token in a CST (comments inside block scalars are content). */
function collectComments(
  token: unknown,
  out: { offset: number; source: string }[],
): void {
  if (!token || typeof token !== 'object') return;
  const t = token as { type?: string; offset?: number; source?: string };
  if (t.type === 'comment' && typeof t.offset === 'number' && t.source) {
    out.push({ offset: t.offset, source: t.source });
    return;
  }
  for (const value of Object.values(token)) {
    if (Array.isArray(value)) for (const v of value) collectComments(v, out);
    else if (value && typeof value === 'object') collectComments(value, out);
  }
}

/**
 * Lazily parsed YAML sources (eemeli `yaml`, which keeps positions; js-yaml
 * does not). Used only by lint, never to parse operations.
 */
export class SourceIndex {
  private files = new Map<string, SourceFile | null>();

  private load(file: string): SourceFile | null {
    if (this.files.has(file)) return this.files.get(file) ?? null;
    let loaded: SourceFile | null = null;
    if (!/^https?:\/\//.test(file) && existsSync(file)) {
      const text = readFileSync(file, 'utf8');
      const counter = new LineCounter();
      const doc = parseDocument(text, { lineCounter: counter });
      loaded = {
        lines: text.split('\n'),
        doc,
        counter,
        directives: this.readDirectives(text, counter, doc),
      };
    }
    this.files.set(file, loaded);
    return loaded;
  }

  private readDirectives(
    text: string,
    counter: LineCounter,
    doc: Document,
  ): Directive[] {
    const comments: { offset: number; source: string }[] = [];
    for (const token of new Parser().parse(text))
      collectComments(token, comments);
    const lines = text.split('\n');
    const commentOnly = new Set(
      comments
        .map((c) => counter.linePos(c.offset))
        .filter((p) => lines[p.line - 1].slice(0, p.col - 1).trim() === '')
        .map((p) => p.line),
    );
    const nextCode = (line: number): number => {
      for (let n = line + 1; n <= lines.length; n++) {
        if (lines[n - 1].trim() !== '' && !commentOnly.has(n)) return n;
      }
      return lines.length + 1;
    };
    const directives: Directive[] = [];
    for (const comment of comments) {
      const m = DIRECTIVE.exec(comment.source.trim());
      if (!m) continue;
      const pos = counter.linePos(comment.offset);
      const rules = m[2]
        .replace(/--.*$/, '')
        .split(/[\s,]+/)
        .filter(Boolean);
      const nextCodeLine = nextCode(pos.line);
      const directive: Directive = {
        kind: m[1] as DirectiveKind,
        rules,
        line: pos.line,
        column: pos.col,
        nextCodeLine,
      };
      if (directive.kind === 'disable') {
        directive.range = this.nodeRangeStartingOn(doc, counter, nextCodeLine);
      }
      directives.push(directive);
    }
    return directives;
  }

  /** The widest map node whose first line is `line`, as [first, last] lines. */
  private nodeRangeStartingOn(
    doc: Document,
    counter: LineCounter,
    line: number,
  ): [number, number] | undefined {
    let best: [number, number] | undefined;
    visit(doc, {
      Map(_key, node) {
        if (!node.range) return;
        const start = counter.linePos(node.range[0]).line;
        if (start !== line) return;
        const end = counter.linePos(
          Math.max(node.range[1] - 1, node.range[0]),
        ).line;
        if (!best || end > best[1]) best = [start, end];
      },
    });
    return best;
  }

  directives(file: string): Directive[] {
    return this.load(file)?.directives ?? [];
  }

  /**
   * Where `path` (and `field`, and a line inside a multi-line command) is in
   * `file`. Undefined when the file cannot be read or the path is not there.
   */
  locate(
    file: string,
    path: (string | number)[],
    field?: string,
    commandLine?: number,
  ): SourceLocation | undefined {
    const source = this.load(file);
    if (!source) return undefined;
    const node = source.doc.getIn(path, true) as Node | undefined;
    if (!node?.range) return undefined;
    const pos = (offset: number) => source.counter.linePos(offset);
    const at = (line: number, column: number, anchorLine: number) => ({
      file,
      line,
      column,
      anchorLine,
    });

    const start = pos(node.range[0]);
    if (!field || !isMap(node)) return at(start.line, start.col, start.line);
    const pair = node.items.find(
      (p) => isScalar(p.key) && p.key.value === field,
    );
    if (!pair || !isScalar(pair.key) || !pair.key.range) {
      return at(start.line, start.col, start.line);
    }
    const key = pos(pair.key.range[0]);
    const value = pair.value;
    if (!commandLine || !isScalar(value) || !value.range) {
      return at(key.line, key.col, key.line);
    }
    const valueStart = pos(value.range[0]);
    const block =
      value.type === 'BLOCK_LITERAL' || value.type === 'BLOCK_FOLDED';
    const line = block
      ? valueStart.line + commandLine
      : valueStart.line + commandLine - 1;
    const text = source.lines[line - 1] ?? '';
    const column =
      !block && commandLine === 1
        ? valueStart.col
        : text.length - text.trimStart().length + 1;
    return at(line, column, key.line);
  }
}

/** Does a directive suppress `ruleId` at `location`? */
export function suppresses(
  directive: Directive,
  ruleId: string,
  location: SourceLocation,
): boolean {
  if (directive.rules.length > 0 && !directive.rules.includes(ruleId)) {
    return false;
  }
  switch (directive.kind) {
    case 'disable-line':
      return (
        location.line === directive.line ||
        location.anchorLine === directive.line
      );
    case 'disable-next-line':
      return (
        location.line === directive.nextCodeLine ||
        location.anchorLine === directive.nextCodeLine
      );
    case 'disable':
      return (
        directive.range !== undefined &&
        location.line >= directive.range[0] &&
        location.line <= directive.range[1]
      );
  }
}
