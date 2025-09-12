import { Command } from 'commander';
import { generateManual } from '../../manuals/generator';
import { parseOperation } from '../../operations/parser';
import fs from 'fs';
import path from 'path';

export const generateManualCommand = new Command('generate:manual')
  .description('Generate a Markdown manual from a SAMARITAN Operation YAML file.')
  .argument('<inputFile>', 'Path to the input YAML file')
  .argument('<outputFile>', 'Path to the output Markdown file')
  .action((inputFile: string, outputFile: string) => {
    try {
      console.log(`Parsing operation from: ${inputFile}`);
      const absoluteInputPath = path.resolve(inputFile);
      
      // 1. Parse the operation
      const operation = parseOperation(absoluteInputPath);
      
      console.log(`Generating manual for: ${operation.name}`);
      
      // 2. Generate the manual
      const markdown = generateManual(operation);

      const absoluteOutputPath = path.resolve(outputFile);
      fs.writeFileSync(absoluteOutputPath, markdown);

      console.log(`Successfully generated manual at: ${absoluteOutputPath}`);
    } catch (error) {
      console.error('Failed to generate manual:', (error as Error).message);
      process.exit(1);
    }
  });
