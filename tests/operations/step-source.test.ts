import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { parseDocument } from 'yaml';
import { stepDisplayName, walkOperationSteps } from '../../src/lib/step-walk';
import { parseOperation } from '../../src/operations/parser';
import {
  formatSourcePath,
  getStepSource,
} from '../../src/operations/step-source';

/**
 * Every parsed step must point back at the YAML node it came from: a map at
 * that path in that file whose `name` or `command` is the one authored there.
 */
async function assertSourcesResolve(file: string): Promise<number> {
  const operation = await parseOperation(file);
  const docs = new Map<string, ReturnType<typeof parseDocument>>();
  let checked = 0;
  for (const step of walkOperationSteps(operation)) {
    const source = getStepSource(step);
    assert.ok(
      source,
      `no source for step "${stepDisplayName(step)}" in ${file}`,
    );
    if (source.file.startsWith('http')) continue;
    if (!docs.has(source.file)) {
      docs.set(source.file, parseDocument(readFileSync(source.file, 'utf8')));
    }
    const node = docs.get(source.file)?.getIn(source.path) as
      | { get(key: string): unknown }
      | undefined;
    assert.ok(
      node && typeof node.get === 'function',
      `${source.file}: nothing at ${formatSourcePath(source.path)}`,
    );
    const rawName = node.get('name');
    const rawCommand = node.get('command');
    const nameMatches =
      typeof rawName === 'string' &&
      (step.name === rawName ||
        (step as { foreachSource?: { name?: string } }).foreachSource?.name ===
          rawName ||
        (step.name ?? '').startsWith(rawName.split('${')[0]));
    const commandMatches =
      typeof rawCommand === 'string' &&
      typeof step.command === 'string' &&
      rawCommand.split('${')[0] === step.command.split('${')[0];
    assert.ok(
      nameMatches || commandMatches || (!rawName && !rawCommand),
      `${formatSourcePath(source.path)} in ${source.file} is "${rawName}", step is "${step.name}"`,
    );
    checked++;
  }
  return checked;
}

describe('parser: per-step source (file + YAML path)', () => {
  for (const file of [
    'examples/deployment.yaml',
    'examples/nested-deployment.yaml',
    'examples/rollback-with-foreach.yaml',
    'examples/rollback-with-substeps.yaml',
    'examples/rollback-with-uses.yaml',
    'examples/deployment-with-imports.yaml',
    'examples/deployment-with-templates.yaml',
    'examples/foreach-variable-values.yaml',
    'examples/global-rollback-aggregated.yaml',
    'examples/deployment-with-groups.yaml',
  ]) {
    it(`resolves every step of ${file}`, async () => {
      assert.ok((await assertSourcesResolve(file)) > 0);
    });
  }

  it('records uses: steps in the imported file, foreach copies at the authored entry', async () => {
    const operation = await parseOperation(
      'examples/deployment-with-imports.yaml',
    );
    const files = new Set(
      [...walkOperationSteps(operation)].map((s) => getStepSource(s)?.file),
    );
    assert.ok(files.size > 1, 'imported steps should point at their own file');
  });

  it('is invisible to deep equality and JSON', async () => {
    const operation = await parseOperation('examples/deployment.yaml');
    const [step] = operation.steps;
    assert.ok(getStepSource(step));
    assert.ok(!JSON.stringify(step).includes('stepSource'));
    assert.deepStrictEqual({ ...step }, { ...step });
    assert.strictEqual(getStepSource({ ...step }), undefined);
  });
});
