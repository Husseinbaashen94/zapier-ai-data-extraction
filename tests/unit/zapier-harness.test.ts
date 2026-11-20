import { describe, expect, it } from 'vitest';
import { runZapierCode } from '../harness/zapier-code.js';

describe('runZapierCode (mirrors the Code by Zapier JavaScript contract)', () => {
  it('runs top-level code that assigns output, with inputData available', async () => {
    const result = await runZapierCode('output = { greeting: "hi " + inputData.name, n: 2, ok: true };', { name: 'Ana' });
    expect(result.output).toEqual({ greeting: 'hi Ana', n: 2, ok: true });
    expect(result.ms).toBeGreaterThanOrEqual(0);
  });

  it('supports return, as Zapier does', async () => {
    expect((await runZapierCode('return { a: "b" };', {})).output).toEqual({ a: 'b' });
  });

  it('has no require (Zapier JS steps cannot import npm packages)', async () => {
    await expect(runZapierCode('const fs = require("fs"); output = {};', {})).rejects.toThrow(/require is not defined/);
  });

  it('has no fetch, process or module, so a step that needs the network fails here first', async () => {
    for (const name of ['fetch', 'process', 'module']) {
      await expect(runZapierCode(`output = { t: typeof ${name} };`, {})).resolves.toMatchObject({ output: { t: 'undefined' } });
    }
  });

  it('rejects nested output, which cannot be mapped to sheet columns', async () => {
    await expect(runZapierCode('output = { a: { b: 1 } };', {})).rejects.toThrow(/flat/);
  });

  it('rejects null values and arrays in output', async () => {
    await expect(runZapierCode('output = { a: null };', {})).rejects.toThrow(/flat/);
    await expect(runZapierCode('output = { a: [1] };', {})).rejects.toThrow(/flat/);
  });

  it('rejects a step that sets no output', async () => {
    await expect(runZapierCode('const x = 1;', {})).rejects.toThrow(/no output/);
  });

  it('passes every inputData value as a string, like Zapier', async () => {
    const result = await runZapierCode('output = { t: typeof inputData.n };', { n: '5' });
    expect(result.output.t).toBe('string');
  });
});
