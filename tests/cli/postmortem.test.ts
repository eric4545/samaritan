import assert from 'node:assert';
import { execSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

  it('--timezone shows every timestamp in that zone', () => {
    const out = run(`generate postmortem ${EXAMPLE} --timezone Asia/Tokyo`);
    // occurred_at 2026-07-01T14:32:00Z is 23:32 in Tokyo.
    assert.ok(out.includes('Wed, 01 Jul 2026 23:32:00 Asia/Tokyo'), out);
    assert.ok(!out.includes(' UTC'), 'no UTC timestamps left');
  });

  it('rejects an unknown --timezone', () => {
    const r = spawnSync(
      'npx',
      [
        'tsx',
        'src/cli/index.ts',
        'generate',
        'postmortem',
        EXAMPLE,
        '--timezone',
        'Nowhere/Zone',
      ],
      { encoding: 'utf-8' },
    );
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Unknown time zone 'Nowhere\/Zone'/);
  });

  it('names the field of a zone-less timestamp', () => {
    const file = join(dir, 'zoneless.yaml');
    writeFileSync(
      file,
      'title: T\nsummary: S\ntimeline:\n  - at: 2026-01-01T14:00:00\n    event: e\n',
    );
    const r = spawnSync(
      'npx',
      ['tsx', 'src/cli/index.ts', 'generate', 'postmortem', file],
      { encoding: 'utf-8' },
    );
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /\/timeline\/0\/at: timestamp .* has no time zone/);
  });

  it('warns when the timeline cannot be sorted, and still renders', () => {
    const file = join(dir, 'mixed.yaml');
    writeFileSync(
      file,
      'title: T\nsummary: S\ntimeline:\n  - at: 2026-01-01T15:00:00Z\n    event: b\n  - at: "14:00"\n    event: a\n',
    );
    const r = spawnSync(
      'npx',
      ['tsx', 'src/cli/index.ts', 'generate', 'postmortem', file],
      { encoding: 'utf-8' },
    );
    assert.equal(r.status, 0);
    assert.match(r.stderr, /timeline kept in YAML order/);
    assert.ok(r.stdout.indexOf('• b') < r.stdout.indexOf('• a'));
  });

  it('postmortem init emits a schema-valid template', () => {
    const out = run('postmortem init');
    // The template ships as a file, not an inlined string; it must parse and
    // validate against the postmortem schema.
    const pm = parsePostmortem(out);
    assert.equal(pm.title, 'Incident title');
    assert.ok(pm.summary.length > 0);
  });

  it('creates missing parent directories for -o output paths', () => {
    // init: previously threw an uncaught ENOENT; from-run: returned an error.
    const initOut = join(dir, 'a', 'b', 'init.yaml');
    run(`postmortem init -o ${initOut}`);
    assert.ok(existsSync(initOut), 'init created nested output');

    const jsonl = join(dir, 'events.jsonl');
    writeFileSync(
      jsonl,
      '{"ts":"2026-07-01T14:32:00.000Z","type":"session_start","session_id":"x","op":"deployment.yaml"}\n' +
        '{"ts":"2026-07-01T14:33:00.000Z","type":"session_end","session_id":"x","status":"completed"}\n',
      'utf-8',
    );
    const seedOut = join(dir, 'c', 'd', 'seed.yaml');
    run(`postmortem from-run ${jsonl} -o ${seedOut}`);
    assert.ok(existsSync(seedOut), 'from-run created nested output');
  });
});
