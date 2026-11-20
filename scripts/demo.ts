/**
 * The 2-minute demo: runs every sample email through Claude's recorded answer and the exact
 * Code by Zapier step, then writes the spreadsheet a client would get.
 * Needs no Zapier account, no API key and no .env.
 *
 *   npm run demo   ->  out/Extracted.csv, out/Needs-review.csv, out/preview.html
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { renderPreview, SHEET_COLUMNS, toCsv, type DemoResult } from '../src/sheet.js';
import { runZapierCode } from '../tests/harness/zapier-code.js';

const STEP = readFileSync('zapier/code-steps/validate-and-route.js', 'utf8');

async function main() {
  const results: DemoResult[] = [];
  for (const file of readdirSync('fixtures/inputs').sort()) {
    const id = file.replace(/\.json$/, '');
    const email = JSON.parse(readFileSync(`fixtures/inputs/${file}`, 'utf8'));
    const recorded = JSON.parse(readFileSync(`fixtures/recorded/${file}`, 'utf8'));
    const { output } = await runZapierCode(STEP, {
      ai_output: recorded.text,
      email_from: email.from,
      email_subject: email.subject,
      email_received_at: email.received_at,
    });
    results.push({ id, email, output });
  }

  const extracted = results.filter((r) => r.output.destination_sheet === 'Extracted');
  const review = results.filter((r) => r.output.destination_sheet !== 'Extracted');

  mkdirSync('out', { recursive: true });
  writeFileSync('out/Extracted.csv', toCsv(extracted.map((r) => r.output), SHEET_COLUMNS));
  writeFileSync('out/Needs-review.csv', toCsv(review.map((r) => r.output), SHEET_COLUMNS));
  writeFileSync('out/preview.html', renderPreview(results));

  console.log(`${extracted.length} rows extracted, ${review.length} need review\n`);
  for (const r of results) {
    const mark = r.output.needs_review ? 'REVIEW ' : 'OK     ';
    const why = r.output.review_reasons ? `  (${r.output.review_reasons})` : '';
    console.log(`${mark} ${String(r.output.doc_type).padEnd(8)} ${r.email.subject}${why}`);
  }
  console.log('\nWrote out/Extracted.csv, out/Needs-review.csv and out/preview.html (open it in a browser).');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
