import { describe, it } from 'node:test'
import assert from 'node:assert'
import { generateConfluenceContent } from '../../src/cli/commands/generate'
import { deploymentOperation, deploymentOperationYaml, operationWithSubSteps } from '../fixtures/operations'
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

    // Should have phase headers
    assert.match(content, /h2\. 🛫 Pre-Flight Phase/)
    assert.match(content, /h2\. ✈️ Flight Phase/)
    assert.match(content, /h2\. 🛬 Post-Flight Phase/)
  })

  it('should include step metadata in first column', () => {
    const content = generateConfluence(deploymentOperationYaml)

    // Should include step with PIC, timeline, and ticket
    assert.match(content, /Health Check/)
    assert.match(content, /👤 PIC: john\.doe/)
    assert.match(content, /⏱️ Timeline: 2024-01-15 10:00/)
    assert.match(content, /🎫 Tickets: JIRA-123/)
  })

  it('should format multi-line commands with double backslash', () => {
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

    // Multi-line commands should use backticks with \\ line breaks (not code blocks)
    assert.match(content, /echo "line 1"\\\\echo "line 2"\\\\echo "line 3"/)
    // Should use backticks instead of {code:bash} for multi-line
    assert.match(content, /```/)
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
    assert.match(content, /h2\. 🔄 Rollback Procedures/)

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
    assert.match(content, /📋 Depends on: Step One/)
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

    // Should show conditional icon and expression
    assert.match(content, /🔀/)
    assert.match(content, /🔀 Condition: \$\{ENVIRONMENT\} == 'production'/)
  })

  it('should use type and phase icons', () => {
    const content = generateConfluence(deploymentOperationYaml)

    // Should have type icons
    assert.match(content, /⚙️/) // automatic
    assert.match(content, /👤/) // manual

    // Should have phase icons
    assert.match(content, /🛫/) // preflight
    assert.match(content, /✈️/) // flight
    assert.match(content, /🛬/) // postflight
  })

  it('should include environment details section', () => {
    const content = generateConfluence(deploymentOperationYaml)

    // Should have environments table
    assert.match(content, /h2\. Environments/)
    assert.match(content, /\|\| Environment \|\| Description \|\| Approval Required/)

    // Should have variables section for each environment
    assert.match(content, /h3\. staging - Variables/)
    assert.match(content, /h3\. production - Variables/)
    assert.match(content, /REPLICAS=/)
  })

  it('should handle markdown instructions without code blocks', () => {
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

    // Should not wrap markdown in code blocks
    assert.match(content, /# Instructions/)
    assert.match(content, /\*\*Important note\*\*/)
    // Should format with \\ for line breaks
    assert.match(content, /\\\\/)
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
})
