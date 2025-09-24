import { Command } from 'commander';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { parseOperation } from '../../operations/parser';
import { Operation } from '../../models/operation';
import { ValidationError } from '../../validation/schema-validator';

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  operation?: Operation;
}

interface ValidationOptions {
  strict?: boolean;
  environment?: string;
  verbose?: boolean;
}

class OperationValidator {
  async validateFile(filePath: string, options: ValidationOptions = {}): Promise<ValidationResult> {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: []
    };

    try {
      // Check file exists
      if (!existsSync(filePath)) {
        result.errors.push(`File not found: ${filePath}`);
        result.valid = false;
        return result;
      }

      // Parse operation
      const operation = await parseOperation(filePath);
      result.operation = operation;

      // Basic validation (already done by parser)
      console.log('✅ YAML syntax valid');
      console.log('✅ Operation schema valid');

      // Additional validations
      this.validateOperationStructure(operation, result, options);
      this.validateEnvironments(operation, result, options);
      this.validateSteps(operation, result, options);
      this.validateVariables(operation, result, options);
      this.validatePreflight(operation, result, options);

      if (options.strict) {
        this.strictValidation(operation, result, options);
      }

      if (options.environment) {
        this.validateForEnvironment(operation, options.environment, result);
      }

    } catch (error: any) {
      result.errors.push(`Parsing error: ${error.message}`);
      if (error.errors && Array.isArray(error.errors)) {
        error.errors.forEach((validationError: any) => {
          result.errors.push(`  ${validationError.field}: ${validationError.message}`);
        });
      }
      result.valid = false;
    }

    result.valid = result.errors.length === 0;
    return result;
  }

  private validateOperationStructure(operation: Operation, result: ValidationResult, options: ValidationOptions): void {
    // Version validation
    if (!operation.version.match(/^\d+\.\d+\.\d+$/)) {
      result.warnings.push('Version should follow semantic versioning (e.g., 1.0.0)');
    }

    // Required fields
    if (!operation.description || operation.description.trim().length === 0) {
      result.warnings.push('Operation description is empty or missing');
    }

    if (!operation.author && options.strict) {
      result.warnings.push('Operation author not specified (recommended for traceability)');
    }

    if (!operation.category && options.strict) {
      result.warnings.push('Operation category not specified (recommended for organization)');
    }

    // Emergency operations validation
    if (operation.emergency) {
      if (!operation.category?.includes('emergency') && !operation.category?.includes('incident')) {
        result.warnings.push('Emergency operations should have category "emergency" or "incident"');
      }
      
      if (operation.steps.some(step => step.approval?.required)) {
        result.warnings.push('Emergency operations typically should not require approvals');
      }
    }
  }

  private validateEnvironments(operation: Operation, result: ValidationResult, options: ValidationOptions): void {
    if (operation.environments.length === 0) {
      result.errors.push('At least one environment must be defined');
      return;
    }

    const envNames = new Set<string>();
    for (const env of operation.environments) {
      // Check for duplicate environment names
      if (envNames.has(env.name)) {
        result.errors.push(`Duplicate environment name: ${env.name}`);
      }
      envNames.add(env.name);

      // Validate environment structure
      if (!env.description || env.description.trim().length === 0) {
        result.warnings.push(`Environment ${env.name} is missing description`);
      }

      // Production environment checks
      if (env.name.toLowerCase().includes('prod')) {
        if (!env.approval_required && options.strict) {
          result.warnings.push(`Production environment ${env.name} should require approval`);
        }
        
        if (!env.validation_required && options.strict) {
          result.warnings.push(`Production environment ${env.name} should require validation`);
        }
      }
    }
  }

  private validateSteps(operation: Operation, result: ValidationResult, options: ValidationOptions): void {
    if (operation.steps.length === 0) {
      result.errors.push('At least one step must be defined');
      return;
    }

    const stepNames = new Set<string>();
    const stepIds = new Set<string>();
    
    // First pass: collect all step names and IDs
    for (let i = 0; i < operation.steps.length; i++) {
      const step = operation.steps[i];
      stepNames.add(step.name);
      if (step.id) {
        stepIds.add(step.id);
      }
    }
    
    for (let i = 0; i < operation.steps.length; i++) {
      const step = operation.steps[i];
      
      // Check step ID uniqueness
      if (step.id) {
        const duplicateId = Array.from(stepIds).filter(id => id === step.id).length > 1;
        if (duplicateId) {
          result.errors.push(`Duplicate step ID: ${step.id}`);
        }
      }

      // Note: Basic step type validation (command/instruction requirements) is now handled by JSON schema

      // Validate dependencies (check both step names and IDs)
      if (step.needs) {
        for (const dep of step.needs) {
          if (!stepNames.has(dep) && !stepIds.has(dep)) {
            result.warnings.push(`Step ${i + 1} (${step.name}): dependency '${dep}' not found among step names or IDs`);
          }
        }
      }

      // Evidence validation
      if (step.evidence_required && (!step.evidence_types || step.evidence_types.length === 0)) {
        result.warnings.push(`Step ${i + 1} (${step.name}): evidence required but no evidence types specified`);
      }

      // Timeout validation
      if (step.timeout && step.timeout < 0) {
        result.errors.push(`Step ${i + 1} (${step.name}): timeout cannot be negative`);
      }

      // Estimated duration validation
      if (step.estimated_duration && step.estimated_duration < 0) {
        result.errors.push(`Step ${i + 1} (${step.name}): estimated_duration cannot be negative`);
      }

      // Rollback validation
      if (step.rollback && !step.rollback.command && !step.rollback.instruction) {
        result.warnings.push(`Step ${i + 1} (${step.name}): rollback defined but no command or instruction specified`);
      }
    }
  }

  private validateVariables(operation: Operation, result: ValidationResult, options: ValidationOptions): void {
    // Collect all variable references from steps
    const usedVariables = new Set<string>();
    
    for (const step of operation.steps) {
      // Simple regex to find ${variable} patterns
      const variableRegex = /\$\{([^}]+)\}/g;
      
      [step.command, step.instruction, JSON.stringify(step.env || {})]
        .filter(Boolean)
        .forEach(text => {
          let match;
          while ((match = variableRegex.exec(text!)) !== null) {
            usedVariables.add(match[1]);
          }
        });
    }

    // Check if all used variables are defined in environments
    for (const envName of Object.keys(operation.variables)) {
      const envVariables = new Set(Object.keys(operation.variables[envName]));
      
      for (const usedVar of usedVariables) {
        // Skip built-in variables
        if (['DATE', 'TIME', 'USER', 'environment'].includes(usedVar)) {
          continue;
        }
        
        if (!envVariables.has(usedVar)) {
          result.warnings.push(`Variable '${usedVar}' used in steps but not defined in environment '${envName}'`);
        }
      }
    }
  }

  private validatePreflight(operation: Operation, result: ValidationResult, options: ValidationOptions): void {
    for (let i = 0; i < operation.preflight.length; i++) {
      const check = operation.preflight[i];
      
      if (check.type === 'command' && !check.command) {
        result.errors.push(`Preflight check ${i + 1} (${check.name}): command type requires a command`);
      }
      
      if (check.type === 'manual' && !check.description) {
        result.warnings.push(`Preflight check ${i + 1} (${check.name}): manual checks should have detailed description`);
      }

      if (check.timeout && check.timeout < 0) {
        result.errors.push(`Preflight check ${i + 1} (${check.name}): timeout cannot be negative`);
      }
    }
  }

  private strictValidation(operation: Operation, result: ValidationResult, options: ValidationOptions): void {
    // Strict mode additional checks
    if (!operation.rollback) {
      result.warnings.push('No rollback plan defined (recommended for production operations)');
    }

    if (operation.steps.filter(s => s.evidence_required).length === 0) {
      result.warnings.push('No steps require evidence collection (recommended for audit trails)');
    }

    if (!operation.preflight || operation.preflight.length === 0) {
      result.warnings.push('No preflight checks defined (recommended to validate prerequisites)');
    }

    // Check for hardcoded values that should be variables
    for (const step of operation.steps) {
      if (step.command?.includes('prod') || step.instruction?.includes('prod')) {
        result.warnings.push(`Step ${step.name}: possible hardcoded environment reference, consider using variables`);
      }
    }
  }

  private validateForEnvironment(operation: Operation, envName: string, result: ValidationResult): void {
    const environment = operation.environments.find(env => env.name === envName);
    if (!environment) {
      result.errors.push(`Environment '${envName}' not found in operation`);
      return;
    }

    // Check if all required variables are defined for this environment
    const envVariables = operation.variables[envName] || {};
    
    if (Object.keys(envVariables).length === 0) {
      result.warnings.push(`No variables defined for environment '${envName}'`);
    }
  }
}

