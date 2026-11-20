import { z } from 'zod';

/** An email as the Zapier Gmail trigger provides it (plus text pulled from a PDF attachment). */
export const IncomingEmailSchema = z
  .object({
    from: z.string().min(1),
    subject: z.string(),
    received_at: z.string().datetime({ offset: true }),
    body: z.string(),
    attachment_text: z.string().optional(),
  })
  .strict();
export type IncomingEmail = z.infer<typeof IncomingEmailSchema>;

export const DOC_TYPES = ['order', 'invoice', 'enquiry', 'other'] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** The fields extracted for each document type: these become spreadsheet columns. */
export const FIELDS_BY_TYPE: Record<DocType, readonly string[]> = {
  order: ['customer_name', 'customer_email', 'order_number', 'order_date', 'items_summary', 'total', 'currency'],
  invoice: ['supplier_name', 'invoice_number', 'invoice_date', 'due_date', 'subtotal', 'tax', 'total', 'currency'],
  enquiry: ['contact_name', 'contact_email', 'company', 'topic', 'requested_action'],
  other: [],
};

/** Claude's answer. Mirrors schemas/extraction.schema.json. */
export const ExtractionSchema = z
  .object({
    doc_type: z.enum(DOC_TYPES),
    fields: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
    field_confidence: z.record(z.string(), z.number().min(0).max(1)),
    overall_confidence: z.number().min(0).max(1),
  })
  .strict();
export type Extraction = z.infer<typeof ExtractionSchema>;
