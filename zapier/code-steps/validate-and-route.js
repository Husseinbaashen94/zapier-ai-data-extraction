// Code by Zapier (JavaScript): validate, normalise and route Claude's extraction.
// Paste this whole file into the Code step. Input Data keys (map them in Zapier):
//   ai_output          <- the Anthropic step's reply text
//   email_from         <- Gmail: From
//   email_subject      <- Gmail: Subject
//   email_received_at  <- Gmail: Date
// Output: one flat row. Use "destination_sheet" as the Google Sheets worksheet name.
// No network calls and no packages, so it runs in milliseconds on Zapier's free plan.
// Source and tests: https://github.com/Husseinbaashen94/zapier-ai-data-extraction

const FIELDS_BY_TYPE = {
  order: ['customer_name', 'customer_email', 'order_number', 'order_date', 'items_summary', 'total', 'currency'],
  invoice: ['supplier_name', 'invoice_number', 'invoice_date', 'due_date', 'subtotal', 'tax', 'total', 'currency'],
  enquiry: ['contact_name', 'contact_email', 'company', 'topic', 'requested_action'],
  other: [],
};
const REQUIRED_BY_TYPE = { order: ['order_number', 'total'], invoice: ['invoice_number', 'total'], enquiry: ['contact_email'], other: [] };
const DATE_FIELDS = ['order_date', 'invoice_date', 'due_date'];
const AMOUNT_FIELDS = ['subtotal', 'tax', 'total'];
const EMAIL_FIELDS = ['customer_email', 'contact_email'];
const MIN_CONFIDENCE = 0.7;

const CURRENCY_CODES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'AED', 'SAR', 'QAR', 'KWD', 'INR', 'CNY', 'HKD', 'SGD', 'MYR', 'ZAR', 'MXN', 'BRL'];
const CURRENCY_SYMBOLS = { '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR', $: 'USD' };

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  janvier: 1, 'février': 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, 'août': 8, septembre: 9, octobre: 10, novembre: 11, 'décembre': 12,
  januar: 1, februar: 2, 'märz': 3, juni: 6, juli: 7, oktober: 10, dezember: 12,
};

// ---------- reading Claude's answer ----------

function parseAnswer(text) {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return { error: 'AI answer is not valid JSON' };
  let answer;
  try {
    answer = JSON.parse(cleaned.slice(start, end + 1));
  } catch (e) {
    return { error: 'AI answer is not valid JSON' };
  }
  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isObject(answer) || !(answer.doc_type in FIELDS_BY_TYPE) || !isObject(answer.fields)) {
    return { error: 'AI answer has the wrong shape' };
  }
  return {
    answer: {
      doc_type: answer.doc_type,
      fields: answer.fields,
      field_confidence: isObject(answer.field_confidence) ? answer.field_confidence : {},
      overall_confidence: typeof answer.overall_confidence === 'number' ? answer.overall_confidence : 0,
    },
  };
}

// ---------- normalisers: each returns { value, problem? } ----------

function isRealDate(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
const iso = (y, m, d) => y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');

function normaliseDate(raw, field) {
  const text = String(raw).trim();
  let m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m && isRealDate(+m[1], +m[2], +m[3])) return { value: iso(+m[1], +m[2], +m[3]) };

  m = text.match(/^(\d{1,2})(?:st|nd|rd|th)?\.?\s+(?:de\s+)?([^\s\d,.]+)\.?,?\s+(?:de\s+)?(\d{4})$/i); // 3 April 2026, 3 de abril de 2026
  if (m && MONTHS[m[2].toLowerCase()] && isRealDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1])) {
    return { value: iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]) };
  }
  m = text.match(/^([^\s\d,.]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i); // April 3, 2026
  if (m && MONTHS[m[1].toLowerCase()] && isRealDate(+m[3], MONTHS[m[1].toLowerCase()], +m[2])) {
    return { value: iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]) };
  }
  m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/); // numeric day/month or month/day
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const y = +m[3];
    if (a > 12 && isRealDate(y, b, a)) return { value: iso(y, b, a) };
    if (b > 12 && isRealDate(y, a, b)) return { value: iso(y, a, b) };
    if (a === b && isRealDate(y, a, b)) return { value: iso(y, a, b) };
    if (a <= 12 && b <= 12) return { value: text, problem: 'ambiguous date in ' + field };
  }
  return { value: text, problem: 'unreadable date in ' + field };
}

