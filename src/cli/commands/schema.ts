import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';

interface SchemaExportOptions {
  output?: string;
  format?: 'json' | 'yaml';
}

/**
 * Export operation JSON schema for user inspection and integration
 */
const schemaCommand = new Command('schema')
  .description('Export operation JSON schema')
  .option('-o, --output <file>', 'Output file (default: stdout)')
  .option(
    '-f, --format <format>',
    'Output format: json or yaml',
    'json',
  )
  .action(async (options: SchemaExportOptions) => {
    try {
      // Locate schema file (works in both dev and built environments)
      let schemaPath: string;

      // Try built version first (dist/schemas/)
      const builtSchemaPath = join(__dirname, '../../schemas/operation.schema.json');
      const srcSchemaPath = join(process.cwd(), 'src/schemas/operation.schema.json');

      try {
        readFileSync(builtSchemaPath, 'utf-8');
        schemaPath = builtSchemaPath;
      } catch {
        schemaPath = srcSchemaPath;
      }

      // Read schema
      const schemaContent = readFileSync(schemaPath, 'utf-8');
      const schema = JSON.parse(schemaContent);

      let output: string;

      if (options.format === 'yaml') {
        // Convert JSON to YAML format
        // Simple conversion - for better YAML, would need js-yaml dependency
        output = jsonToSimpleYaml(schema);
      } else {
        // Pretty-print JSON
        output = JSON.stringify(schema, null, 2);
      }

      // Write to file or stdout
      if (options.output) {
        writeFileSync(options.output, output, 'utf-8');
        console.log(`✅ Schema exported to: ${options.output}`);
      } else {
        console.log(output);
      }

      process.exit(0);
    } catch (error: any) {
      console.error(`❌ Failed to export schema: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * Simple JSON to YAML converter (basic implementation)
 * For production use, consider using js-yaml library
 */
function jsonToSimpleYaml(obj: any, indent = 0): string {
  const spaces = '  '.repeat(indent);
  let yaml = '';

  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (typeof item === 'object' && item !== null) {
        yaml += `${spaces}-\n${jsonToSimpleYaml(item, indent + 1)}`;
      } else {
        yaml += `${spaces}- ${item}\n`;
      }
    }
  } else if (typeof obj === 'object' && obj !== null) {
    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value)) {
        yaml += `${spaces}${key}:\n${jsonToSimpleYaml(value, indent + 1)}`;
      } else if (typeof value === 'object' && value !== null) {
        yaml += `${spaces}${key}:\n${jsonToSimpleYaml(value, indent + 1)}`;
      } else if (typeof value === 'string') {
        // Handle multiline strings
        if (value.includes('\n')) {
          yaml += `${spaces}${key}: |\n`;
          for (const line of value.split('\n')) {
            yaml += `${spaces}  ${line}\n`;
          }
        } else {
          yaml += `${spaces}${key}: "${value}"\n`;
        }
      } else {
        yaml += `${spaces}${key}: ${value}\n`;
      }
    }
  } else {
    yaml += `${spaces}${obj}\n`;
  }

  return yaml;
}

export { schemaCommand };
