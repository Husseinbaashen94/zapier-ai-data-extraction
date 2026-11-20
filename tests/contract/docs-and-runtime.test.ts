import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SHEET_COLUMNS } from '../../src/sheet.js';

const read = (path: string) => readFileSync(path, 'utf8');
const firstMajor = (range: string) => Number(range.match(/(\d+)/)![1]);

describe('build guide stays in step with the code', () => {
  it('the sheet header row in docs/build-guide.md is exactly the columns the demo writes', () => {
    const header = read('docs/build-guide.md').split('```\n')[1].trim();
    expect(header.split('\t')).toEqual(SHEET_COLUMNS);
  });

  it('names every Code step input key the step reads', () => {
    const guide = read('docs/build-guide.md');
    for (const key of ['ai_output', 'email_from', 'email_subject', 'email_received_at']) expect(guide).toContain(`\`${key}\``);
  });
});

describe('runtime requirements a client will actually hit', () => {
  const pkg = JSON.parse(read('package.json'));
  const vitestFloor = firstMajor(JSON.parse(read('node_modules/vitest/package.json')).engines.node);

  it('declares at least the Node version the test runner requires', () => {
    expect(firstMajor(pkg.engines.node)).toBeGreaterThanOrEqual(vitestFloor);
  });

  it.each(['.github/workflows/ci.yml', '.github/workflows/live-eval.yml'])('%s runs on a supported Node version', (file) => {
    expect(Number(read(file).match(/node-version:\s*(\d+)/)![1])).toBeGreaterThanOrEqual(firstMajor(pkg.engines.node));
  });

  it('the README states the Node version', () => {
    expect(read('README.md')).toContain(`Node.js | ${firstMajor(pkg.engines.node)}.12 or newer`);
  });
});

describe('repository hygiene', () => {
  it('commits no test-run output', () => {
    expect(execFileSync('git', ['ls-files', '.vitest', 'out'], { encoding: 'utf8' }).trim()).toBe('');
  });
});
