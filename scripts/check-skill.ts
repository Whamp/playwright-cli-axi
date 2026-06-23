import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { renderSkillMarkdown } from '../src/content/catalog.js';

const outputPath = resolve('.agents/skills/playwright-cli-axi/SKILL.md');
const expected = renderSkillMarkdown();
const actual = await readFile(outputPath, 'utf8').catch(() => '');
if (actual !== expected) {
  console.error('Generated skill is stale. Run `npm run generate:skill`.');
  process.exit(1);
}
