/**
 * Replaces the synthetic recorded answers in fixtures/recorded/ with real Claude replies:
 *
 *   ANTHROPIC_API_KEY=... npm run record
 *   npm test && npm run demo
 */
import Anthropic from '@anthropic-ai/sdk';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { answerText, extractLive, hasAnthropicCredentials } from '../src/live.js';
import { DEFAULT_MODEL } from '../src/request.js';

if (existsSync('.env')) process.loadEnvFile('.env');

async function main() {
  if (!hasAnthropicCredentials()) {
    console.error('No credentials: set ANTHROPIC_API_KEY in .env (or LIVE_EVAL=1 with another credential).');
    process.exit(1);
  }
  const client = new Anthropic();
  const model = process.env.AI_MODEL || DEFAULT_MODEL;

  for (const file of readdirSync('fixtures/inputs').sort()) {
    const id = file.replace(/\.json$/, '');
    const email = JSON.parse(readFileSync(`fixtures/inputs/${file}`, 'utf8'));
    try {
      const text = answerText(await extractLive(client, email, model));
      writeFileSync(`fixtures/recorded/${file}`, JSON.stringify({ model, text }, null, 2) + '\n');
      console.log(`recorded ${id}`);
    } catch (error) {
      // Most specific first: a bad key stops the run; rate limits and server errors skip one email.
      if (error instanceof Anthropic.AuthenticationError) {
        console.error('Authentication failed: check ANTHROPIC_API_KEY.');
        process.exit(1);
      } else if (error instanceof Anthropic.RateLimitError) {
        console.error(`${id}: rate limited, kept the previous recording. Re-run later.`);
      } else if (error instanceof Anthropic.APIError) {
        console.error(`${id}: API error ${error.status}, kept the previous recording: ${error.message}`);
      } else {
        throw error;
      }
    }
  }
  console.log('\nNow run npm test: if an expected value changed, update fixtures/expected.json only where the new answer is defensibly right.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
