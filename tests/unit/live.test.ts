import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { answerText, extractLive, hasAnthropicCredentials } from '../../src/live.js';

const email = JSON.parse(readFileSync('fixtures/inputs/doc-01-order.json', 'utf8'));

describe('extractLive', () => {
  it('sends the extraction request with the fallback beta through the beta endpoint', async () => {
    let sent: Record<string, unknown> | undefined;
    const client = {
      beta: {
        messages: {
          create: async (params: Record<string, unknown>) => {
            sent = params;
            return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }] };
          },
        },
      },
    };
    await extractLive(client as never, email);
    expect(sent).toMatchObject({
      model: 'claude-opus-5-5',
      fallbacks: 'default',
      betas: ['server-side-fallback-2026-07-01'],
      output_config: { effort: 'medium', format: { type: 'json_schema' } },
    });
    expect((sent!.messages as { content: string }[])[0].content).toContain('SO-10482');
  });
});

describe('answerText', () => {
  it('joins the text blocks of a response, as the Zapier step receives it', () => {
    expect(answerText({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"a":' }, { type: 'text', text: '1}' }] })).toBe('{"a":1}');
  });

  it('returns an empty string for a refusal, which the Code step sends to review', () => {
    expect(answerText({ stop_reason: 'refusal', content: [] })).toBe('');
  });
});

describe('hasAnthropicCredentials', () => {
  it('is true with an API key, an auth token or LIVE_EVAL=1', () => {
    expect(hasAnthropicCredentials({ ANTHROPIC_API_KEY: 'x' })).toBe(true);
    expect(hasAnthropicCredentials({ ANTHROPIC_AUTH_TOKEN: 'x' })).toBe(true);
    expect(hasAnthropicCredentials({ LIVE_EVAL: '1' })).toBe(true);
  });

  it('treats empty .env values as not set', () => {
    expect(hasAnthropicCredentials({ ANTHROPIC_API_KEY: '', LIVE_EVAL: '' })).toBe(false);
  });
});
