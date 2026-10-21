// `npm run record`: Claude asked again, with `claude -p` on this machine, for every prompt of the
// recordings the tests and the demo replay; its answers written in their place.
import { readFileSync, writeFileSync } from 'node:fs';
import { claude } from '../src/claude.ts';
import type { ModelRecording } from '../src/core/replay.ts';

const ask = claude({ command: process.env.SKILL_ATLAS_CLAUDE || undefined });
for (const file of process.argv.slice(2)) {
  const recording = JSON.parse(readFileSync(file, 'utf8')) as ModelRecording;
  for (const prompt of Object.keys(recording)) recording[prompt] = await ask(prompt);
  writeFileSync(file, `${JSON.stringify(recording, null, 2)}\n`);
  console.log(`${file}: ${Object.keys(recording).length} answers`);
}
