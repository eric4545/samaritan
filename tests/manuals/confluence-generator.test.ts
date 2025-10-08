import { describe, it } from 'node:test'
import assert from 'node:assert'
import { generateConfluenceContent } from '../../src/cli/commands/generate'
import { deploymentOperation, deploymentOperationYaml, operationWithSubSteps, operationWithSectionHeadingsYaml } from '../fixtures/operations'
import * as yaml from 'js-yaml'

// Helper to generate Confluence content from YAML string
function generateConfluence(operationYaml: string, resolveVars: boolean = false): string {
  const operation = yaml.load(operationYaml)
  return generateConfluenceContent(operation, resolveVars)
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
    const multiLineYaml = `name: Multi-line Test
version: 1.0.0
description: Test multi-line commands

environments:
  - name: staging
    variables:
      ENV: staging

steps:
  - name: Multi-line Command
    type: automatic
    phase: flight
    command: |
      echo "line 1"
      echo "line 2"
      echo "line 3"
`

    const content = generateConfluence(multiLineYaml)

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
    const subStepsYaml = `name: Sub-steps Test
version: 1.0.0
description: Test sub-steps

environments:
  - name: staging

steps:
  - name: Parent Step
    type: manual
    phase: flight
    instruction: Main task
    sub_steps:
      - name: Sub Task A
        type: automatic
        command: echo "A"
      - name: Sub Task B
        type: automatic
        command: echo "B"
`

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
    const depsYaml = `name: Dependencies Test
version: 1.0.0
description: Test dependencies

environments:
  - name: staging

steps:
  - name: Step One
    type: automatic
    phase: flight
    command: echo "one"

  - name: Step Two
    type: automatic
    phase: flight
    command: echo "two"
    needs:
      - Step One
`

    const content = generateConfluence(depsYaml)

    // Should show dependencies
    assert.match(content, /\(-\) Depends on: Step One/)
  })

  it('should display conditional steps with condition', () => {
    const conditionalYaml = `name: Conditional Test
version: 1.0.0
description: Test conditional steps

environments:
  - name: staging
  - name: production

steps:
  - name: Production Only Step
    type: conditional
    phase: flight
    command: echo "prod only"
    if: "\${ENVIRONMENT} == 'production'"
`

    const content = generateConfluence(conditionalYaml)

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

  it('should handle markdown instructions wrapped in code:markdown block', () => {
    const markdownYaml = `name: Markdown Test
version: 1.0.0
description: Test markdown instructions

environments:
  - name: staging

steps:
  - name: Manual Step
    type: manual
    phase: flight
    instruction: |
      # Instructions
      1. First thing
      2. Second thing
      **Important note**
`

    const content = generateConfluence(markdownYaml)

    // Should wrap markdown instructions in {code:markdown} block to match {code:bash} style
    assert.match(content, /\{code:markdown\}/)
    assert.match(content, /# Instructions/)
    assert.match(content, /\*\*Important note\*\*/)
    // Should preserve markdown list syntax (not convert to Confluence markup)
    assert.match(content, /1\. First thing/)
    assert.match(content, /2\. Second thing/)
  })

  it('should preserve variables in markdown instructions without escaping', () => {
    const markdownWithVarsYaml = `name: Escaping Test
version: 1.0.0
description: Test variable handling in markdown

environments:
  - name: staging
    variables:
      API_ENDPOINT: "https://api.staging.com"
      DB_HOST: "db.staging.com"

steps:
  - name: Manual Step with Variables
    type: manual
    phase: flight
    instruction: |
      # Check health endpoints
      1. Verify API: curl \${API_ENDPOINT}/health
      2. Check database: ping \${DB_HOST}
      **Important**: Variables like \${FOO} should be preserved
`

    const content = generateConfluence(markdownWithVarsYaml)

    // Variables in code:markdown block don't need escaping
    assert.match(content, /\{code:markdown\}/)
    assert.match(content, /\$\{API_ENDPOINT\}/)
    assert.match(content, /\$\{DB_HOST\}/)
    assert.match(content, /\$\{FOO\}/)

    // Should still have the markdown content
    assert.match(content, /# Check health endpoints/)
  })

  it('should escape Confluence macros in step names and descriptions', () => {
    const stepWithVarsYaml = `name: Escaping Test
version: 1.0.0
description: Test variable escaping

environments:
  - name: staging

steps:
  - name: Deploy \${SERVICE_NAME} to cluster
    description: Deploys using \${DEPLOY_METHOD}
    type: automatic
    phase: flight
    if: \${ENVIRONMENT} == 'production'
    command: echo "deploy"
`

    const content = generateConfluence(stepWithVarsYaml)

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

  it('should preserve markdown links in code:markdown block', () => {
    const linksYaml = `name: Links Test
version: 1.0.0
description: Test link conversion

environments:
  - name: staging

steps:
  - name: Check Documentation
    type: manual
    phase: flight
    instruction: |
      Review the following:
      - [API Docs](https://api.example.com/docs)
      - [Dashboard](https://dashboard.example.com)
      - Contact [Support](mailto:support@example.com)
`

    const content = generateConfluence(linksYaml)

    // Markdown links should be preserved in markdown format (code:markdown block displays them)
    assert.match(content, /\{code:markdown\}/)
    assert.match(content, /\[API Docs\]\(https:\/\/api\.example\.com\/docs\)/)
    assert.match(content, /\[Dashboard\]\(https:\/\/dashboard\.example\.com\)/)
    assert.match(content, /\[Support\]\(mailto:support@example\.com\)/)
  })

  it('should render global rollback section with instructions', () => {
    const rollbackYaml = `name: Rollback Test
version: 1.0.0
description: Test global rollback

environments:
  - name: staging
  - name: production

steps:
  - name: Deploy
    type: automatic
    phase: flight
    command: kubectl apply -f app.yaml

rollback:
  automatic: false
  conditions:
    - health_check_failure
    - error_rate_spike
  steps:
    - command: kubectl rollout undo deployment/app
    - instruction: |
        Verify rollback completed:
        1. Check pods are running
        2. Test API endpoints
`

    const content = generateConfluence(rollbackYaml)

    // Should have global rollback section
    assert.match(content, /h3\. Global Rollback Plan/)
    assert.match(content, /\*Automatic\*: No/)
    assert.match(content, /\*Conditions\*: health_check_failure, error_rate_spike/)

    // Should show both rollback steps
    assert.match(content, /Rollback Step 1/)
    assert.match(content, /kubectl rollout undo/)
    assert.match(content, /Rollback Step 2/)
    assert.match(content, /\{code:markdown\}/)
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
})
