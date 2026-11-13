import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { EvidenceConfig, EvidenceType } from '../models/operation';

/**
 * What the operator gave the `[e]` evidence prompt. One prompt takes a file
 * path (dragged in), a URL or free text, so the kind is worked out from the
 * input instead of asked for up front.
 */
export type EvidenceInput =
  | { kind: 'empty' }
  | { kind: 'file'; path: string }
  | { kind: 'missing_file'; path: string }
  | { kind: 'link'; url: string }
  | { kind: 'text'; text: string };

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov'];

export function inferEvidenceTypeFromExtension(filename: string): EvidenceType {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext && IMAGE_EXTENSIONS.includes(ext)) return 'screenshot';
  if (ext && VIDEO_EXTENSIONS.includes(ext)) return 'video';
  return 'file';
}

/**
 * Normalise a path as a terminal delivers it on drag & drop: wrapped in
 * quotes, or with shell escapes (`dash\ board.png`), or starting with `~`.
 */
export function resolveDroppedPath(raw: string): string | undefined {
  let p = raw.trim();
  if (!p) return undefined;
  if (
    p.length > 1 &&
    ((p.startsWith("'") && p.endsWith("'")) ||
      (p.startsWith('"') && p.endsWith('"')))
  ) {
    p = p.slice(1, -1);
  } else {
    p = p.replace(/\\(.)/g, '$1');
  }
  if (p === '~' || p.startsWith('~/')) {
    p = join(homedir(), p.slice(1));
  }
  return p;
}

/** A single http(s) URL with nothing else around it. */
export function isEvidenceUrl(text: string): boolean {
  const t = text.trim();
  if (!/^https?:\/\/\S+$/i.test(t)) return false;
  try {
    return !!new URL(t).hostname;
  } catch {
    return false;
  }
}

const isFile = (p: string): boolean => {
  try {
    return existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
};

/** Looks like the operator meant a path, even though nothing is there. */
function looksLikePath(raw: string): boolean {
  const t = raw.trim();
  if (/^['"]\/.*['"]$/.test(t)) return true;
  // Unquoted: every space must be shell-escaped, as a dragged path has it.
  return /^(~\/|\.{1,2}\/|\/)/.test(t) && !/(^|[^\\]) /.test(t);
}

export function classifyEvidenceInput(
  raw: string,
  fileExists: (path: string) => boolean = isFile,
): EvidenceInput {
  const text = raw.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  if (!text.trim()) return { kind: 'empty' };
  const singleLine = !text.includes('\n');
  if (singleLine) {
    if (isEvidenceUrl(text)) return { kind: 'link', url: text.trim() };
    const path = resolveDroppedPath(text);
    if (path && fileExists(path)) return { kind: 'file', path };
    if (path && looksLikePath(text)) return { kind: 'missing_file', path };
  }
  return { kind: 'text', text };
}

/**
 * File name for a copy stored beside the report. Spaces and brackets are
 * replaced: a Markdown link or image with them in the path does not render.
 */
export function storedEvidenceName(filename: string, id: string): string {
  const safe = filename.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+/, '');
  return `${id.slice(0, 8)}-${safe || 'evidence'}`;
}

/** Types that satisfy each other when a step lists `evidence.types`. */
const TYPE_FAMILIES: EvidenceType[][] = [
  ['screenshot', 'photo'],
  ['command_output', 'log', 'text'],
];

function sameFamily(a: EvidenceType, b: EvidenceType): boolean {
  return a === b || TYPE_FAMILIES.some((f) => f.includes(a) && f.includes(b));
}

/** `screenshot, command_output`, or undefined when the step names no types. */
export function wantedEvidenceTypes(
  evidence: EvidenceConfig | undefined,
): string | undefined {
  const types = evidence?.types ?? [];
  return types.length ? types.join(', ') : undefined;
}

/**
 * `evidence.types` is a hint to the operator, not a filter: anything
 * recorded counts. Say so when what was recorded is not what the step asked
 * for, so a URL on a `types: [screenshot]` step is a visible choice.
 */
export function evidenceTypeMismatch(
  evidence: EvidenceConfig | undefined,
  got: EvidenceType,
): string | undefined {
  const types = evidence?.types ?? [];
  if (!types.length || types.some((t) => sameFamily(t, got))) return undefined;
  return `This step asks for ${types.join(', ')}; recorded: ${got}. It counts; press [e] again to add ${types[0]} as well.`;
}

/** The lines printed above the `[e]` input. */
export function evidencePromptLines(ctx: {
  wanted?: string;
  /** Label of the pane capture a bare Enter takes, when a pane has output. */
  captureLabel?: string;
}): string[] {
  return [
    `    📎 Add evidence${ctx.wanted ? ` (this step asks for: ${ctx.wanted})` : ''}`,
    ...(ctx.captureLabel ? [`       ↵ alone    ${ctx.captureLabel}`] : []),
    '       file       drag a screenshot or file in, or type its path',
    '       link       paste a URL (chat message, CI build, dashboard)',
    '       text       type or paste it, several lines are fine',
    '       Esc        cancel',
  ];
}

/**
 * The `Evidence :` line of a run step's header, so the operator knows before
 * finishing the step that it wants evidence, and of which kind.
 */
export function evidenceHeaderLine(
  evidence: EvidenceConfig | undefined,
  opts: { enforced: boolean },
): string | undefined {
  if (!evidence) return undefined;
  const wanted = wantedEvidenceTypes(evidence);
  if (!evidence.required && !wanted) return undefined;
  const status = evidence.required
    ? opts.enforced
      ? 'required'
      : 'required (not enforced: --no-require-evidence)'
    : 'optional';
  return `Evidence : ${status}${wanted ? ` — ${wanted}` : ''}  ([e] adds it)`;
}

/**
 * A `type: link` evidence result whose `content` is a URL (a chat message, a
 * CI build, a dashboard). Every format renders it as a link, not as a code
 * block; returns the URL, or undefined for anything else.
 */
export function evidenceLinkUrl(item: {
  type: string;
  content?: string;
}): string | undefined {
  const url = item.content?.trim();
  return item.type === 'link' && url && isEvidenceUrl(url) ? url : undefined;
}
