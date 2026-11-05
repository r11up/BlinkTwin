// Writes docs/SCIENCE.md from the same text the app shows (src/ui/science.ts), so the two never drift.
//   node scripts/science-md.ts
import { writeFileSync } from 'node:fs';
import { SCIENCE } from '../src/ui/science.ts';

const md = (html: string) =>
  html
    .replace(/<li>/g, '- ')
    .replace(/<\/li>/g, '\n')
    .replace(/<\/?ul[^>]*>/g, '\n')
    .replace(/<\/?b>/g, '**')
    .replace(/<\/?i>/g, '*')
    .replace(/<p>/g, '')
    .replace(/<\/p>/g, '\n\n')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim();

const out = [
  '# The science behind BlinkTwin',
  '',
  'Everything BlinkTwin predicts, how it is computed, the evidence behind it and its limits. The app shows the same text under each "How is this predicted?" link. Numbers come from the analyses in `results/`.',
  '',
  ...SCIENCE.flatMap((s) => [`## ${s.title}`, '', md(s.html), '']),
].join('\n');
writeFileSync('../docs/SCIENCE.md', out + '\n');
console.log('wrote docs/SCIENCE.md');
