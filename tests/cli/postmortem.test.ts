import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { parsePostmortem } from '../../src/operations/postmortem-parser';

const CLI = 'npx tsx src/cli/index.ts';
const EXAMPLE = 'examples/postmortems/checkout-outage.yaml';
const INVALID = 'tests/fixtures/postmortems/invalid-missing-summary.yaml';

function run(args: string): string {
  return execSync(`${CLI} ${args}`, { encoding: 'utf-8' });
}

describe('generate postmortem CLI', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'samaritan-pm-'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('prints Markdown to stdout by default', () => {
    const out = run(`generate postmortem ${EXAMPLE}`);
    assert.ok(out.includes('# 🔴 Checkout Service Outage'));
    assert.ok(out.includes('## Root Cause Analysis'));
    assert.ok(out.includes('```mermaid'));
  });

  it('writes a Confluence file with the {markdown} macro', () => {
    const outFile = join(dir, 'pm.confluence');
    const stdout = run(
      `generate postmortem ${EXAMPLE} -f confluence -o ${outFile}`,
    );
    assert.ok(stdout.includes('Postmortem generated'));
    assert.ok(existsSync(outFile));
    const content = readFileSync(outFile, 'utf-8');
    assert.ok(content.includes('h1. '));
    assert.ok(content.includes('{markdown} ```mermaid'));
  });

  it('writes valid ADF JSON', () => {
    const outFile = join(dir, 'pm.json');
    run(`generate postmortem ${EXAMPLE} -f adf -o ${outFile}`);
    const parsed = JSON.parse(readFileSync(outFile, 'utf-8'));
    assert.equal(parsed.type, 'doc');
  });

  it('exits non-zero with a schema error on an invalid document', () => {
    assert.throws(() => run(`generate postmortem ${INVALID}`));
  });

  it('postmortem init emits a schema-valid template', () => {
    const out = run('postmortem init');
    // The template ships as a file, not an inlined string; it must parse and
    // validate against the postmortem schema.
    const pm = parsePostmortem(out);
    assert.equal(pm.title, 'Incident title');
    assert.ok(pm.summary.length > 0);
  });
});
