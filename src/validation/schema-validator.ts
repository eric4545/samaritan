import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv, { type ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';

// In CommonJS, __dirname is available globally

// Load schema
const schemaPath = join(__dirname, '../schemas/operation.schema.json');
const operationSchema = JSON.parse(readFileSync(schemaPath, 'utf8'));

// Setup AJV
const ajv = new Ajv({
  allErrors: true,
  verbose: true,
  strict: false, // Allow additional properties for flexibility
});
addFormats(ajv); // Add date-time format support

const validateOperation = ajv.compile(operationSchema);

export interface ValidationError {
  field: string;
  message: string;
  value?: any;
  /** Name of the step the error sits in (`steps[n].name`), when known. */
  step?: string;
}

/** How many errors an Error's `.message` lists before "… N more". */
const MESSAGE_ERROR_LIMIT = 10;

export class SchemaValidationError extends Error {
  public errors: ValidationError[];

  constructor(message: string, errors: ValidationError[]) {
    super(message);
    this.name = 'SchemaValidationError';
    this.errors = errors;
  }
}

/** JSON-Schema type name of a YAML value (`integer` counts as `number`). */
function jsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function typeMatches(declared: unknown, value: unknown): boolean {
  const actual = jsonType(value);
  const types = Array.isArray(declared) ? declared : [declared];
  return types.some(
    (t) =>
      t === actual ||
      (t === 'integer' && actual === 'number' && Number.isInteger(value)),
  );
}

/** Resolve a local `#/a/b` JSON pointer against the operation schema. */
function resolvePointer(ref: string): any {
  if (!ref.startsWith('#/')) return undefined;
  return ref
    .slice(2)
    .split('/')
    .map((seg) => seg.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((node: any, seg) => node?.[seg], operationSchema);
}

/**
 * Indexes of the `oneOf`/`anyOf` branches that can apply to `data`, or
 * undefined when the data does not single one out.
 *
 * A branch is ruled out when its `type` does not match the data, or when the
 * data has none of its `required` keys while another branch has some of its
 * own (e.g. a step without `uses` is not a `uses:` step).
 */
function applicableBranches(branches: any[], data: unknown): number[] {
  const resolved = branches.map((b) =>
    b?.$ref ? { ...resolvePointer(b.$ref), ...b } : b,
  );
  let candidates = resolved
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b?.type === undefined || typeMatches(b.type, data));

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const hasAnyRequired = (b: any) =>
      Array.isArray(b?.required) &&
      b.required.some((k: string) => k in (data as object));
    if (candidates.some(({ b }) => hasAnyRequired(b))) {
      candidates = candidates.filter(
        ({ b }) => !Array.isArray(b?.required) || hasAnyRequired(b),
      );
    }
  }
  return candidates.map(({ i }) => i);
}

/**
 * Whether `other` was reported by branch `i` of the oneOf error `err`. Errors
 * inside a `$ref` branch carry the referenced path (`#/definitions/x/...`), not
 * the branch's own. Another branch can reach the same definition deeper down
 * (an `expect` list's items are `expectConfig` too), so a `$ref` match only
 * counts at the oneOf's own instance path.
 */
function fromBranch(
  other: ErrorObject,
  err: ErrorObject,
  branch: any,
  i: number,
): boolean {
  if (!isUnder(other.instancePath, err.instancePath)) return false;
  const own = `${err.schemaPath}/${i}`;
  if (other.schemaPath === own || other.schemaPath.startsWith(`${own}/`)) {
    return true;
  }
  return (
    typeof branch?.$ref === 'string' &&
    other.instancePath === err.instancePath &&
    other.schemaPath.startsWith(`${branch.$ref}/`)
  );
}

function isUnder(instancePath: string, parent: string): boolean {
  return instancePath === parent || instancePath.startsWith(`${parent}/`);
}

/**
 * Drop the noise a failed `oneOf` produces. Ajv reports every branch's
 * failure, so one wrong value inside a step (e.g. a number for
 * `expect.any_line_contains`) also reports "must have required property
 * 'uses'" (the `uses:` step branch), "expect must be string/array" (the other
 * `expect` shapes) and two "must match exactly one schema in oneOf". Keep the
 * errors of the branch the data actually takes; keep a `oneOf` error only when
 * nothing more specific is left under it.
 */
