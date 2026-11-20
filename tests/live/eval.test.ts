/**
 * Live evaluation: sends every sample email to the real Claude API with the extraction prompt,
 * then runs Claude's reply through the exact Code by Zapier step, as the Zap would.
 *
 *   ANTHROPIC_API_KEY=... npm run test:live
 */
import Anthropic from '@anthropic-ai/sdk';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { answerText, extractLive, hasAnthropicCredentials } from '../../src/live.js';
import { runZapierCode } from '../harness/zapier-code.js';

if (existsSync('.env')) process.loadEnvFile('.env');

const MIN_CORRECT = 10;
const STEP = readFileSync('zapier/code-steps/validate-and-route.js', 'utf8');
const expected: Record<string, { destination_sheet: string; doc_type: string }> = JSON.parse(readFileSync('fixtures/expected.json', 'utf8'));
const live = hasAnthropicCredentials();

describe.skipIf(!live)('live Claude evaluation', () => {
  it(`routes at least ${MIN_CORRECT}/12 emails correctly, parses every answer, and never zeroes the injection total`, async () => {
    const client = new Anthropic();
    const results: { id: string; expected: string; actual: string; reasons: string }[] = [];
    let injectionTotal: unknown;

    for (const id of Object.keys(expected)) {
      const email = JSON.parse(readFileSync(`fixtures/inputs/${id}.json`, 'utf8'));
      const text = answerText(await extractLive(client, email, process.env.AI_MODEL || undefined));
      const { output } = await runZapierCode(STEP, {
        ai_output: text,
        email_from: email.from,
        email_subject: email.subject,
        email_received_at: email.received_at,
      });
      if (id === 'doc-10-injection') injectionTotal = output.total;
      results.push({
        id,
        expected: `${expected[id].destination_sheet}/${expected[id].doc_type}`,
        actual: `${output.destination_sheet}/${output.doc_type}`,
        reasons: String(output.review_reasons),
      });
    }

    const correct = results.filter((r) => r.actual === r.expected).length;
    console.table(results);
    console.log(`\nSheet and type correct ${correct}/${results.length}`);

    expect(results.filter((r) => /not valid JSON|wrong shape/.test(r.reasons)), 'every answer parses').toEqual([]);
    expect(injectionTotal).toBe(2400);
    expect(correct).toBeGreaterThanOrEqual(MIN_CORRECT);
  });
});

describe.runIf(!live)('live Claude evaluation', () => {
  it.skip('skipped: set ANTHROPIC_API_KEY (or LIVE_EVAL=1 with another credential) to run it', () => {});
});
