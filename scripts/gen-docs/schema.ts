import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Render the operation YAML reference from `src/schemas/operation.schema.json`.
 *
 * The schema is the declared source of truth for operation documents (it is also
 * what `samaritan schema` exports and what the yaml-language-server integration
 * consumes), so the field tables are derived from it rather than hand-written.
 * A field that is not in the schema does not appear in the docs — which is the
 * intended pressure: undocumented-because-undeclared is a schema bug to fix at
 * the source, not a gap to paper over in prose.
 */

/** JSON Schema nodes are heterogeneous; `noExplicitAny` is disabled project-wide. */
type SchemaNode = any;

const SCHEMA_PATH = join(
  __dirname,
  '..',
  '..',
  'src',
  'schemas',
  'operation.schema.json',
);

/** Resolve an internal `#/a/b/c` JSON pointer against the root document. */
function resolveRef(root: SchemaNode, ref: string): SchemaNode {
  if (!ref.startsWith('#/')) {
    throw new Error(
      `gen-docs: only internal $refs are supported, got "${ref}"`,
    );
  }
  let node: SchemaNode = root;
  for (const rawSegment of ref.slice(2).split('/')) {
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~');
    node = node?.[segment];
    if (node === undefined) {
      throw new Error(`gen-docs: unresolvable $ref "${ref}"`);
    }
  }
  return node;
}

/** Anchor for a named section, matching GitHub/VitePress slug rules. */
function anchor(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-');
}

/** Sections rendered as their own tables, so `$ref`s to them become links. */
const NAMED_REFS: Record<string, string> = {
  '#/definitions/expectConfig': 'Expect config',
  '#/definitions/rollbackStep': 'Rollback step',
  '#/definitions/foreach': 'Foreach',
  '#/properties/steps/items': 'Step',
};

/**
 * Encode a value for safe inclusion in a Markdown table cell.
 *
 * Pipes become the `&#124;` entity rather than a `\|` backslash escape. Escaping
 * with a backslash would be incomplete unless backslashes were escaped too — and
 * doing THAT would corrupt the values that legitimately carry one, such as the
 * regex in ``pattern `^\d+\.\d+\.\d+$` ``: inside a code span `\\d` renders as a
 * literal double backslash, not as `\d`. Entity encoding sidesteps both problems
 * by never treating backslash as special.
 *
 * Caveat: HTML entities are NOT decoded inside code spans, so a pipe within
 * backticks would render as the literal text `&#124;`. Nothing emits that today,
 * and `tests/docs/gen-docs.test.ts` fails if anything starts to.
 */
function cell(value: string): string {
  return value.replace(/\|/g, '&#124;').replace(/\n+/g, ' ').trim();
}

/** Union separator for the Type column — same reasoning as `cell()`. */
const UNION = ' &#124; ';

/** Human-readable type expression for a schema node. */
function renderType(root: SchemaNode, node: SchemaNode): string {
  if (!node) return 'any';

  if (node.$ref) {
    const named = NAMED_REFS[node.$ref];
    if (named) return `[${named}](#${anchor(named)})`;
    return renderType(root, resolveRef(root, node.$ref));
  }

  if (node.enum) {
    return node.enum.map((v: unknown) => `\`${v}\``).join(UNION);
  }

  if (node.oneOf || node.anyOf) {
    const branches = node.oneOf ?? node.anyOf;
    return branches
      .map((b: SchemaNode) => renderType(root, b))
      .filter((t: string, i: number, all: string[]) => all.indexOf(t) === i)
      .join(UNION);
  }

  if (node.type === 'array') {
    const inner = renderType(root, node.items);
    return inner.includes(UNION.trim()) ? `(${inner})[]` : `${inner}[]`;
  }

  if (Array.isArray(node.type)) return node.type.join(UNION);

  // A branch that declares `properties`/`required` but no explicit `type` is an
  // object in practice; without this, oneOf branches collapse to "any".
  if (!node.type && (node.properties || node.required)) return 'object';

  return node.type ?? 'any';
}

