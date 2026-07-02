import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  generateMermaidFlowchart,
  generateMermaidGantt,
} from '../../src/manuals/mermaid-generator';
import type { Operation } from '../../src/models/operation';
import { parseFixture } from '../fixtures/fixtures';

describe('Mermaid Gantt generation', () => {
  it('emits a pure gantt diagram (no code fences) with phase sections', async () => {
    const operation = await parseFixture('mermaidDiagrams');
    const gantt = generateMermaidGantt(operation);

    // Pure Mermaid: starts with the gantt header, no ``` fences.
    assert.match(gantt, /^gantt\n/);
    assert.ok(!gantt.includes('```'), 'should not include code fences');
    assert.match(gantt, /title Mermaid Diagrams Demo Timeline/);
    assert.match(gantt, /section Pre-Flight Phase/);
    assert.match(gantt, /section Flight Phase/);
    // A task line with structured timeline (start + duration).
    assert.match(gantt, /Verify cluster health :2025-01-15 09:00, 10m/);
    // Structured `after` dependency is converted to Mermaid `after` syntax.
    assert.match(gantt, /after Verify cluster health/);
  });

  it('emits a helpful comment when there is no timeline data', () => {
    const operation: Operation = {
      name: 'No Timeline',
      version: '1.0.0',
      environments: [{ name: 'staging', variables: {} }],
      steps: [{ name: 'Do a thing', type: 'manual' }],
    } as unknown as Operation;

    const gantt = generateMermaidGantt(operation);
    assert.match(gantt, /^gantt\n/);
    assert.match(gantt, /%% No timeline data found/);
  });
});

describe('Mermaid flowchart generation', () => {
  it('renders phase subgraphs, sequential edges, and a rollback branch', async () => {
    const operation = await parseFixture('mermaidDiagrams');
    const flow = generateMermaidFlowchart(operation);

    assert.match(flow, /^flowchart TD\n/);
    assert.match(flow, /Start\(\["Start"\]\)/);
    assert.match(flow, /End\(\["Done"\]\)/);
    // Phase subgraphs.
    assert.match(flow, /subgraph phase_preflight\["Pre-Flight"\]/);
    assert.match(flow, /subgraph phase_flight\["Flight"\]/);
    assert.match(flow, /subgraph phase_postflight\["Post-Flight"\]/);
    // The approval step renders as a decision diamond.
    assert.match(flow, /step_1\{"Approve production deployment"\}/);
    // Normal steps render as process nodes.
    assert.match(flow, /step_0\["Verify cluster health"\]/);
    // Sequential edges in document order.
    assert.match(flow, /Start --> step_0/);
    assert.match(flow, /step_0 --> step_1/);
    assert.match(flow, /step_3 --> End/);
    // Dashed recovery edge to the global rollback plan.
    assert.match(flow, /Rollback\[\["Rollback Plan"\]\]/);
    assert.match(flow, /step_3 -\.->\|on failure\| Rollback/);
  });

  it('respects the LR direction option', async () => {
    const operation = await parseFixture('mermaidDiagrams');
    const flow = generateMermaidFlowchart(operation, { direction: 'LR' });
    assert.match(flow, /^flowchart LR\n/);
  });

  it('does not throw for an operation with no steps', () => {
    const operation: Operation = {
      name: 'Empty',
      version: '1.0.0',
      environments: [{ name: 'staging', variables: {} }],
      steps: [],
    } as unknown as Operation;

    const flow = generateMermaidFlowchart(operation);
    assert.match(flow, /^flowchart TD\n/);
    assert.match(flow, /Start --> End/);
  });
});
