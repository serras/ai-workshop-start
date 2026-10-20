// `npm run demo`: plays the demo on the fake GitHub, takes its shots into shots/, the reference
// tests/visual/demo.spec.ts compares with, and records it as shots/demo.webm.
import { mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { startWeb } from '../src/web.ts';
import { BROWSER, SHOT, offline, play } from './script.ts';
import { open } from './source.ts';

const SHOTS = fileURLToPath(new URL('../shots', import.meta.url));
mkdirSync(SHOTS, { recursive: true });
const videos = mkdtempSync(join(tmpdir(), 'skill-atlas-demo-'));

const web = await startWeb({ open, port: 0 });
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ ...BROWSER, recordVideo: { dir: videos, size: BROWSER.viewport! } });
  const page = await context.newPage();
  await offline(page, web.url);
  await play(page, web.url, {
    pace: 1200,
    async shot(name) {
      await page.screenshot({ ...SHOT, path: join(SHOTS, `${name}.png`) });
      console.log(`shots/${name}.png`);
    },
  });
  const video = page.video()!;
  await context.close();
  renameSync(await video.path(), join(SHOTS, 'demo.webm'));
  console.log('shots/demo.webm');
} finally {
  await browser.close();
  await web.close();
  rmSync(videos, { recursive: true, force: true });
}
