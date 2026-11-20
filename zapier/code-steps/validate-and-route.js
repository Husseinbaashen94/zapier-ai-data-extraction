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
const CURRENCY_SYMBOLS = { '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR' };
const PREFIXED_DOLLARS = { US$: 'USD', R$: 'BRL', C$: 'CAD', CA$: 'CAD', A$: 'AUD', AU$: 'AUD', NZ$: 'NZD', HK$: 'HKD', S$: 'SGD', SG$: 'SGD', MX$: 'MXN' };
// Currencies written with a decimal point and comma thousands ($1,000.00), and 3-decimal currencies.
const DOT_DECIMAL = ['USD', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'HKD', 'SGD', 'INR', 'CNY', 'MYR', 'MXN', 'AED', 'SAR', 'QAR', 'KWD'];
const THREE_DECIMAL = ['KWD'];

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
/** A leading ' makes Google Sheets keep a value as typed text instead of re-reading it as a date. */
const asText = (value) => "'" + value;
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
    if (a <= 12 && b <= 12) return { value: asText(text), problem: 'ambiguous date in ' + field };
  }
  return { value: asText(text), problem: 'unreadable date in ' + field };
}

/** Every currency the text mentions, as ISO codes, in order of appearance. */
function currencySignals(text) {
  const signals = [];
  const add = (code) => {
    if (signals.indexOf(code) === -1) signals.push(code);
  };
  let rest = String(text).toUpperCase();
  rest = rest.replace(/[A-Z]{1,3}\$/g, (m) => {
    add(PREFIXED_DOLLARS[m] || 'unknown');
    return ' ';
  });
  (rest.match(/\b[A-Z]{3}\b/g) || []).forEach((c) => {
    if (CURRENCY_CODES.indexOf(c) !== -1) add(c);
  });
  if (rest.indexOf('$') !== -1) add('USD');
  Object.keys(CURRENCY_SYMBOLS).forEach((sym) => {
    if (rest.indexOf(sym) !== -1) add(CURRENCY_SYMBOLS[sym]);
  });
  return signals;
}

/** One ISO code from the currency field and the amounts, or a problem when unknown or contradictory. */
function resolveCurrency(fields) {
  const texts = [fields.currency].concat(AMOUNT_FIELDS.map((f) => fields[f])).filter((v) => typeof v === 'string');
  const codes = [];
  texts.forEach((t) =>
    currencySignals(t).forEach((c) => {
      if (codes.indexOf(c) === -1) codes.push(c);
    }),
  );
  if (codes.indexOf('unknown') !== -1 || codes.length === 0) return { code: null, problem: 'unknown currency' };
  if (codes.length > 1) return { code: codes[0], problem: 'currencies disagree (' + codes.join(', ') + ')' };
  return { code: codes[0] };
}

function parseAmount(raw, field, currency) {
  if (typeof raw === 'number') return { value: Math.round(raw * 1000) / 1000 };
  let text = String(raw)
    .replace(/[A-Za-z]{1,3}\$/g, (m) => (PREFIXED_DOLLARS[m.toUpperCase()] ? '' : m))
    .replace(/\b[A-Za-z]{3}\b/g, (m) => (CURRENCY_CODES.indexOf(m.toUpperCase()) !== -1 ? '' : m))
    .replace(/[€£¥₹$]/g, '')
    .replace(/[\s\u00a0\u202f']/g, '');
  const negative = /^-/.test(text);
  text = text.replace(/^-/, '');
  // Any letters left over (1e3, 1.5k, 12abc) mean we can't be sure what the number is.
  if (!/^\d[\d.,]*$/.test(text) || /[.,]$/.test(text)) return { value: String(raw), problem: 'unreadable amount in ' + field };

  const hasDot = text.indexOf('.') !== -1;
  const hasComma = text.indexOf(',') !== -1;
  if (hasDot && hasComma) {
    const decimal = text.lastIndexOf('.') > text.lastIndexOf(',') ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    text = text.split(thousands).join('').replace(decimal, '.');
  } else if (hasDot || hasComma) {
    const sep = hasDot ? '.' : ',';
    const parts = text.split(sep);
    if (parts.length > 2) {
      // 1.234.567 or 1,234,567: only thousands grouping is valid here
      if (!parts.slice(1).every((p) => p.length === 3)) return { value: String(raw), problem: 'unreadable amount in ' + field };
      text = parts.join('');
    } else if (parts[1].length === 3) {
      // 1.234 or 1,234: a thousands separator or a decimal point? Only the currency's convention can tell.
      if (sep === ',' && DOT_DECIMAL.indexOf(currency) !== -1) text = parts.join('');
      else if (sep === '.' && THREE_DECIMAL.indexOf(currency) !== -1) text = parts.join('.');
      else return { value: String(raw), problem: 'ambiguous amount in ' + field };
    } else {
      text = parts.join('.');
    }
  }
  const value = Number(text);
  if (!isFinite(value) || text === '') return { value: String(raw), problem: 'unreadable amount in ' + field };
  return { value: Math.round((negative ? -value : value) * 1000) / 1000 };
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
    source_from: sheetSafe(String(input.email_from || '')),
    source_subject: sheetSafe(String(input.email_subject || '')),
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
  const currency = hasAmounts ? resolveCurrency(answer.fields) : { code: null };
  for (const field of FIELDS_BY_TYPE[type]) {
    const raw = answer.fields[field];
    if (raw === null || raw === undefined || raw === '') {
      row[field] = '';
      continue;
    }
    let result = { value: typeof raw === 'number' ? raw : String(raw).trim() };
    if (DATE_FIELDS.indexOf(field) !== -1) result = normaliseDate(raw, field);
    else if (AMOUNT_FIELDS.indexOf(field) !== -1) result = parseAmount(raw, field, currency.code);
    else if (EMAIL_FIELDS.indexOf(field) !== -1) result = normaliseEmail(raw, field);
    else if (field === 'currency') result = { value: '' }; // filled in below
    if (result.problem) reasons.push(result.problem);
    row[field] = sheetSafe(result.value);
  }

  for (const field of REQUIRED_BY_TYPE[type]) {
    if (row[field] === '') reasons.push('missing required field: ' + field);
  }

  if (hasAmounts) {
    row.currency = currency.code || sheetSafe(answer.fields.currency ? String(answer.fields.currency) : '');
    if (currency.problem) reasons.push(currency.problem);
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
    source_from: String(inputData.email_from || '').replace(/^([=+\-@])/, "'$1"),
    source_subject: String(inputData.email_subject || '').replace(/^([=+\-@])/, "'$1"),
    processed_at: String(inputData.email_received_at || ''),
  };
}
