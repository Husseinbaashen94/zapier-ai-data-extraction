import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIELDS_BY_TYPE, IncomingEmailSchema } from '../../src/types.js';

const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const ids = readdirSync('fixtures/inputs').map((f) => f.replace(/\.json$/, ''));
const expected: Record<string, { destination_sheet: string; doc_type: keyof typeof FIELDS_BY_TYPE; fields: Record<string, unknown> }> =
  readJson('fixtures/expected.json');

describe('fixture contract', () => {
  it('has 12 sample emails', () => {
    expect(ids).toHaveLength(12);
  });

  it.each(ids)('%s is a valid incoming email', (id) => {
    const parsed = IncomingEmailSchema.safeParse(readJson(`fixtures/inputs/${id}.json`));
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it('expected.json covers exactly the fixtures', () => {
    expect(Object.keys(expected).sort()).toEqual([...ids].sort());
  });

  it.each(ids)('%s expects exactly the field set of its document type', (id) => {
    const { doc_type, fields, destination_sheet } = expected[id];
    expect(Object.keys(FIELDS_BY_TYPE)).toContain(doc_type);
    expect(Object.keys(fields).sort()).toEqual([...FIELDS_BY_TYPE[doc_type]].sort());
    expect(['Extracted', 'Needs review']).toContain(destination_sheet);
  });
});

describe('extraction schema', () => {
  const schema = readJson('schemas/extraction.schema.json');

  it('is closed: no extra properties', () => {
    expect(schema.additionalProperties).toBe(false);
  });

  it('allows exactly the four document types', () => {
    expect(schema.properties.doc_type.enum).toEqual(['order', 'invoice', 'enquiry', 'other']);
  });

  it('requires the type, fields and both confidence values', () => {
    expect([...schema.required].sort()).toEqual(['doc_type', 'field_confidence', 'fields', 'overall_confidence']);
  });
});
