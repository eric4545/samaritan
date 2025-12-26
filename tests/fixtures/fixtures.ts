import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Operation } from '../../src/models/operation';
import { parseOperation } from '../../src/operations/parser';

/**
 * Centralized fixture path mapping
 *
 * Benefits:
 * - Type-safe fixture references with autocomplete
 * - Single source of truth for fixture locations
 * - Easy to reuse examples/*.yaml files
 * - No hardcoded paths scattered across tests
 */
export const FIXTURES = {
  // ===== Valid Operations =====
  // Reuse existing examples where possible
  deployment: 'examples/deployment.yaml',
  progressiveRollout: 'examples/progressive-rollout.yaml',
  multiRegion: 'examples/multi-region-deployment.yaml',
  complexDeployment: 'examples/complex-deployment.yaml',
  nestedDeployment: 'examples/nested-deployment.yaml',

  // Test-specific valid fixtures
  minimal: 'tests/fixtures/operations/valid/minimal.yaml',
  enhanced: 'tests/fixtures/operations/valid/enhanced.yaml',
  enhancedStepFields:
    'tests/fixtures/operations/valid/enhanced-step-fields.yaml',
  enhancedPreflight: 'tests/fixtures/operations/valid/enhanced-preflight.yaml',
  deploymentTest: 'tests/fixtures/operations/valid/deployment-test.yaml',
  withOverview: 'tests/fixtures/operations/valid/with-overview.yaml',

  // ===== Invalid Operations =====
  invalid: 'tests/fixtures/operations/invalid/missing-fields.yaml',
  missingTemplate: 'tests/fixtures/operations/invalid/missing-template.yaml',
  missingTemplateVars:
    'tests/fixtures/operations/invalid/missing-template-vars.yaml',

  // ===== Feature-Specific Tests =====
  // Foreach & Matrix
  foreachLoop: 'tests/fixtures/operations/features/foreach-loop.yaml',
  matrixForeach: 'tests/fixtures/operations/features/matrix-foreach.yaml',
  matrixWithFilters:
    'tests/fixtures/operations/features/matrix-with-filters.yaml',

  // Conditional steps
  conditional: 'tests/fixtures/operations/features/conditional.yaml',

  // Variable resolution
  variableInCodeBlock:
    'tests/fixtures/operations/valid/variable-in-code-block.yaml',

  // Section headings
  sectionHeading: 'tests/fixtures/operations/features/section-heading.yaml',
  sectionHeadingFirst:
    'tests/fixtures/operations/features/section-heading-first.yaml',

  // Nested sub-steps
  nestedSubSteps2Levels:
    'tests/fixtures/operations/features/nested-substeps-2-levels.yaml',
  nestedSubSteps3Levels:
    'tests/fixtures/operations/features/nested-substeps-3-levels.yaml',
  nestedSubSteps4Levels:
    'tests/fixtures/operations/features/nested-substeps-4-levels.yaml',
  nestedSubStepsWithSections:
    'tests/fixtures/operations/features/nested-substeps-with-sections.yaml',
  manySubSteps: 'tests/fixtures/operations/features/many-substeps.yaml',

  // Evidence with results
  evidenceWithResults:
    'tests/fixtures/operations/features/evidence-with-results.yaml',
  evidenceOverrideInUse:
    'tests/fixtures/operations/features/evidence-override-in-use.yaml',
  reviewerAndEnvEvidence:
    'tests/fixtures/operations/features/reviewer-and-env-evidence.yaml',

  // Step library imports (use: directive)
  useInSubSteps: 'tests/fixtures/operations/features/use-in-substeps.yaml',

  // Rollback for sub-steps
  substepRollback: 'tests/fixtures/operations/features/substep-rollback.yaml',

  // Parent step with both sub_steps and rollback
  parentStepWithSubstepsAndRollback:
    'tests/fixtures/operations/features/parent-step-with-substeps-and-rollback.yaml',

  // Nested sub-step with rollback
  nestedSubstepWithRollback:
    'tests/fixtures/operations/features/nested-substep-with-rollback.yaml',

  // When and Variants
  whenAndVariants: 'tests/fixtures/operations/features/when-and-variants.yaml',

  // ===== Confluence Generator Tests =====
  multiLineCommand:
    'tests/fixtures/operations/confluence/multi-line-command.yaml',
  subSteps: 'tests/fixtures/operations/confluence/sub-steps.yaml',
  dependencies: 'tests/fixtures/operations/confluence/dependencies.yaml',
  conditionalConfluence:
    'tests/fixtures/operations/confluence/conditional.yaml',
  markdownInstructions:
    'tests/fixtures/operations/confluence/markdown-instructions.yaml',
  markdownWithVariables:
    'tests/fixtures/operations/confluence/markdown-with-variables.yaml',
  stepWithVariables:
    'tests/fixtures/operations/confluence/step-with-variables.yaml',
  markdownLinks: 'tests/fixtures/operations/confluence/markdown-links.yaml',
  globalRollback: 'tests/fixtures/operations/confluence/global-rollback.yaml',
  ganttTimeline: 'tests/fixtures/operations/confluence/gantt-timeline.yaml',
  evidenceRequired:
    'tests/fixtures/operations/confluence/evidence-required.yaml',
} as const;

/**
 * Load YAML content from a fixture file
 *
 * @param key - Fixture key from FIXTURES mapping
 * @returns Raw YAML file content as string
 *
 * @example
 * const yamlContent = loadYaml('minimal');
 * // Returns: "name: Minimal Test\nversion: 1.0.0\n..."
 */
export function loadYaml(key: keyof typeof FIXTURES): string {
  const fixturePath = FIXTURES[key];
  const absolutePath = join(process.cwd(), fixturePath);

  try {
    return readFileSync(absolutePath, 'utf-8');
  } catch (error) {
    throw new Error(
      `Failed to load fixture "${key}" from ${fixturePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Parse a fixture file into an Operation object
 *
 * @param key - Fixture key from FIXTURES mapping
 * @returns Parsed Operation object
 *
 * @example
 * const operation = await parseFixture('deployment');
 * assert.strictEqual(operation.name, 'Deploy Web Server');
 */
export async function parseFixture(
  key: keyof typeof FIXTURES,
): Promise<Operation> {
  const fixturePath = FIXTURES[key];
  const absolutePath = join(process.cwd(), fixturePath);

  try {
    return await parseOperation(absolutePath);
  } catch (error) {
    throw new Error(
      `Failed to parse fixture "${key}" from ${fixturePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Get absolute path to a fixture file
 * Useful for CLI tests that need to pass file paths
 *
 * @param key - Fixture key from FIXTURES mapping
 * @returns Absolute file path to the fixture
 *
 * @example
 * const path = getFixturePath('deployment');
 * execSync(`npx tsx src/cli/index.ts validate ${path}`);
 */
export function getFixturePath(key: keyof typeof FIXTURES): string {
  return join(process.cwd(), FIXTURES[key]);
}
