import { describe, expect, it } from 'vitest';
import { renderPreview, SHEET_COLUMNS, toCsv, type DemoResult } from '../../src/sheet.js';

const BOM = '﻿';

describe('toCsv', () => {
  it('starts with a UTF-8 BOM so Excel shows Arabic and accents correctly', () => {
    expect(toCsv([], ['a']).startsWith(BOM)).toBe(true);
  });

  it('writes the header and rows in the given column order', () => {
    expect(toCsv([{ b: 2, a: 1 }], ['a', 'b'])).toBe(`${BOM}a,b\r\n1,2\r\n`);
  });

  it('quotes commas, quotes and newlines (RFC 4180)', () => {
    const csv = toCsv([{ a: 'x, y', b: 'say "hi"', c: 'two\nlines' }], ['a', 'b', 'c']);
    expect(csv).toBe(`${BOM}a,b,c\r\n"x, y","say ""hi""","two\nlines"\r\n`);
  });

  it('writes missing values as empty cells', () => {
    expect(toCsv([{ a: 1 }], ['a', 'b'])).toBe(`${BOM}a,b\r\n1,\r\n`);
  });

  it('keeps formula-escaped values escaped', () => {
    expect(toCsv([{ a: "'=HYPERLINK(1)" }], ['a'])).toContain("'=HYPERLINK(1)");
  });
});

describe('SHEET_COLUMNS', () => {
  it('puts routing and review columns first, then every field, then the source', () => {
    expect(SHEET_COLUMNS.slice(0, 4)).toEqual(['doc_type', 'needs_review', 'review_reasons', 'overall_confidence']);
    expect(SHEET_COLUMNS.slice(-3)).toEqual(['source_from', 'source_subject', 'processed_at']);
    expect(SHEET_COLUMNS).toContain('invoice_number');
    expect(SHEET_COLUMNS).toContain('contact_email');
    expect(new Set(SHEET_COLUMNS).size).toBe(SHEET_COLUMNS.length);
  });
});

describe('renderPreview', () => {
  const results: DemoResult[] = [
    {
      id: 'doc-a',
      email: { from: 'a@b.co', subject: 'Order <SO-1>', received_at: '2026-11-20T10:00:00Z', body: 'body <script>x</script>' },
      output: { destination_sheet: 'Extracted', doc_type: 'order', needs_review: false, review_reasons: '', total: 10 },
    },
    {
      id: 'doc-b',
      email: { from: 'c@d.co', subject: 'Unclear one', received_at: '2026-11-20T10:00:00Z', body: 'hmm' },
      output: { destination_sheet: 'Needs review', doc_type: 'order', needs_review: true, review_reasons: 'ambiguous date in order_date' },
    },
  ];
  const html = renderPreview(results);

  it('is a complete standalone page', () => {
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('<title>');
  });

  it('shows one section per sheet with its row count', () => {
    expect(html).toContain('Extracted (1)');
    expect(html).toContain('Needs review (1)');
  });

  it('shows every source subject and the review reason', () => {
    expect(html).toContain('Order &lt;SO-1&gt;');
    expect(html).toContain('Unclear one');
    expect(html).toContain('ambiguous date in order_date');
  });

  it('escapes email content so it cannot inject HTML', () => {
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
  });

  it('marks review rows visually', () => {
    expect(html).toMatch(/class="[^"]*review[^"]*"/);
  });

  it('groups each sheet by document type, showing only that type\'s columns', () => {
    const mixed = renderPreview([
      ...results,
      {
        id: 'doc-c',
        email: { from: 'e@f.co', subject: 'Question', received_at: '2026-11-20T10:00:00Z', body: 'q' },
        output: { destination_sheet: 'Extracted', doc_type: 'enquiry', needs_review: false, review_reasons: '', contact_email: 'e@f.co' },
      },
    ]);
    const enquiryTable = mixed.slice(mixed.indexOf('<h3>Enquiries'), mixed.indexOf('</table>', mixed.indexOf('<h3>Enquiries')));
    expect(enquiryTable).toContain('<th>contact_email</th>');
    expect(enquiryTable).not.toContain('<th>order_number</th>');
    expect(mixed).toContain('<h3>Orders (1)</h3>');
  });

  it('shows amounts with two decimals', () => {
    expect(html).toContain('10.00');
  });

  it("shows text-marked values the way Google Sheets does (the leading ' is hidden)", () => {
    const page = renderPreview([
      {
        id: 'doc-x',
        email: { from: 'a@b.co', subject: 'S', received_at: '2026-11-20T10:00:00Z', body: 'b' },
        output: { destination_sheet: 'Needs review', doc_type: 'order', needs_review: true, review_reasons: 'r', order_date: "'03/04/2026", customer_name: "'=HYPERLINK(1)" },
      },
    ]);
    expect(page).toContain('<td dir="auto">03/04/2026</td>');
    expect(page).toContain('<td dir="auto">=HYPERLINK(1)</td>');
  });
});