export function pruneOneOfErrors(errors: ErrorObject[]): ErrorObject[] {
  const dropped = new Set<ErrorObject>();

  for (const err of errors) {
    if (err.keyword !== 'oneOf' && err.keyword !== 'anyOf') continue;
    const branches = err.schema;
    if (!Array.isArray(branches)) continue;
    const applicable = applicableBranches(branches, err.data);
    if (applicable.length !== 1) continue;

    branches.forEach((branch, i) => {
      if (i === applicable[0]) return;
      for (const other of errors) {
        if (other !== err && fromBranch(other, err, branch, i)) {
          dropped.add(other);
        }
      }
    });
  }

  const kept = errors.filter((e) => !dropped.has(e));
  return kept.filter(
    (e) =>
      (e.keyword !== 'oneOf' && e.keyword !== 'anyOf') ||
      !kept.some(
        (o) =>
          o.keyword !== 'oneOf' &&
          o.keyword !== 'anyOf' &&
          isUnder(o.instancePath, e.instancePath),
      ),
  );
}

/** Name of the step an instance path points into (`/steps/3/...`). */
function stepNameAt(data: any, instancePath: string): string | undefined {
  const m = /^\/steps\/(\d+)(?:\/|$)/.exec(instancePath);
  const name = m ? data?.steps?.[Number(m[1])]?.name : undefined;
  return typeof name === 'string' ? name : undefined;
}

function describeValue(value: unknown): string {
  const text = JSON.stringify(value);
  const shown =
    text === undefined
      ? String(value)
      : text.length > 40
        ? `${text.slice(0, 37)}...`
        : text;
  return `${jsonType(value)} ${shown}`;
}

function toValidationError(error: ErrorObject, data: any): ValidationError {
  let message = error.message || 'Validation failed';
  if (error.keyword === 'type') {
    message += ` (got ${describeValue(error.data)})`;
  } else if (error.keyword === 'additionalProperties') {
    message += `: '${(error.params as any).additionalProperty}'`;
  }
  return {
    field: error.instancePath || error.schemaPath || 'root',
    message,
    value: error.data,
    step: stepNameAt(data, error.instancePath),
  };
}

/**
 * `/steps/0/expect/any_line_contains` → `steps[0] "Step A" → expect.any_line_contains`.
 * Non-pointer fields (file, yaml, migration errors) pass through unchanged.
 */
export function formatValidationError(error: ValidationError): string {
  if (!error.field.startsWith('/')) return `${error.field}: ${error.message}`;
  const toPath = (segments: string[]) =>
    segments
      .map((seg) => (/^\d+$/.test(seg) ? `[${seg}]` : `.${seg}`))
      .join('')
      .replace(/^\./, '');
  const [first, index, ...rest] = error.field.slice(1).split('/');
  if (first === 'steps' && index !== undefined && error.step !== undefined) {
    const head = `steps[${index}] "${error.step}"`;
    const where = rest.length ? `${head} → ${toPath(rest)}` : head;
    return `${where}: ${error.message}`;
  }
  return `${toPath(error.field.slice(1).split('/'))}: ${error.message}`;
}

/** `Schema validation failed` + one indented line per error (capped). */
export function schemaFailureMessage(errors: ValidationError[]): string {
  const lines = errors
    .slice(0, MESSAGE_ERROR_LIMIT)
    .map((e) => `  ${formatValidationError(e)}`);
  if (errors.length > MESSAGE_ERROR_LIMIT) {
    lines.push(
      `  … ${errors.length - MESSAGE_ERROR_LIMIT} more (run samaritan validate for all)`,
    );
  }
  return ['Schema validation failed', ...lines].join('\n');
}

/**
 * Validate operation data against JSON schema
 */
export function validateOperationSchema(data: any): ValidationError[] {
  const isValid = validateOperation(data);

  if (isValid || !validateOperation.errors) {
    return [];
  }

  return pruneOneOfErrors(validateOperation.errors).map((error) =>
    toValidationError(error, data),
  );
}

/**
 * Validate and throw on schema errors
 */
export function validateOperationSchemaStrict(data: any): void {
  const errors = validateOperationSchema(data);

  if (errors.length > 0) {
    throw new SchemaValidationError(schemaFailureMessage(errors), errors);
  }
}
