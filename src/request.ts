import { readFileSync } from 'node:fs';
import type { IncomingEmail } from './types.js';

/** Body + attachment text beyond this many characters is cut, with a visible marker. */
export const CONTENT_LIMIT = 20_000;
export const DEFAULT_MODEL = 'claude-opus-5-5';
export const ANTHROPIC_HEADERS = {
  'anthropic-version': '2023-06-01',
  // Retries a rare policy refusal on a fallback model inside the same call.
  'anthropic-beta': 'server-side-fallback-2026-07-01',
  'content-type': 'application/json',
} as const;

/** The Gmail trigger fields a Zap inserts into the AI step, in the order they appear in the message. */
export const ZAPIER_FIELDS = ['{{Subject}}', '{{From}}', '{{Date}}', '{{Body Plain}}', '{{Attachment Text}}'] as const;

const PROMPT = readFileSync(new URL('../prompts/extract.md', import.meta.url), 'utf8').trim();
const EXTRACTION_SCHEMA = JSON.parse(
  readFileSync(new URL('../schemas/extraction.schema.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

const escapeTags = (text: string) => text.replace(/<(\/?)document>/gi, '&lt;$1document&gt;');

export function renderSystemPrompt(): string {
  return PROMPT;
}

/** Lays out one email the same way the Zapier AI step does, inside a single <document> block. */
function layout(parts: { subject: string; from: string; date: string; body: string; attachment: string }): string {
  return [
    'Extract the details from this document.',
    '',
    '<document>',
    `subject: ${parts.subject}`,
    `from: ${parts.from}`,
    `received: ${parts.date}`,
    '',
    'body:',
    parts.body,
    '',
    'attachment:',
    parts.attachment,
    '</document>',
  ].join('\n');
}

export function renderUserContent(email: IncomingEmail): string {
  let body = email.body;
  let attachment = email.attachment_text ?? '';
  if (body.length + attachment.length > CONTENT_LIMIT) {
    const combined = `${body}\n\n${attachment}`.slice(0, CONTENT_LIMIT) + '\n[truncated]';
    body = combined;
    attachment = '';
  }
  return layout({
    subject: escapeTags(email.subject),
    from: escapeTags(email.from),
    date: email.received_at,
    body: escapeTags(body),
    attachment: attachment ? escapeTags(attachment) : 'none',
  });
}

export interface ExtractionRequest {
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/**
 * The Anthropic Messages API request for one email, used by the live evaluation. In the Zap,
 * Zapier's Anthropic step sends the same system prompt and message (see zapier/ai-step.md).
 */
export function buildExtractionRequest(email: IncomingEmail, opts: { model?: string } = {}): ExtractionRequest {
  return {
    headers: { ...ANTHROPIC_HEADERS },
    body: {
      model: opts.model || DEFAULT_MODEL,
      max_tokens: 16000,
      system: renderSystemPrompt(),
      messages: [{ role: 'user', content: renderUserContent(email) }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: structuredClone(EXTRACTION_SCHEMA) } },
      fallbacks: 'default',
    },
  };
}

/** Markdown with the exact text to paste into the Zapier Anthropic (Claude) step. */
export function renderZapierAiStep(): string {
  const [subject, from, date, body, attachment] = ZAPIER_FIELDS;
  const message = layout({ subject, from, date, body, attachment });
  return `# Zapier AI step: exact settings

> Generated from \`prompts/extract.md\` by \`npm run build:guide\`. Don't edit by hand.

Add an **Anthropic (Claude)** action, event **Send Message**, and fill in the fields below.

## Model

\`${DEFAULT_MODEL}\`, or the newest Claude model the app offers. Use the same model you evaluate with \`npm run test:live\`.

## Max tokens

\`16000\`

## System prompt

Paste exactly:

\`\`\`\`text
${renderSystemPrompt()}
\`\`\`\`

## User message

Paste this, then replace each \`{{…}}\` placeholder by inserting the matching field from the Gmail trigger step:

| Placeholder | Insert this Gmail field |
|---|---|
| \`${subject}\` | Subject |
| \`${from}\` | From |
| \`${date}\` | Date |
| \`${body}\` | Body Plain |
| \`${attachment}\` | the text of the first attachment, from Zapier's built-in PDF-to-text step if your plan includes it. Otherwise type \`none\` |

\`\`\`\`text
${message}
\`\`\`\`

## Output

Claude's reply text, the JSON object, is what you map into the Code step's \`ai_output\` input (see \`docs/build-guide.md\`).
`;
}
