/**
 * Calls the real Claude API with the extraction prompt. Used only by the live evaluation
 * (npm run test:live) and npm run record. In the Zap, Zapier's Anthropic step makes this call.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_HEADERS, buildExtractionRequest } from './request.js';
import type { IncomingEmail } from './types.js';

const FALLBACK_BETA = ANTHROPIC_HEADERS['anthropic-beta'];

/** True when the SDK has something to authenticate with. Empty .env values count as unset. */
export function hasAnthropicCredentials(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || env.LIVE_EVAL === '1');
}

/** Extracts one email with the live API (beta endpoint, for the server-side refusal fallback). */
export async function extractLive(client: Anthropic, email: IncomingEmail, model?: string): Promise<unknown> {
  const { body } = buildExtractionRequest(email, { model });
  const params = { ...body, betas: [FALLBACK_BETA] } as unknown as Parameters<Anthropic['beta']['messages']['create']>[0];
  return client.beta.messages.create(params);
}

/** The reply text, the way Zapier's Anthropic step hands it to the Code step. Empty on refusal. */
export function answerText(response: unknown): string {
  const r = response as { stop_reason?: string; content?: { type: string; text?: string }[] };
  if (r?.stop_reason === 'refusal') return '';
  return (r?.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}
