import { describe, it } from 'node:test'
import assert from 'node:assert'
import { generateConfluenceContent } from '../../src/cli/commands/generate'
import {
  deploymentOperation,
  deploymentOperationYaml,
  operationWithSubSteps,
  operationWithSectionHeadingsYaml,
  operationWithSectionHeadingFirstYaml,
  multiLineCommandYaml,
  subStepsYaml,
  dependenciesYaml,
  conditionalConfluenceYaml,
  markdownInstructionsYaml,
  markdownWithVariablesYaml,
  stepWithVariablesYaml,
  markdownLinksYaml,
  globalRollbackYaml,
  ganttTimelineYaml,
  evidenceRequiredYaml
} from '../fixtures/operations'
import * as yaml from 'js-yaml'

// Helper to generate Confluence content from YAML string
function generateConfluence(operationYaml: string, resolveVars: boolean = false, includeGantt: boolean = false, targetEnvironment?: string): string {
  const operation = yaml.load(operationYaml)
  return generateConfluenceContent(operation, resolveVars, includeGantt, targetEnvironment)
}

describe('Confluence Generator Tests', () => {
  it('should generate Confluence table with environment columns', () => {
    const content = generateConfluence(deploymentOperationYaml)

    // Should have table header with environment columns
    assert.match(content, /\|\| Step \|\| staging \|\| production \|\|/)

    // Should have phase headers (with Confluence emoticons)
    assert.match(content, /h2\. \(\/\) Pre-Flight Phase/)
    assert.match(content, /h2\. \(!\) Flight Phase/)
    assert.match(content, /h2\. \(on\) Post-Flight Phase/)
  })

  it('should include step metadata in first column', () => {
    const content = generateConfluence(deploymentOperationYaml)

    // Should include step with PIC, timeline, and ticket (Confluence emoticons)
    assert.match(content, /Health Check/)
    assert.match(content, /\(i\) PIC: john\.doe/)
    assert.match(content, /\(time\) Timeline: 2024-01-15 10:00/)
    assert.match(content, /\(flag\) Tickets: JIRA-123/)
  })

  it('should format multi-line commands with actual newlines', () => {
    const content = generateConfluence(multiLineCommandYaml)

    // Multi-line commands should use {code:bash} with actual newlines
    assert.match(content, /echo "line 1"\necho "line 2"\necho "line 3"/)
    // Should use {code:bash} for proper Confluence wiki markup
    assert.match(content, /\{code:bash\}/)
  })

  it('should substitute variables when resolveVars is true', () => {
    const content = generateConfluence(deploymentOperationYaml, true)

    // Should have substituted REPLICAS values
    assert.match(content, /--replicas=2/) // staging
    assert.match(content, /--replicas=5/) // production
  })

  it('should preserve variable placeholders when resolveVars is false', () => {
    const content = generateConfluence(deploymentOperationYaml, false)

    // Should have ${REPLICAS} placeholder
    assert.match(content, /\$\{REPLICAS\}/)
  })

  it('should handle sub-steps in table format', () => {
    const content = generateConfluence(subStepsYaml)

    // Should have sub-step rows with alphanumeric IDs
    assert.match(content, /Step 1: Parent Step/)
    assert.match(content, /Step 1a: Sub Task A/)
    assert.match(content, /Step 1b: Sub Task B/)
  })

  it('should create rollback table with environment columns', () => {
    const content = generateConfluence(deploymentOperationYaml)

    // Should have rollback section
    assert.match(content, /h2\. \(<\) Rollback Procedures/)

    // Should have table with environment columns
    assert.match(content, /\|\| Step \|\| staging \|\| production \|\|/)

    // Should have rollback command
    assert.match(content, /kubectl rollout undo/)
  })

  it('should include dependencies in step info', () => {
    const content = generateConfluence(dependenciesYaml)

    // Should show dependencies
    assert.match(content, /\(-\) Depends on: Step One/)
  })

  it('should display conditional steps with condition', () => {
    const content = generateConfluence(conditionalConfluenceYaml)

    // Should show conditional icon (Confluence emoticon) and expression with escaped braces
    assert.match(content, /\(\?\)/)
    assert.match(content, /\(\?\) Condition: \$\\{ENVIRONMENT\\} == 'production'/)
  })

  it('should use type and phase icons', () => {
    const content = generateConfluence(deploymentOperationYaml)

    // Should have type icons (Confluence emoticons)
    assert.match(content, /\(\*\)/) // automatic
    assert.match(content, /\(i\)/) // manual

    // Should have phase icons (Confluence emoticons)
    assert.match(content, /\(\/\)/) // preflight (checkmark)
    assert.match(content, /\(!\)/) // flight (warning)
    assert.match(content, /\(on\)/) // postflight (lightbulb on)
  })

  it('should include environment details section', () => {
    const content = generateConfluence(deploymentOperationYaml)

    // Should have environments table with Variables column
    assert.match(content, /h2\. Environments/)
    assert.match(content, /\|\| Environment \|\| Description \|\| Approval Required \|\| Validation Required \|\| Targets \|\| Variables \|\|/)

    // Should have variables in table with expand macro (not as separate h3 sections)
    assert.match(content, /\{expand:title=Show \d+ variables\}/)
    assert.match(content, /REPLICAS=/)

    // Should NOT have separate h3 variable sections
    assert.doesNotMatch(content, /h3\. staging - Variables/)
    assert.doesNotMatch(content, /h3\. production - Variables/)
  })

  it('should handle markdown instructions wrapped in markdown block', () => {
    const content = generateConfluence(markdownInstructionsYaml)

    // Should wrap markdown instructions in {markdown} block to preserve formatting and links
    assert.match(content, /\{markdown\}/)
    assert.match(content, /# Instructions/)
    assert.match(content, /\*\*Important note\*\*/)
    // Should preserve markdown list syntax (not convert to Confluence markup)
    assert.match(content, /1\. First thing/)
    assert.match(content, /2\. Second thing/)
  })

  it('should preserve variables in markdown instructions without escaping', () => {
    const content = generateConfluence(markdownWithVariablesYaml)

    // Variables in {markdown} block don't need escaping
    assert.match(content, /\{markdown\}/)
    assert.match(content, /\$\{API_ENDPOINT\}/)
    assert.match(content, /\$\{DB_HOST\}/)
    assert.match(content, /\$\{FOO\}/)

    // Should still have the markdown content
    assert.match(content, /# Check health endpoints/)
  })

  it('should escape Confluence macros in step names and descriptions', () => {
    const content = generateConfluence(stepWithVariablesYaml)

    // Variables in step names, descriptions, and conditions should be escaped
    assert.match(content, /Deploy \$\\{SERVICE_NAME\\} to cluster/)
    assert.match(content, /Deploys using \$\\{DEPLOY_METHOD\\}/)
    assert.match(content, /Condition: \$\\{ENVIRONMENT\\}/)
  })

  it('should include operation metadata in panel', () => {
    const content = generateConfluence(deploymentOperationYaml)

    // Should have overview panel
    assert.match(content, /\{panel:title=Deploy Web Server - Operation Documentation/)
    assert.match(content, /h2\. Overview/)
    assert.match(content, /\*Version:\* 1\.1\.0/)
    assert.match(content, /\*Description:\*/)
  })

  it('should show generation info in footer', () => {
    const content = generateConfluence(deploymentOperationYaml)

    // Should have footer with generation info
    assert.match(content, /\{panel:title=Generated Information/)
    assert.match(content, /\*Generated on:\*/)
    assert.match(content, /\*Generated by:\* SAMARITAN CLI/)
  })

  it('should preserve markdown links in markdown block', () => {
    const content = generateConfluence(markdownLinksYaml)

    // Markdown links should be preserved in markdown format ({markdown} block displays them)
    assert.match(content, /\{markdown\}/)
    assert.match(content, /\[API Docs\]\(https:\/\/api\.example\.com\/docs\)/)
    assert.match(content, /\[Dashboard\]\(https:\/\/dashboard\.example\.com\)/)
    assert.match(content, /\[Support\]\(mailto:support@example\.com\)/)
  })

  it('should render global rollback section with instructions', () => {
    const content = generateConfluence(globalRollbackYaml)

    // Should have global rollback section
    assert.match(content, /h3\. Global Rollback Plan/)
    assert.match(content, /\*Automatic\*: No/)
    assert.match(content, /\*Conditions\*: health_check_failure, error_rate_spike/)

    // Should show both rollback steps
    assert.match(content, /Rollback Step 1/)
    assert.match(content, /kubectl rollout undo/)
    assert.match(content, /Rollback Step 2/)
    assert.match(content, /\{markdown\}/)
    assert.match(content, /Verify rollback completed:/)
    assert.match(content, /1\. Check pods are running/)
    assert.match(content, /2\. Test API endpoints/)
  })

  it('should handle section_heading to break up tables', () => {
    const content = generateConfluence(operationWithSectionHeadingsYaml)

    // Should have section heading before the step
    assert.match(content, /h3\. Database Migration/)
    assert.match(content, /Migrate database schema/)

    // Should show PIC and timeline metadata under heading
    assert.match(content, /\(i\) PIC: DBA Team/)
    assert.match(content, /\(time\) Timeline: 2024-01-15 10:00/)

    // Should have table before section
    assert.match(content, /Step 1: Step Before Section/)

    // Should reopen table after section heading
    assert.match(content, /\|\| Step \|\| staging \|\| production \|\|/)

    // Section heading step should still be in table (but after heading)
    assert.match(content, /Step 2: Database Migration/)
    assert.match(content, /Step 3: Step After Section/)
  })

  it('should not generate empty table when section_heading is first step', () => {
    const content = generateConfluence(operationWithSectionHeadingFirstYaml)

    // Should have phase header
    assert.match(content, /h2\. \(!\) Flight Phase/)

    // Should NOT have empty table before section heading
    // The pattern to avoid: || Step || staging || production ||\n\nh3.
    assert.doesNotMatch(content, /\|\| Step \|\|.*\n\nh3\. Initial Setup/)

    // Should have section heading immediately after phase header
    assert.match(content, /Flight Phase.*\n\nh3\. Initial Setup/s)

    // Should have description
    assert.match(content, /Setup required before deployment/)

    // Should have PIC metadata
    assert.match(content, /\(i\) PIC: DevOps Team/)

    // After section heading, should have table with steps
    assert.match(content, /h3\. Initial Setup.*\|\| Step \|\| staging \|\| production \|\|/s)
    assert.match(content, /Step 1: Initial Setup/)
    assert.match(content, /Step 2: Deploy App/)
    assert.match(content, /Step 3: Verify/)
  })

  it('should include Gantt chart when requested with timeline data', () => {
    const content = generateConfluence(ganttTimelineYaml, false, true)

    // Should include Mermaid Gantt chart wrapped in {markdown}
    assert.match(content, /h2\. Timeline Schedule/)
    assert.match(content, /\{markdown\}/)
    assert.match(content, /```mermaid/)
    assert.match(content, /gantt/)
    assert.match(content, /title Deployment with Timeline Timeline/)

    // Should include phase sections
    assert.match(content, /section 🛫 Pre-Flight Phase/)
    assert.match(content, /section ✈️ Flight Phase/)
    assert.match(content, /section 🛬 Post-Flight Phase/)

    // Should include step names with PICs
    assert.match(content, /Pre-deployment Check \(DevOps Team\)/)
    assert.match(content, /Deploy Backend \(Backend Team\)/)
    assert.match(content, /Deploy Frontend \(Frontend Team\)/)
    assert.match(content, /Post-deployment Verification \(QA Team\)/)

    // Should include timeline data
    assert.match(content, /:2024-01-15 09:00, 30m/)
    assert.match(content, /:active, 15m/)
    assert.match(content, /:after Deploy Backend, 10m/)
    assert.match(content, /:after Deploy Frontend, 20m/)
  })

  it('should not include Gantt chart when not requested', () => {
    const content = generateConfluence(ganttTimelineYaml, false, false)

    // Should not include Mermaid Gantt chart when includeGantt is false
    assert.doesNotMatch(content, /\{markdown\}/)
    assert.doesNotMatch(content, /```mermaid/)
    assert.doesNotMatch(content, /gantt/)
    assert.doesNotMatch(content, /h2\. Timeline Schedule/)
  })

  it('should not include Gantt chart when no steps have timeline', () => {
    // Use simple YAML without any timeline data
    const noTimelineYaml = `name: No Timeline
version: 1.0.0
description: Test operation without timeline

environments:
  - name: staging

steps:
  - name: Deploy
    type: automatic
    phase: flight
    command: kubectl apply -f app.yaml
`
    const content = generateConfluence(noTimelineYaml, false, true)

    // Should not include Gantt chart when no timeline data exists
    assert.doesNotMatch(content, /\{markdown\}/)
    assert.doesNotMatch(content, /```mermaid/)
    assert.doesNotMatch(content, /h2\. Timeline Schedule/)
  })

  it('should filter environments when targetEnvironment is specified (staging only)', () => {
    const content = generateConfluence(deploymentOperationYaml, false, false, 'staging')

    // Should only have staging column in table header
    assert.match(content, /\|\| Step \|\| staging \|\|/)

    // Should NOT have production column
    assert.doesNotMatch(content, /\|\| Step \|\| staging \|\| production \|\|/)
    assert.doesNotMatch(content, /production \|\|/)

    // Should show only staging in environments overview
    assert.match(content, /\*Environments:\* staging/)
    assert.doesNotMatch(content, /\*Environments:\*.*production/)
  })

  it('should filter environments when targetEnvironment is specified (production only)', () => {
    const content = generateConfluence(deploymentOperationYaml, false, false, 'production')

    // Should only have production column in table header
    assert.match(content, /\|\| Step \|\| production \|\|/)

    // Should NOT have staging column
    assert.doesNotMatch(content, /\|\| Step \|\| staging \|\| production \|\|/)
    assert.doesNotMatch(content, /staging \|\|/)

    // Should show only production in environments overview
    assert.match(content, /\*Environments:\* production/)
    assert.doesNotMatch(content, /\*Environments:\*.*staging/)
  })

  it('should show all environments when targetEnvironment is not specified', () => {
    const content = generateConfluence(deploymentOperationYaml, false, false)

    // Should have both staging and production columns
    assert.match(content, /\|\| Step \|\| staging \|\| production \|\|/)

    // Should show both environments in environments overview
    assert.match(content, /\*Environments:\* staging, production/)
  })

  it('should throw error when targetEnvironment does not exist', () => {
    assert.throws(
      () => generateConfluence(deploymentOperationYaml, false, false, 'nonexistent'),
      /Environment 'nonexistent' not found/
    )
  })

  it('should render evidence expand macro when evidence is required', () => {
    const content = generateConfluence(evidenceRequiredYaml)

    // Should have evidence expand macro for Deploy Application step (required, multiple types)
    assert.match(content, /\{expand:title=📎 Evidence \(Required - screenshot, command_output\)\}Paste evidence here\{expand\}/)

    // Should have evidence expand macro for Manual Verification step (required, single type)
    assert.match(content, /\{expand:title=📎 Evidence \(Required - screenshot\)\}Paste evidence here\{expand\}/)

    // Should have evidence expand macro for Optional Check step (optional)
    assert.match(content, /\{expand:title=📎 Evidence \(Optional - screenshot, log\)\}Paste evidence here\{expand\}/)
  })

  it('should not render evidence expand macro when evidence is not specified', () => {
    const content = generateConfluence(evidenceRequiredYaml)

    // Count evidence expand macros - should be 3 (one for each step with evidence, repeated across environments)
    const evidenceMatches = content.match(/\{expand:title=📎 Evidence/g)
    // We have 2 environments (staging, production) and 3 steps with evidence = 6 expand macros
    assert.strictEqual(evidenceMatches?.length, 6, 'Should have exactly 6 evidence expand macros (3 steps × 2 environments)')

    // The "No Evidence" step should not have an expand macro
    // Search for the No Evidence step and verify no evidence expand immediately follows
    const noEvidencePattern = /No Evidence.*?\n/
    assert.match(content, noEvidencePattern)
  })

  it('should render evidence with required indicator', () => {
    const content = generateConfluence(evidenceRequiredYaml)

    // Required evidence should have "Required" in the title
    assert.match(content, /Evidence \(Required/)

    // Optional evidence should have "Optional" in the title
    assert.match(content, /Evidence \(Optional/)
  })

  it('should include evidence types in expand macro title', () => {
    const content = generateConfluence(evidenceRequiredYaml)

    // Should show evidence types in the title
    assert.match(content, /Evidence \(Required - screenshot, command_output\)/)
    assert.match(content, /Evidence \(Optional - screenshot, log\)/)
  })
})
