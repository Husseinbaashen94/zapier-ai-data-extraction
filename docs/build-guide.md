# Build the Zap

About 15 minutes. You'll need a Zapier account, the Gmail inbox the emails arrive in, and a Google Sheet.

## Which Zapier plan?

Checked against Zapier's own pricing page on **2026-11-20**:

| | Free | Professional and up |
|---|---|---|
| Steps per Zap | **2** (one trigger + one action) | multi-step |
| Tasks per month | 100 | more, by tier |
| Code by Zapier runtime | 1 second per step | 30 seconds per step |
| Filters, Paths, Formatter | not available | available |

This Zap has **4 steps** (Gmail → Claude → Code → Google Sheets), so it needs a plan with **multi-step Zaps**, i.e. Professional or higher. It can't be split into several 2-step Zaps either: Claude's answer has to reach the Code step in the same Zap. Check [zapier.com/pricing](https://zapier.com/pricing) for current prices and any trial for new accounts.

The design avoids everything that would push it to a higher tier:
- **No Paths:** a single Google Sheets step picks the worksheet from the Code step's `destination_sheet`.
- **No Filters or Formatter.**
- **The Code step runs in milliseconds with no network calls,** so it stays well within even the 1-second free-plan limit.

## 1. Prepare the Google Sheet

Create a spreadsheet with two worksheets (tabs) named exactly **`Extracted`** and **`Needs review`**. Give both the same header row in row 1:

```
doc_type	needs_review	review_reasons	overall_confidence	customer_name	customer_email	order_number	order_date	items_summary	total	currency	supplier_name	invoice_number	invoice_date	due_date	subtotal	tax	contact_name	contact_email	company	topic	requested_action	source_from	source_subject	processed_at
```

(Copy the line above and paste it into cell A1: the tabs split it into columns. `out/Extracted.csv` from `npm run demo` has the same header if you'd rather import it.)

## 2. Trigger: Gmail → New Email Matching Search

- **App:** Gmail · **Event:** New Email Matching Search
- **Search string:** for example `label:orders-invoices -label:processed`. Use whatever matches the emails you want processed, such as a label your inbox filters apply.
- **Test the trigger** with one real order, invoice or enquiry email.

## 3. Action: Anthropic (Claude) → Send Message

Open [`zapier/ai-step.md`](../zapier/ai-step.md) and copy the **Model**, **System** and **User Message** text exactly. It's generated from the tested prompt in `prompts/extract.md`. In the User Message, replace each `{{…}}` placeholder by inserting the matching Gmail field.

Connect your Anthropic account with an API key from [console.anthropic.com](https://console.anthropic.com/). **Test the step:** the reply should be a single JSON object.

## 4. Action: Code by Zapier → Run JavaScript

- **Input Data:** add four keys, mapped like this:

  | Key | Map to |
  |---|---|
  | `ai_output` | Anthropic step → the reply text |
  | `email_from` | Gmail → From |
  | `email_subject` | Gmail → Subject |
  | `email_received_at` | Gmail → Date |

- **Code:** paste the whole of [`zapier/code-steps/validate-and-route.js`](../zapier/code-steps/validate-and-route.js).
- **Test the step:** the output includes `destination_sheet`, `review_reasons` and one key per column.

This is the exact code the repo's tests run, so don't edit it in Zapier. Change it here, run `npm test`, then paste it again.

## 5. Action: Google Sheets → Create Spreadsheet Row

- **Spreadsheet:** your sheet from step 1.
- **Worksheet:** choose **Custom** (the option to enter or map a value) and map the Code step's **`destination_sheet`**. That sends each row to `Extracted` or `Needs review` without needing Paths.
  - If your account doesn't offer a custom worksheet value here, pick **`Extracted`** for every row instead. The `needs_review` and `review_reasons` columns still flag the rows to check, and a filter view on `needs_review = TRUE` gives you the review queue.
- **Columns:** map each column to the Code step output with the same name.

## 6. Test end to end, then turn the Zap on

Send yourself one email of each kind from `fixtures/inputs/` (for example the order in `doc-01-order.json` and the ambiguous-date order in `doc-04-ambiguous-date.json`) and check they land on the right worksheet with the values shown in `fixtures/expected.json`.

## Optional add-ons (need more steps)

- **Slack alert for review rows:** a Slack "Send Channel Message" step after the Code step, with a filter on `needs_review` (Filters need a paid plan).
- **Mark emails as processed:** a Gmail "Add Label to Email" step adding `processed`, so the search in step 2 never picks an email twice.
- **Attachments:** if your invoices arrive as PDFs, add a step that extracts their text and map it to `{{Attachment Text}}` in the User Message. Emails with the details in the body work without it.

## Zap share link

*Added here once the Zap has been built and verified in Zapier.*
