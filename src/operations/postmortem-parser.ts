import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { JSON_SCHEMA, load as parseYaml } from 'js-yaml';
import { isIsoTimestamp, parseInstant } from '../manuals/postmortem-shared';
import type { Postmortem, TimelineEntry } from '../models/postmortem';
import {
  SchemaValidationError,
  type ValidationError,
} from '../validation/schema-validator';

// In CommonJS, __dirname is available globally
const schemaPath = join(__dirname, '../schemas/postmortem.schema.json');
const postmortemSchema = JSON.parse(readFileSync(schemaPath, 'utf8'));

const ajv = new Ajv({
  allErrors: true,
  verbose: true,
  strict: false,
});
addFormats(ajv);

const validate = ajv.compile(postmortemSchema);

/**
 * Validate postmortem data against the JSON schema, returning the list of
 * errors (empty when valid).
 */
export function validatePostmortemSchema(data: unknown): ValidationError[] {
  if (validate(data)) return [];

  const errors: ValidationError[] = [];
  for (const error of validate.errors ?? []) {
    errors.push({
      field: error.instancePath || error.schemaPath || 'root',
      message: error.message || 'Validation failed',
      value: error.data,
    });
  }
  return errors;
}

/**
 * An impossible ISO-8601 date (`2026-13-45T…`) is an error. A date-time
 * without a zone is allowed: it is read in the display time zone and
 * `generate postmortem` warns (see `postmortemWarnings`).
 */
function timestampError(field: string, value: unknown): ValidationError[] {
  if (typeof value !== 'string' || !isIsoTimestamp(value)) return [];
  if (parseInstant(value) === undefined) {
    return [
      { field, message: `timestamp '${value}' is not a valid date`, value },
    ];
  }
  return [];
}

/** `until` must be the same kind as `at`, and not before it. */
function untilError(i: number, entry: TimelineEntry): ValidationError[] {
  if (entry.until === undefined) return [];
  const field = `/timeline/${i}/until`;
  const atIso = isIsoTimestamp(entry.at);
  if (atIso !== isIsoTimestamp(entry.until)) {
    return [
      {
        field,
        message: atIso
          ? `until '${entry.until}' must be a full ISO-8601 timestamp like at '${entry.at}'`
          : `until '${entry.until}' must be a clock time like at '${entry.at}'`,
        value: entry.until,
      },
    ];
  }
  const start = parseInstant(entry.at);
  const end = parseInstant(entry.until);
  if (start !== undefined && end !== undefined && end < start) {
    return [
      {
        field,
        message: `until '${entry.until}' is before at '${entry.at}'`,
        value: entry.until,
      },
    ];
  }
  return [];
}

/**
 * Timestamp checks the JSON schema cannot express: real dates everywhere,
 * and a timeline `until` that matches its `at`.
 */
export function validatePostmortemTimestamps(
  pm: Postmortem,
): ValidationError[] {
  const errors: ValidationError[] = [
    ...timestampError('/occurred_at', pm.occurred_at),
    ...timestampError('/resolved_at', pm.resolved_at),
    ...timestampError('/detection/detected_at', pm.detection?.detected_at),
  ];
  (pm.timeline ?? []).forEach((entry, i) => {
    errors.push(...timestampError(`/timeline/${i}/at`, entry.at));
    errors.push(...timestampError(`/timeline/${i}/until`, entry.until));
    errors.push(...untilError(i, entry));
  });
  // One message per field: an invalid date also fails the until check.
  const seen = new Set<string>();
  return errors.filter((e) => !seen.has(e.field) && seen.add(e.field));
}

/**
 * Parse a postmortem YAML string into a validated `Postmortem`.
 * Throws `SchemaValidationError` when the document does not match the schema.
 */
export function parsePostmortem(yamlContent: string): Postmortem {
  // JSON_SCHEMA keeps unquoted ISO timestamps (and bare dates like 2026-07-15)
  // as strings instead of coercing them to JS Date objects.
  const data = parseYaml(yamlContent, { schema: JSON_SCHEMA });

  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new SchemaValidationError('Schema validation failed', [
      {
        field: 'root',
        message: 'Postmortem must be a YAML mapping',
        value: data,
      },
    ]);
  }

  const errors = validatePostmortemSchema(data);
  if (errors.length === 0)
    errors.push(...validatePostmortemTimestamps(data as Postmortem));
  if (errors.length > 0) {
    throw new SchemaValidationError('Schema validation failed', errors);
  }

  return data as Postmortem;
}

/**
 * Read and parse a postmortem YAML file.
 */
export function parsePostmortemFile(filePath: string): Postmortem {
  return parsePostmortem(readFileSync(filePath, 'utf8'));
}
