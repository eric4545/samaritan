import { describe, it } from 'node:test'
import assert from 'node:assert'
import { generateManual } from '../../src/manuals/generator'
import { generateADFString } from '../../src/manuals/adf-generator'
import { deploymentOperation } from '../fixtures/operations'

describe('Format Consistency Tests', () => {
  it('should include operation name and version in all formats', () => {
    const markdown = generateManual(deploymentOperation)
    const adfString = generateADFString(deploymentOperation)

    // Markdown should have title
    assert(markdown.includes('Deploy Web Server'), 'Markdown should include operation name')
    assert(markdown.includes('v1.1.0'), 'Markdown should include version')

    // ADF should have title
    assert(adfString.includes('Deploy Web Server'), 'ADF should include operation name')
    assert(adfString.includes('v1.1.0'), 'ADF should include version')
  })

  it('should include all environments in all formats', () => {
    const markdown = generateManual(deploymentOperation)
    const adfString = generateADFString(deploymentOperation)

    // Both formats should include staging and production environments
    assert(markdown.includes('staging'), 'Markdown should include staging environment')
    assert(markdown.includes('production'), 'Markdown should include production environment')

    assert(adfString.includes('staging'), 'ADF should include staging environment')
    assert(adfString.includes('production'), 'ADF should include production environment')
  })

  it('should include all steps in all formats', () => {
    const markdown = generateManual(deploymentOperation)
    const adfString = generateADFString(deploymentOperation)

    const stepNames = [
      'Build Docker Image',
      'Push Docker Image',
      'Deploy to Kubernetes',
      'Scale Deployment',
      'Health Check',
      'Verify Services'
    ]

    stepNames.forEach(stepName => {
      assert(markdown.includes(stepName), `Markdown should include step: ${stepName}`)
      assert(adfString.includes(stepName), `ADF should include step: ${stepName}`)
    })
  })

  it('should resolve variables consistently across formats', () => {
    const markdownResolved = generateManual(deploymentOperation)
    const adfStringResolved = generateADFString(deploymentOperation, undefined, undefined, true)

    // Both should resolve REPLICAS variable for staging (2) and production (5)
    assert(markdownResolved.includes('--replicas=2'), 'Markdown should resolve staging REPLICAS')
    assert(markdownResolved.includes('--replicas=5'), 'Markdown should resolve production REPLICAS')

    assert(adfStringResolved.includes('--replicas=2'), 'ADF should resolve staging REPLICAS')
    assert(adfStringResolved.includes('--replicas=5'), 'ADF should resolve production REPLICAS')

    // Both should resolve DB_HOST variable
    assert(markdownResolved.includes('staging-db.example.com'), 'Markdown should resolve staging DB_HOST')
    assert(markdownResolved.includes('prod-db.example.com'), 'Markdown should resolve production DB_HOST')

    assert(adfStringResolved.includes('staging-db.example.com'), 'ADF should resolve staging DB_HOST')
    assert(adfStringResolved.includes('prod-db.example.com'), 'ADF should resolve production DB_HOST')
  })

  it('should use continuous step numbering across formats', () => {
    const markdown = generateManual(deploymentOperation)
    const adfString = generateADFString(deploymentOperation)

    // Both formats should number steps continuously across phases
    // Preflight: Step 1
    // Flight: Steps 2, 3, 4
    // Postflight: Steps 5, 6

    for (let i = 1; i <= 6; i++) {
      assert(markdown.includes(`Step ${i}:`), `Markdown should have Step ${i}`)
      assert(adfString.includes(`Step ${i}:`), `ADF should have Step ${i}`)
    }

    // Verify steps appear in expected phases
    assert(markdown.includes('Pre-Flight Phase'), 'Markdown should have Pre-Flight phase')
    assert(markdown.includes('Flight Phase'), 'Markdown should have Flight phase')
    assert(markdown.includes('Post-Flight Phase'), 'Markdown should have Post-Flight phase')

    assert(adfString.includes('Pre-Flight'), 'ADF should have Pre-Flight phase')
    assert(adfString.includes('Flight Phase'), 'ADF should have Flight phase')
    assert(adfString.includes('Post-Flight'), 'ADF should have Post-Flight phase')
  })

  it('should include phase icons consistently across formats', () => {
    const markdown = generateManual(deploymentOperation)
    const adfString = generateADFString(deploymentOperation)

    // Both formats should use phase icons
    assert(markdown.includes('🛫'), 'Markdown should have pre-flight icon')
    assert(markdown.includes('✈️'), 'Markdown should have flight icon')
    assert(markdown.includes('🛬'), 'Markdown should have post-flight icon')

    assert(adfString.includes('🛫'), 'ADF should have pre-flight icon')
    assert(adfString.includes('✈️'), 'ADF should have flight icon')
    assert(adfString.includes('🛬'), 'ADF should have post-flight icon')
  })

  it('should include step type icons consistently', () => {
    const markdown = generateManual(deploymentOperation)
    const adfString = generateADFString(deploymentOperation)

    // Both formats should use type icons
    assert(markdown.includes('⚙️'), 'Markdown should have automatic step icon')
    assert(markdown.includes('👤'), 'Markdown should have manual step icon')

    assert(adfString.includes('⚙️'), 'ADF should have automatic step icon')
    assert(adfString.includes('👤'), 'ADF should have manual step icon')
  })

  it('should include metadata when provided', () => {
    const metadata = {
      source_file: '/ops/test.yaml',
      operation_id: 'deploy-web-server',
      operation_version: '1.1.0',
      target_environment: 'staging',
      generated_at: '2024-01-15T10:00:00Z',
      git_sha: 'abc123def456',
      git_branch: 'main',
      git_short_sha: 'abc123d',
      git_author: 'test-author',
      git_date: '2024-01-15',
      git_message: 'test commit',
      git_dirty: false,
      generator_version: '1.0.0'
    }

    const adfString = generateADFString(deploymentOperation, metadata)

    // ADF should include git metadata
    assert(adfString.includes('abc123def456'), 'ADF should include git hash')
    assert(adfString.includes('staging'), 'ADF should include target environment')
  })

  it('should filter to single environment consistently', () => {
    const markdownStaging = generateManual({
      ...deploymentOperation,
      environments: deploymentOperation.environments.filter(e => e.name === 'staging'),
      variables: { staging: deploymentOperation.variables.staging }
    })
    const adfStringStaging = generateADFString(deploymentOperation, undefined, 'staging')

    // Both should only show staging
    assert(markdownStaging.includes('staging'), 'Markdown should include staging')
    // Note: "production" might appear in step names or descriptions, so we check for environment-specific markers
    const envTableMatch = markdownStaging.match(/\| Step \| staging \|/)
    assert(envTableMatch, 'Markdown should have staging-only table header')
    assert(!markdownStaging.match(/\| Step \| staging \| production \|/), 'Markdown should not have production column when filtered')

    assert(adfStringStaging.includes('staging'), 'ADF should include staging')
    // ADF content should be filtered - check that production is not in environments table
    const adfObj = JSON.parse(adfStringStaging)
    const hasProductionInTable = adfStringStaging.includes('"production"') &&
                                  adfStringStaging.includes('"Live production environment"')
    assert(!hasProductionInTable, 'ADF should not include production environment row when filtered')
  })

  it('should include rollback procedures consistently', () => {
    const markdown = generateManual(deploymentOperation)
    const adfString = generateADFString(deploymentOperation)

    // Both should have rollback section
    assert(markdown.includes('Rollback'), 'Markdown should have rollback section')
    assert(markdown.includes('kubectl rollout undo'), 'Markdown should have rollback command')

    assert(adfString.includes('Rollback'), 'ADF should have rollback section')
    assert(adfString.includes('kubectl rollout undo'), 'ADF should have rollback command')
  })

  it('should include step metadata (PIC, timeline, ticket) consistently', () => {
    const markdown = generateManual(deploymentOperation)
    const adfString = generateADFString(deploymentOperation)

    // Both should include PIC
    assert(markdown.includes('john.doe'), 'Markdown should include PIC')
    assert(adfString.includes('john.doe'), 'ADF should include PIC')

    // Both should include timeline
    assert(markdown.includes('2024-01-15 10:00'), 'Markdown should include timeline')
    assert(adfString.includes('2024-01-15 10:00'), 'ADF should include timeline')

    // Both should include ticket
    assert(markdown.includes('JIRA-123'), 'Markdown should include ticket')
    assert(adfString.includes('JIRA-123'), 'ADF should include ticket')
  })
})
