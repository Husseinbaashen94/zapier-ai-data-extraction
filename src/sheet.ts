/** Turns Code-step output rows into the spreadsheet a client gets, as CSV and an HTML preview. */
import { FIELDS_BY_TYPE, type IncomingEmail } from './types.js';

export interface DemoResult {
  id: string;
  email: IncomingEmail;
  output: Record<string, string | number | boolean>;
}

/** One column set for both sheets: routing info, every field of every type, then the source. */
export const SHEET_COLUMNS: string[] = [
  'doc_type',
  'needs_review',
  'review_reasons',
  'overall_confidence',
  ...new Set(Object.values(FIELDS_BY_TYPE).flat()),
  'source_from',
  'source_subject',
  'processed_at',
];

const csvCell = (value: unknown): string => {
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** RFC 4180 CSV with a UTF-8 BOM, so Excel opens Arabic and accented text correctly. */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const lines = [columns.map(csvCell).join(','), ...rows.map((row) => columns.map((c) => csvCell(row[c])).join(','))];
  return '﻿' + lines.map((l) => l + '\r\n').join('');
}

const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const AMOUNT_COLUMNS = new Set(['subtotal', 'tax', 'total']);
/** Displays a cell as Google Sheets shows it: a leading ' only marks text and is hidden. */
const fmt = (column: string, value: unknown) =>
  typeof value === 'string' && value.startsWith("'")
    ? value.slice(1)
    : typeof value === 'number'
    ? AMOUNT_COLUMNS.has(column)
      ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : String(value)
    : value;

const TYPE_TITLES: Record<string, string> = { order: 'Orders', invoice: 'Invoices', enquiry: 'Enquiries', other: 'Other', unknown: 'Unreadable' };

function typeTable(type: string, rows: DemoResult[], withReasons: boolean): string {
  const columns = [
    ...(withReasons ? ['review_reasons'] : []),
    ...(FIELDS_BY_TYPE[type as keyof typeof FIELDS_BY_TYPE] ?? []),
    'overall_confidence',
  ];
  const head = columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  const body = rows
    .map((r) => {
      const cells = columns.map((c) => `<td dir="auto">${escapeHtml(fmt(c, r.output[c]))}</td>`).join('');
      const source = `<details><summary>source email</summary><pre dir="auto">${escapeHtml(
        `From: ${r.email.from}\nSubject: ${r.email.subject}\n\n${r.email.body}${r.email.attachment_text ? `\n\n[attachment]\n${r.email.attachment_text}` : ''}`,
      )}</pre></details>`;
      return `<tr class="${r.output.needs_review ? 'review' : 'ok'}">${cells}<td>${source}</td></tr>`;
    })
    .join('\n');
  return `<h3>${escapeHtml(TYPE_TITLES[type] ?? type)} (${rows.length})</h3>
<div class="scroll"><table><thead><tr>${head}<th></th></tr></thead><tbody>
${body}
</tbody></table></div>`;
}

function sheetSection(title: string, rows: DemoResult[]): string {
  const types = ['order', 'invoice', 'enquiry', 'other', 'unknown'].filter((t) => rows.some((r) => r.output.doc_type === t));
  const tables = types.map((t) => typeTable(t, rows.filter((r) => r.output.doc_type === t), title !== 'Extracted')).join('\n');
  return `<section><h2>${escapeHtml(title)} (${rows.length})</h2>
${tables}
</section>`;
}

/** A self-contained HTML page showing both sheets, with review rows highlighted and their reasons. */
export function renderPreview(results: DemoResult[]): string {
  const extracted = results.filter((r) => r.output.destination_sheet === 'Extracted');
  const review = results.filter((r) => r.output.destination_sheet !== 'Extracted');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Inbox-to-spreadsheet demo</title>
<style>
  :root { --bg: #f6f8fa; --card: #fff; --text: #1f2328; --muted: #57606a; --line: #d0d7de; --ok: #e6f4ea; --review: #fff4e5; --accent: #ff4f00; }
  body { margin: 0; font: 14px/1.45 system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); }
  header { padding: 20px 24px; background: var(--card); border-bottom: 1px solid var(--line); }
  header h1 { margin: 0 0 4px; font-size: 20px; }
  header p { margin: 0; color: var(--muted); }
  main { padding: 8px 24px 32px; }
  h2 { font-size: 18px; margin: 28px 0 4px; }
  h3 { font-size: 14px; margin: 16px 0 8px; color: var(--muted); font-weight: 600; }
  .scroll { overflow-x: auto; background: var(--card); border: 1px solid var(--line); border-radius: 8px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; white-space: nowrap; }
  th { font-weight: 600; color: var(--muted); background: #fafbfc; }
  tr.ok td:first-child { border-left: 4px solid #2da44e; }
  tr.review { background: var(--review); }
  tr.review td:first-child { border-left: 4px solid var(--accent); }
  details summary { cursor: pointer; color: var(--muted); }
  pre { white-space: pre-wrap; max-width: 520px; margin: 6px 0 0; font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>Inbox to spreadsheet with Zapier and Claude</h1>
  <p>${results.length} sample emails, ${extracted.length} extracted automatically, ${review.length} sent to a person with the reason.</p>
</header>
<main>
${sheetSection('Extracted', extracted)}
${sheetSection('Needs review', review)}
</main>
</body>
</html>
`;
}