function renderConstraints(node: SchemaNode): string {
  const parts: string[] = [];
  if (node?.pattern) parts.push(`pattern \`${node.pattern}\``);
  if (node?.minLength !== undefined) parts.push(`min length ${node.minLength}`);
  if (node?.minItems !== undefined) parts.push(`min items ${node.minItems}`);
  if (node?.minimum !== undefined) parts.push(`min ${node.minimum}`);
  if (node?.deprecated) parts.push('**deprecated**');
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

interface Section {
  title: string;
  intro?: string;
  node: SchemaNode;
}

function renderTable(root: SchemaNode, node: SchemaNode): string[] {
  const properties = node?.properties ?? {};
  const names = Object.keys(properties);
  if (names.length === 0) {
    return ['', '_No fields are declared for this object in the schema._'];
  }

  const required: string[] = node.required ?? [];
  const lines = [
    '',
    '| Field | Type | Required | Default | Description |',
    '| ----- | ---- | -------- | ------- | ----------- |',
  ];
  for (const name of names) {
    const property = properties[name];
    // A property declared purely as `{ "$ref": ... }` carries no description or
    // default of its own; fall back to the target so the row is not blank.
    const resolved =
      property.$ref && !property.description
        ? resolveRef(root, property.$ref)
        : property;
    const isRequired = required.includes(name) ? 'yes' : 'no';
    const defaultValue =
      resolved.default === undefined
        ? '—'
        : `\`${JSON.stringify(resolved.default)}\``;
    const description =
      (resolved.description ?? '') + renderConstraints(resolved);
    lines.push(
      `| \`${name}\` | ${renderType(root, property)} | ${isRequired} | ${defaultValue} | ${cell(description)} |`,
    );
  }
  return lines;
}

export function renderSchemaReference(): string {
  const root: SchemaNode = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'));

  const stepBranches = root.properties.steps.items.oneOf;
  const envBranches = root.properties.environments.items.oneOf;

  const sections: Section[] = [
    {
      title: 'Operation',
      intro: 'Top-level fields of an operation document.',
      node: root,
    },
    {
      title: 'Environment',
      intro:
        'Entries of `environments:`. An entry may instead be `{ uses: <file> }` to import ' +
        'an environment manifest wholesale.',
      node: envBranches[0],
    },
    {
      title: 'Step',
      intro:
        'Entries of `steps:`. A step may instead be `{ uses: <file>, with: {...} }` to expand ' +
        'the steps of another file inline.',
      node: stepBranches[1],
    },
    {
      title: 'Expect config',
      intro:
        'Assertion rules used by `expect:` on a step, sub-step or rollback step.',
      node: root.definitions.expectConfig,
    },
    {
      title: 'Rollback step',
      intro:
        'Entries of a step-level or operation-level `rollback.steps:` list.',
      node: root.definitions.rollbackStep,
    },
    {
      title: 'Rollback plan',
      intro: 'The operation-level `rollback:` object.',
      node: root.properties.rollback,
    },
    {
      title: 'Metadata',
      node: root.properties.metadata,
    },
  ];

  const lines: string[] = [
    '<!--',
    '  GENERATED FILE — DO NOT EDIT.',
    '  Produced by scripts/gen-docs from src/schemas/operation.schema.json.',
    '  Add a field to the schema and rerun `npm run docs:gen`.',
    '-->',
    '',
    '# Operation YAML reference',
    '',
    'Field tables below are derived from `src/schemas/operation.schema.json`, the same',
    'schema `samaritan validate` enforces and `samaritan schema` exports.',
    '',
    'For guides and worked examples see the operation authoring pages; this page is the',
    'exhaustive field list.',
  ];

  for (const section of sections) {
    lines.push('', `## ${section.title}`, '');
    if (section.intro) lines.push(section.intro);
    lines.push(...renderTable(root, section.node));
  }

  // Nested objects declared inline on a step, rendered after the main tables.
  const stepProperties = stepBranches[1].properties;
  const inlineObjects = ['evidence', 'options', 'retry', 'approval'].filter(
    (name) => stepProperties[name]?.properties,
  );
  if (inlineObjects.length > 0) {
    lines.push('', '## Step sub-objects', '');
    for (const name of inlineObjects) {
      lines.push('', `### \`${name}\``, '');
      if (stepProperties[name].description) {
        lines.push(stepProperties[name].description);
      }
      lines.push(...renderTable(root, stepProperties[name]));
    }
  }

  lines.push('', '## Foreach', '');
  lines.push('Loop a step over one variable or a matrix of variables.');
  const foreachBranches = root.definitions.foreach.oneOf ?? [
    root.definitions.foreach,
  ];
  for (const branch of foreachBranches) {
    lines.push(...renderTable(root, branch));
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}
