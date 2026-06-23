import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { renderSkillMarkdown } from '../src/content/catalog.js';

const outputPath = resolve('.agents/skills/playwright-cli-axi/SKILL.md');
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, renderSkillMarkdown(), 'utf8');
