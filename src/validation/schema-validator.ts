import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
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
}

export class SchemaValidationError extends Error {
  public errors: ValidationError[];

  constructor(message: string, errors: ValidationError[]) {
    super(message);
    this.name = 'SchemaValidationError';
    this.errors = errors;
  }
}

/**
 * Validate operation data against JSON schema
 */
export function validateOperationSchema(data: any): ValidationError[] {
  const isValid = validateOperation(data);

  if (isValid) {
    return [];
  }

  const errors: ValidationError[] = [];

  if (validateOperation.errors) {
    for (const error of validateOperation.errors) {
      const unknownField = (error.params as any)?.additionalProperty as
        | string
        | undefined;
      const message =
        error.keyword === 'additionalProperties' && unknownField
          ? `unknown field '${unknownField}' at ${error.instancePath || 'root'}`
          : error.message || 'Validation failed';
      errors.push({
        field: error.instancePath || error.schemaPath || 'root',
        message,
        value: error.data,
      });
    }
  }

  return errors;
}

/**
 * Validate and throw on schema errors
 */
export function validateOperationSchemaStrict(data: any): void {
  const errors = validateOperationSchema(data);

  if (errors.length > 0) {
    throw new SchemaValidationError('Schema validation failed', errors);
  }
}
