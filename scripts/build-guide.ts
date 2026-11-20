/** Regenerates zapier/ai-step.md from prompts/extract.md:  npm run build:guide */
import { writeFileSync } from 'node:fs';
import { renderZapierAiStep } from '../src/request.js';

writeFileSync('zapier/ai-step.md', renderZapierAiStep());
console.log('wrote zapier/ai-step.md');
