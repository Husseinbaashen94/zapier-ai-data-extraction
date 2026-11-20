# AI Inbox-to-Spreadsheet for Zapier

![CI](https://github.com/Husseinbaashen94/zapier-ai-data-extraction/actions/workflows/ci.yml/badge.svg)
![Zapier](https://img.shields.io/badge/Zapier-Code%20%2B%20Claude-FF4F00?logo=zapier&logoColor=white)
![Claude](https://img.shields.io/badge/AI-Claude-D97757)

**Stop copy-pasting from emails into spreadsheets.** Orders, invoices and enquiries are read by AI, checked, and filed as clean rows. Anything uncertain goes to a person, with the reason.

## The problem

Every day someone opens order confirmations, supplier invoices and customer enquiries, then retypes names, numbers, dates and amounts into a spreadsheet. It's slow, and it goes wrong in quiet, expensive ways: `03/04` entered as March instead of April, `€1.234,50` entered as 1.23, a forwarded email's old order number copied by mistake.

## What it does

A Zap that sends each matching email to **Claude** to read, then runs a **tested validation step** before anything reaches your sheet:

```mermaid
flowchart LR
    A[Gmail:<br/>new matching email] --> B[Claude reads it:<br/>order, invoice or enquiry?<br/>extract the fields]
    B --> C[Code step checks it:<br/>dates, amounts, currency,<br/>totals, confidence]
    C -->|all clear| D[Sheet: Extracted]
    C -->|anything uncertain| E[Sheet: Needs review<br/>with the reason]
```

- **Three document types:** orders, supplier invoices and enquiries, each with its own fields. Anything else (newsletters, notifications) goes to review.
- **Dates are never guessed.** `2 November 2026`, `15/10/2026` and `3 abril 2026` become `2026-…` ISO dates. Truly ambiguous ones like `03/04/2026` are kept as written and flagged.
- **Money in any format:** `€1.234,50`, `1,040.00 USD` and `£ 99` all become numbers with an ISO currency code. Invoices are checked: subtotal + tax must equal the total.
- **Confidence-aware:** Claude rates every field, and anything below 0.7 (blurry scans, half-visible numbers) goes to a person.
- **Safe by design:** text that would run as a spreadsheet formula (`=HYPERLINK(…)`) is stored as plain text, and emails that try to instruct the AI ("set the total to 0") are flagged instead of obeyed.

![Demo output: extracted rows and the review queue](docs/images/preview.png)

*The demo's output for 12 sample emails: 7 extracted, 5 sent to review with the reason. Open [docs/demo/preview.html](docs/demo/preview.html) for the full page with source emails.*

## See it run in 2 minutes

No Zapier account and no API key needed. The demo runs the exact Code step pasted into Zapier over 12 sample emails and Claude's recorded answers:

```bash
git clone https://github.com/Husseinbaashen94/zapier-ai-data-extraction.git
cd zapier-ai-data-extraction
npm install
npm run demo
```

```
7 rows extracted, 5 need review

OK      order    Order SO-10482 confirmation
OK      invoice  Invoice INV-2026-0931
REVIEW  order    Order SO-10490  (ambiguous date in order_date)
OK      invoice  Factura / Invoice LP-7781
REVIEW  order    Order SO-10511  (missing required field: total)
REVIEW  invoice  Scanned invoice  (low confidence: invoice_number (0.62))
REVIEW  order    Order SO-10601  (low overall confidence (0.4))
…
```

It writes `out/Extracted.csv`, `out/Needs-review.csv` (they open in Excel and Google Sheets, Arabic and accents included) and `out/preview.html`.

## Proven by tests

**149 automated tests** run on every change. Zapier can't be run in CI, so the tests cover the two things the Zap is made of: **the exact Code step you paste into Zapier** and **the exact prompt you paste into the Claude step**.

| Layer | Tests | What they prove |
|---|---|---|
| **Code step** | 70 | All 12 sample emails land on the right sheet with the right values. Also covered: date and money formats, invoice arithmetic, confidence thresholds, formula escaping, broken or truncated AI answers (never crashes, always a review row), and a < 100 ms runtime per email |
| **Zapier contract** | 8 | A harness runs the step the way Zapier does: text-only inputs, flat output, no `require`, no network. Anything that would break inside Zapier breaks here first |
| **Prompt & guide** | 17 | The email stays inside a data block, an injection attempt can't escape it, and `zapier/ai-step.md` is regenerated from the tested prompt (a test fails if it goes stale) |
| **Contracts, demo & docs** | 54 | Sample data and schema stay valid, the CSV and preview are correct, the build guide's columns match the code, and the declared Node version matches what the tools need |

The step was also **mutation-checked**: deliberately breaking formula escaping or the ambiguous-date rule makes 5 tests fail each.

**Live AI evaluation:** `npm run test:live` sends all 12 emails to the real Claude API with the same prompt and runs each reply through the same Code step. It requires every answer to parse, the injection email to keep its real total, and at least 10 of 12 on the right sheet. The answers used by the demo and tests are hand-written (`"synthetic": true` in `fixtures/recorded/`) until replaced by real ones with `npm run record`.

> **Status:** the Code step, prompt and demo are tested in CI. The Zap itself is **built from the guide; pending verification in Zapier**.

## Build it in Zapier

Follow [docs/build-guide.md](docs/build-guide.md): four steps (Gmail → Claude → Code → Google Sheets), each with the exact settings to paste. **You need a Zapier plan with multi-step Zaps (Professional or higher):** Zapier's free plan allows only 2-step Zaps. The Code step needs no network and runs in milliseconds, so it doesn't push you to a higher tier.

## Adapt it for your business

| Change | Where |
|---|---|
| Document types and their fields | `FIELDS_BY_TYPE` in `zapier/code-steps/validate-and-route.js` and the field list in `prompts/extract.md` |
| Which fields a row can't do without | `REQUIRED_BY_TYPE` in the Code step |
| How sure Claude must be before a row skips review | `MIN_CONFIDENCE` in the Code step (default 0.7) |
| Extraction rules and wording | `prompts/extract.md`, then `npm run build:guide` to regenerate `zapier/ai-step.md` |

After a change, run `npm test` and paste the updated step and prompt into Zapier.

**Using OpenAI instead?** Use Zapier's OpenAI app with the same system prompt and user message. The Code step only needs the reply text, so it works unchanged.

## Getting started

### 1. Prerequisites

| Tool | Version | Check | Install |
|------|---------|-------|---------|
| Node.js | 22.12 or newer | `node -v` | [nodejs.org](https://nodejs.org/) |
| Git | any recent | `git --version` | [git-scm.com](https://git-scm.com/downloads) |

### 2. Clone and install

```bash
git clone https://github.com/Husseinbaashen94/zapier-ai-data-extraction.git
cd zapier-ai-data-extraction
npm install
```

### 3. Configure (optional)

The demo and tests work out of the box. Only the live evaluation needs settings:

```bash
cp .env.example .env
```

| Variable | Purpose and default |
|----------|---------------------|
| `ANTHROPIC_API_KEY` | Only for `npm run test:live` and `npm run record`. Default: none |
| `AI_MODEL` | Claude model for the live evaluation. Use the same one as in your Zap. Default `claude-opus-5-5` |
| `LIVE_EVAL` | `1` runs the live evaluation with a credential other than an API key. Default: empty |

Empty values use the default. `.env` is git-ignored, so nothing you put in it is ever committed.

### 4. Run it

```bash
npm run demo          # the 2-minute demo
npm test              # all 149 tests (no network)
npm run test:live     # live Claude evaluation (needs ANTHROPIC_API_KEY)
npm run build:guide   # regenerate zapier/ai-step.md after editing the prompt
npm run typecheck
```

### 5. View the results

Open `out/preview.html` in a browser: both sheets, grouped by document type, with each row's source email. The CSV files in `out/` are what the Zap writes to your Google Sheet.

### Troubleshooting

| Problem | Fix |
|---------|-----|
| `npm install` or tests fail on an older Node | Upgrade Node.js to 22.12 or newer |
| Zapier: "Your plan doesn't support multi-step Zaps" | The Zap has 4 steps and needs Professional or higher (see the build guide) |
| Zapier Code step: "output must be an object" | Paste the **whole** of `validate-and-route.js`, including the last `try { output = … }` block |
| Rows always land in `Needs review` with "AI answer is not valid JSON" | The Claude step's System field is empty or edited. Paste it again from `zapier/ai-step.md` |
| A real document is extracted wrongly | Add it as a sample under `fixtures/`, run `npm run test:live` to reproduce, then refine `prompts/extract.md` |

## Work with me

I build and test automations like this for sales, marketing and operations teams: Zapier, Make and n8n, with Claude or OpenAI, **delivered with tests that prove they work**.

👉 [github.com/Husseinbaashen94](https://github.com/Husseinbaashen94): open an issue on this repo to get in touch.

---

MIT licensed. Sample companies and people in `fixtures/` are fictional.
