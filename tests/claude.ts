#!/usr/bin/env node
// `claude -p` for the tests: the prompt on stdin, the answer recorded in tests/claude.json on
// stdout; an unrecorded prompt fails, as Claude would without a login.
import { readFileSync } from 'node:fs';
import { text } from 'node:stream/consumers';

const recording: Record<string, string> = JSON.parse(readFileSync(new URL('./claude.json', import.meta.url), 'utf8'));
const prompt = await text(process.stdin);
if (process.argv[2] !== '-p' || !Object.hasOwn(recording, prompt)) {
  console.error('not recorded');
  process.exit(1);
}
process.stdout.write(recording[prompt]);
