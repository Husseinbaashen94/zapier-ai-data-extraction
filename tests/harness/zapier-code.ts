/**
 * Runs a Code by Zapier (JavaScript) step the way Zapier does:
 *  - the code is the body of an async function, with `inputData` (all values are strings)
 *  - it sets `output = {...}` or returns an object
 *  - no `require`, no npm packages; we also leave out `fetch`, `process` and `module` because
 *    this step must work on Zapier's free plan, where Code steps time out after about 1 second
 *  - output must be flat (string, number or boolean values) so every key maps to a sheet column
 */
import { createContext, Script } from 'node:vm';

export type ZapierOutput = Record<string, string | number | boolean>;

export async function runZapierCode(
  source: string,
  inputData: Record<string, string>,
): Promise<{ output: ZapierOutput; ms: number }> {
  const context = createContext({
    inputData: Object.freeze({ ...inputData }),
    console: { log() {}, error() {}, warn() {} },
  });
  const wrapped = `(async () => { var output; const __returned = await (async () => { ${source}\n })(); return __returned !== undefined ? __returned : output; })()`;

  const started = performance.now();
  // Zapier's own timeout is enforced by the caller's assertion on `ms`; the vm timeout stops runaway loops.
  const output = (await new Script(wrapped, { filename: 'zapier-code-step.js' }).runInContext(context, { timeout: 1000 })) as unknown;
  const ms = performance.now() - started;

  if (output === undefined || output === null) throw new Error('Code step produced no output');
  if (typeof output !== 'object' || Array.isArray(output)) throw new Error('Code step output must be a flat object');
  for (const [key, value] of Object.entries(output)) {
    if (!['string', 'number', 'boolean'].includes(typeof value)) {
      throw new Error(`Code step output must be flat: "${key}" is ${value === null ? 'null' : Array.isArray(value) ? 'an array' : typeof value}`);
    }
  }
  return { output: { ...(output as ZapierOutput) }, ms };
}
