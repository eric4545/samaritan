import assert from 'node:assert';
import { describe, it } from 'node:test';
import { generateConfluenceContent } from '../../src/cli/commands/generate';
import { generateADFString } from '../../src/manuals/adf-generator';
import {
  generateManual,
  generateManualWithMetadata,
  generateSingleEnvManual,
} from '../../src/manuals/generator';
import { parseFixture } from '../fixtures/fixtures';

/**
 * A parent's `session:` is shown on its sub-steps (they run there), in every
 * format and on both rendering paths. Fixture: parent `session: ops`; 1.1 and
 * the grandchild 1.3.1 inherit it, 1.3 (a group) inherits it, 1.2 sets
 * `session: local` itself.
 */
const count = (text: string, needle: string) => text.split(needle).length - 1;

describe('sub-step session inheritance in manuals', () => {
  it('Markdown multi-env: every sub-step row names the inherited session', async () => {
    const md = generateManual(await parseFixture('substepSessionInherit'));
    const row = (name: string) =>
      md.split('\n').find((l) => l.includes(`: ${name}`)) ?? '';
    assert.match(row('Check identity'), /Session: ops/);
    assert.match(row('List buckets'), /Session: ops/);
    assert.match(row('Record local time'), /Session: local/);
    assert.doesNotMatch(row('Record local time'), /Session: ops/);
    assert.strictEqual(count(md, 'Session: ops'), 4);
  });

  it('Markdown multi-env with metadata (generate manual path)', async () => {
    const md = generateManualWithMetadata(
      await parseFixture('substepSessionInherit'),
    );
    assert.strictEqual(count(md, 'Session: ops'), 4);
    assert.strictEqual(count(md, 'Session: local'), 1);
  });

  it('Markdown --env: the sub-step heading block carries the session', async () => {
    const md = generateSingleEnvManual(
      await parseFixture('substepSessionInherit'),
      'staging',
    );
    const block = (heading: string) => {
      const start = md.indexOf(heading);
      assert.ok(start >= 0, `${heading} rendered`);
      const next = md.indexOf('\n#', start + heading.length);
      return md.slice(start, next < 0 ? undefined : next);
    };
    assert.match(block('Step 1.1: Check identity'), /> Session: ops/);
    assert.match(block('Step 1.3.1: List buckets'), /> Session: ops/);
    assert.match(block('Step 1.2: Record local time'), /> Session: local/);
  });

  it('ADF, multi-env and --env', async () => {
    const op = await parseFixture('substepSessionInherit');
    for (const adf of [
      generateADFString(op),
      generateADFString(op, undefined, 'staging'),
    ]) {
      assert.strictEqual(count(adf, 'Session: ops'), 4);
      assert.strictEqual(count(adf, 'Session: local'), 1);
    }
  });

  it('Confluence wiki, multi-env and --env', async () => {
    const op = await parseFixture('substepSessionInherit');
    for (const wiki of [
      generateConfluenceContent(op),
      generateConfluenceContent(op, false, false, 'staging'),
    ]) {
      assert.strictEqual(count(wiki, 'Session: ops'), 4);
      assert.strictEqual(count(wiki, 'Session: local'), 1);
    }
  });

  it('does not change the parsed operation', async () => {
    const op = await parseFixture('substepSessionInherit');
    generateManual(op);
    generateADFString(op);
    assert.strictEqual(op.steps[0].sub_steps?.[0].session, undefined);
  });

  it('rollback entries show the session they inherit, in every format', async () => {
    // Fixture: step `session: ops` with two rollback entries (one sets
    // `session: local`); the operation-level plan has a `session: db` entry
    // whose sub-step sets none. Markdown multi-env renders step rollbacks
    // twice (inline and under Rollback Procedures).
    const op = await parseFixture('rollbackSessionInherit');
    const outputs: [string, string, number, number][] = [
      ['md', generateManual(op), 3, 2],
      ['md --env', generateSingleEnvManual(op, 'staging'), 2, 1],
      ['adf', generateADFString(op), 2, 1],
      ['adf --env', generateADFString(op, undefined, 'staging'), 2, 1],
      ['confluence', generateConfluenceContent(op), 2, 1],
      [
        'confluence --env',
        generateConfluenceContent(op, false, false, 'staging'),
        2,
        1,
      ],
    ];
    for (const [format, text, ops, local] of outputs) {
      assert.strictEqual(count(text, 'Session: ops'), ops, `${format}: ops`);
      assert.strictEqual(
        count(text, 'Session: local'),
        local,
        `${format}: local`,
      );
      assert.strictEqual(count(text, 'Session: db'), 2, `${format}: db`);
    }
  });
});
