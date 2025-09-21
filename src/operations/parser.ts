import fs from 'fs';
import yaml from 'js-yaml';
import { Operation, Environment, VariableMatrix, OperationMetadata } from '../models/operation';
import { randomUUID } from 'crypto';

export function parseOperation(filePath: string): Operation {
  const fileContents = fs.readFileSync(filePath, 'utf8');
  const data: unknown = yaml.load(fileContents);

  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid YAML: not an object.');
  }

  const rawOperation = data as any;
  
  // Validate required fields
  if (!rawOperation.name || !rawOperation.version || !rawOperation.steps) {
    throw new Error('Invalid Operation YAML: missing required fields (name, version, steps).');
  }

  // Generate defaults for new required fields
  const now = new Date();
  
  // Handle environments - convert legacy format to new format
  let environments: Environment[] = [];
  if (rawOperation.environments && Array.isArray(rawOperation.environments)) {
    environments = rawOperation.environments.map((env: any) => ({
      name: env.name || 'default',
      description: env.description || '',
      variables: env.variables || {},
      restrictions: env.restrictions || [],
      approval_required: env.approval_required || false,
      validation_required: env.validation_required || false,
      targets: env.targets || []
    }));
  } else {
    // Create default environment if none specified
    environments = [{
      name: 'default',
      description: 'Default environment',
      variables: {},
      restrictions: [],
      approval_required: false,
      validation_required: false,
      targets: []
    }];
  }

  // Build variable matrix from environments
  const variables: VariableMatrix = {};
  environments.forEach(env => {
    variables[env.name] = env.variables;
  });

  // Create metadata
  const metadata: OperationMetadata = {
    created_at: now,
    updated_at: now,
    execution_count: 0
  };

  // Construct full operation with defaults
  const operation: Operation = {
    id: rawOperation.id || randomUUID(),
    name: rawOperation.name,
    version: rawOperation.version,
    description: rawOperation.description || '',
    author: rawOperation.author,
    category: rawOperation.category,
    tags: rawOperation.tags || [],
    emergency: rawOperation.emergency || false,
    environments,
    variables,
    steps: rawOperation.steps || [],
    preflight: rawOperation.preflight || [],
    rollback: rawOperation.rollback,
    metadata,
    needs: rawOperation.needs,
    uses: rawOperation.uses,
    with: rawOperation.with,
    matrix: rawOperation.matrix,
    reporting: rawOperation.reporting
  };

  return operation;
}