import fs from 'fs';
import yaml from 'js-yaml';
import { Operation } from '../models/operation';

export function parseOperation(filePath: string): Operation {
  const fileContents = fs.readFileSync(filePath, 'utf8');
  const data: unknown = yaml.load(fileContents);

  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid YAML: not an object.');
  }

  // Basic validation to ensure the object looks like an Operation.
  // The Operation, Environment, and Step interfaces now include environments, targets (within Environment), and step types.
  const operation = data as Operation;
  if (!operation.name || !operation.version || !operation.steps) {
    throw new Error('Invalid Operation YAML: missing required fields (name, version, steps).');
  }

  // Further validation can be added here (e.g., using a schema validator like Zod)

  return operation;
}