function parseAmount(raw, field) {
  if (typeof raw === 'number') return { value: Math.round(raw * 100) / 100 };
  let text = String(raw)
    .replace(/[A-Za-z]+/g, '')
    .replace(/[€£¥₹$]/g, '')
    .replace(/[\s  ']/g, '');
  const negative = /^-/.test(text);
  text = text.replace(/^-/, '');
  if (!/^[\d.,]+$/.test(text)) return { value: String(raw), problem: 'unreadable amount in ' + field };
  const lastDot = text.lastIndexOf('.');
  const lastComma = text.lastIndexOf(',');
  if (lastDot !== -1 && lastComma !== -1) {
    const decimal = lastDot > lastComma ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    text = text.split(thousands).join('').replace(decimal, '.');
  } else if (lastComma !== -1) {
    text = /,\d{1,2}$/.test(text) && text.split(',').length === 2 ? text.replace(',', '.') : text.split(',').join('');
  } else if (lastDot !== -1 && /^\d{1,3}(\.\d{3})+$/.test(text) && text.split('.').length > 2) {
    text = text.split('.').join('');
  }
  const value = Number(text);
  if (!isFinite(value) || text === '') return { value: String(raw), problem: 'unreadable amount in ' + field };
  return { value: Math.round((negative ? -value : value) * 100) / 100 };
}

/** ISO code from the currency field, falling back to symbols or codes inside the amounts. */
function resolveCurrency(fields) {
  const texts = [fields.currency].concat(AMOUNT_FIELDS.map((f) => fields[f])).filter((v) => typeof v === 'string');
  for (const text of texts) {
    const code = (text.toUpperCase().match(/\b[A-Z]{3}\b/g) || []).find((c) => CURRENCY_CODES.indexOf(c) !== -1);
    if (code) return code;
  }
  for (const symbol of ['€', '£', '¥', '₹', '$']) {
    if (texts.some((t) => t.indexOf(symbol) !== -1)) return CURRENCY_SYMBOLS[symbol];
  }
  return null;
}

function normaliseEmail(raw, field) {
  const value = String(raw).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? { value } : { value: String(raw), problem: 'invalid email in ' + field };
}

/** Text starting with = + - @ would run as a formula in Google Sheets; a leading ' shows it as text. */
const sheetSafe = (value) => (typeof value === 'string' && /^[=+\-@]/.test(value) ? "'" + value : value);

// ---------- main ----------

function processAnswer(input) {
  const base = {
    source_from: String(input.email_from || ''),
    source_subject: String(input.email_subject || ''),
    processed_at: String(input.email_received_at || ''),
  };
  const toReview = (docType, reasons, extra) =>
    Object.assign({ destination_sheet: 'Needs review', doc_type: docType, needs_review: true, review_reasons: reasons.join('; '), overall_confidence: 0 }, extra || {}, base);

  const parsed = parseAnswer(input.ai_output);
  if (parsed.error) return toReview('unknown', [parsed.error]);

  const answer = parsed.answer;
  const type = answer.doc_type;
  const reasons = [];
  if (type === 'other') reasons.push('not an order, invoice or enquiry');

  const row = {};
  const hasAmounts = AMOUNT_FIELDS.some((f) => FIELDS_BY_TYPE[type].indexOf(f) !== -1);
  for (const field of FIELDS_BY_TYPE[type]) {
    const raw = answer.fields[field];
    if (raw === null || raw === undefined || raw === '') {
      row[field] = '';
      continue;
    }
    let result = { value: typeof raw === 'number' ? raw : String(raw).trim() };
    if (DATE_FIELDS.indexOf(field) !== -1) result = normaliseDate(raw, field);
    else if (AMOUNT_FIELDS.indexOf(field) !== -1) result = parseAmount(raw, field);
    else if (EMAIL_FIELDS.indexOf(field) !== -1) result = normaliseEmail(raw, field);
    else if (field === 'currency') result = { value: '' }; // filled in below
    if (result.problem) reasons.push(result.problem);
    row[field] = sheetSafe(result.value);
  }

  for (const field of REQUIRED_BY_TYPE[type]) {
    if (row[field] === '') reasons.push('missing required field: ' + field);
  }

  if (hasAmounts) {
    const code = resolveCurrency(answer.fields);
    if (code) row.currency = code;
    else {
      row.currency = sheetSafe(answer.fields.currency ? String(answer.fields.currency) : '');
      reasons.push('unknown currency');
    }
  }

  if (type === 'invoice' && [row.subtotal, row.tax, row.total].every((v) => typeof v === 'number')) {
    if (Math.abs(row.subtotal + row.tax - row.total) > 0.01) {
      reasons.push("invoice totals don't add up (" + row.subtotal + ' + ' + row.tax + ' ≠ ' + row.total + ')');
    }
  }

  for (const field of FIELDS_BY_TYPE[type]) {
    const confidence = answer.field_confidence[field];
    if (typeof confidence === 'number' && confidence < MIN_CONFIDENCE) {
      reasons.push('low confidence: ' + field + ' (' + confidence + ')');
    }
  }
  if (answer.overall_confidence < MIN_CONFIDENCE) reasons.push('low overall confidence (' + answer.overall_confidence + ')');

  return Object.assign(
    {
      destination_sheet: reasons.length ? 'Needs review' : 'Extracted',
      doc_type: type,
      needs_review: reasons.length > 0,
      review_reasons: reasons.join('; '),
      overall_confidence: answer.overall_confidence,
    },
    row,
    base,
  );
}

try {
  output = processAnswer(inputData);
} catch (error) {
  // Never stop the Zap: an unexpected problem still produces a review row.
  output = {
    destination_sheet: 'Needs review',
    doc_type: 'unknown',
    needs_review: true,
    review_reasons: 'internal error: ' + (error && error.message ? error.message : String(error)),
    overall_confidence: 0,
    source_from: String(inputData.email_from || ''),
    source_subject: String(inputData.email_subject || ''),
    processed_at: String(inputData.email_received_at || ''),
  };
}