const validateCommand = new Command('validate')
  .description('Validate operation definitions')
  .argument('<file>', 'Path to operation YAML file')
  .option('--strict', 'Enable strict validation with best practices')
  .option('--env <environment>', 'Validate for specific environment')
  .option('-v, --verbose', 'Verbose output')
  .action(async (file: string, options: ValidationOptions) => {
    const validator = new OperationValidator();
    
    console.log(`🔍 Validating operation: ${file}\n`);
    
    try {
      const result = await validator.validateFile(file, options);
      
      if (options.verbose && result.operation) {
        console.log(`📋 Operation: ${result.operation.name} v${result.operation.version}`);
        console.log(`📝 Description: ${result.operation.description}`);
        console.log(`🏗️  Environments: ${result.operation.environments.map(e => e.name).join(', ')}`);
        console.log(`🔧 Steps: ${result.operation.steps.length}`);
        console.log('');
      }

      // Display warnings
      if (result.warnings.length > 0) {
        console.log('⚠️  Warnings:');
        result.warnings.forEach(warning => console.log(`   ${warning}`));
        console.log('');
      }

      // Display errors
      if (result.errors.length > 0) {
        console.log('❌ Errors:');
        result.errors.forEach(error => console.log(`   ${error}`));
        console.log('');
      }

      // Final result
      if (result.valid) {
        console.log('✅ Operation validation passed!');
        if (result.warnings.length > 0) {
          console.log(`   ${result.warnings.length} warning(s) found`);
        }
        process.exit(0);
      } else {
        console.log('❌ Operation validation failed!');
        console.log(`   ${result.errors.length} error(s) found`);
        process.exit(1);
      }
      
    } catch (error: any) {
      console.error(`❌ Validation failed: ${error.message}`);
      process.exit(1);
    }
  });

export { validateCommand };