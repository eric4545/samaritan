import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { JSON_SCHEMA, load as parseYaml } from 'js-yaml';
import type { Postmortem } from '../models/postmortem';
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

/** An ISO-8601 date followed by a time (`T` or space separator). */
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
/** A trailing `Z` or `±HH:MM` / `±HHMM` / `±HH` zone designator. */
const ISO_ZONE_RE = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

/**
 * Check one timestamp. A date-time without a zone is rejected: JavaScript
 * reads it as the renderer's LOCAL time, so the same YAML would render (and
 * sort) differently on two machines. Bare dates and free-form clock strings
 * such as `16:20` or `18:05-18:10Z` are allowed.
 */
function timestampError(field: string, value: unknown): ValidationError[] {
  if (typeof value !== 'string' || !ISO_DATETIME_RE.test(value)) return [];
  if (!ISO_ZONE_RE.test(value)) {
    return [
      {
        field,
        message: `timestamp '${value}' has no time zone; append Z (UTC) or an offset such as +09:00`,
        value,
      },
    ];
  }
  if (Number.isNaN(Date.parse(value))) {
    return [
      { field, message: `timestamp '${value}' is not a valid date`, value },
    ];
  }
  return [];
}

/**
 * Timestamp checks the JSON schema cannot express: every ISO-8601 date-time
 * (incident window, detection time, timeline entries) must carry a zone.
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
  });
  return errors;
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
