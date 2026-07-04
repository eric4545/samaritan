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
