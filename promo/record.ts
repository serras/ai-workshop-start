// `npm run promo`: a 30-second promotional video of the web view, with captions and no sound, played
// on the fake GitHub of promo/source.ts, into promo/skill-atlas.mp4. Needs ffmpeg.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Locator, type Page } from '@playwright/test';
import { startWeb } from '../src/web.ts';
import { offline } from '../demo/script.ts';
import { model, open } from './source.ts';

const VIDEO = fileURLToPath(new URL('./skill-atlas.mp4', import.meta.url));
const SIZE = { width: 1280, height: 720 };
const LENGTH = 30;

const REPOSITORY = 'https://github.com/northwind/storefront';
const ORGANIZATION = 'https://github.com/northwind';

const web = await startWeb({ open, model, port: 0 });
// Every scan once before recording: Claude's groups are then in memory, and each scan is instant.
for (const repo of [REPOSITORY, ORGANIZATION]) await fetch(`${web.url}/api/scan?repo=${encodeURIComponent(repo)}`);

const LOGO = `<svg viewBox="0 0 32 32" width="88" height="88" aria-hidden="true">
  <circle cx="16" cy="16" r="13" fill="none" stroke="#fff" stroke-width="2.5" opacity="0.55"/>
  <path d="M16 5 L19.5 16 L16 27 L12.5 16 Z" fill="#fff"/>
  <circle cx="16" cy="16" r="2.4" fill="#fbbf24"/>
</svg>`;

/** The captions, the title cards and a pointer, laid over the page; none of it is the page's. */
async function overlay(page: Page) {
  await page.evaluate((logo) => {
    const style = document.createElement('style');
    style.textContent = `
      #promo-caption { position: fixed; left: 50%; bottom: 44px; transform: translate(-50%, 12px); opacity: 0;
        transition: opacity .35s, transform .35s; z-index: 1000; pointer-events: none;
        background: rgba(24, 16, 64, .92); color: #fff; padding: 16px 30px; border-radius: 16px;
        font: 600 30px/1.25 system-ui, -apple-system, sans-serif; letter-spacing: -.01em; white-space: nowrap;
        box-shadow: 0 12px 40px rgba(30, 20, 90, .35); border: 1px solid rgba(255, 255, 255, .15); }
      #promo-caption.shown { opacity: 1; transform: translate(-50%, 0); }
      #promo-card { position: fixed; inset: 0; z-index: 1001; display: flex; flex-direction: column; gap: 18px;
        align-items: center; justify-content: center; color: #fff; text-align: center;
        background: linear-gradient(135deg, #4338ca, #7c3aed); font-family: system-ui, -apple-system, sans-serif;
        opacity: 0; transition: opacity .5s; pointer-events: none; }
      #promo-card.shown { opacity: 1; }
      #promo-card h1 { margin: 0; font-size: 76px; font-weight: 800; letter-spacing: -.03em; display: flex; gap: 22px; align-items: center; }
      #promo-card p { margin: 0; font-size: 32px; font-weight: 500; opacity: .92; }
      #promo-card code { margin-top: 14px; font: 600 28px ui-monospace, Menlo, monospace; background: rgba(0, 0, 0, .28);
        padding: 14px 26px; border-radius: 12px; }
      #promo-pointer { position: fixed; z-index: 999; width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 50%;
        background: rgba(124, 58, 237, .35); border: 3px solid #7c3aed; pointer-events: none;
        transition: left .55s ease-in-out, top .55s ease-in-out, transform .15s, opacity .3s; left: 640px; top: 420px; opacity: 0; }
      #promo-pointer.shown { opacity: 1; }
      #promo-pointer.down { transform: scale(.7); }`;
    document.head.append(style);
    const caption = Object.assign(document.createElement('div'), { id: 'promo-caption' });
    const card = Object.assign(document.createElement('div'), { id: 'promo-card' });
    card.innerHTML = `<h1>${logo}<span>Skill Atlas</span></h1><p></p><code hidden></code>`;
    const pointer = Object.assign(document.createElement('div'), { id: 'promo-pointer' });
    document.body.append(caption, card, pointer);
  }, LOGO);
}

const caption = (page: Page, text: string | null) =>
  page.evaluate((text) => {
    const caption = document.getElementById('promo-caption')!;
    if (text) caption.textContent = text;
    caption.classList.toggle('shown', text !== null);
  }, text);

const card = (page: Page, shown: boolean, text = '', command = '') =>
  page.evaluate(
    ([shown, text, command]) => {
      const card = document.getElementById('promo-card')!;
      if (text) card.querySelector('p')!.textContent = text;
      const code = card.querySelector('code')!;
      code.textContent = command;
      code.hidden = !command;
      card.classList.toggle('shown', shown);
    },
    [shown, text, command] as const,
  );

/** Moves the pointer onto the element, then clicks it. */
async function click(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  await page.evaluate(([x, y]) => {
    const pointer = document.getElementById('promo-pointer')!;
    pointer.classList.add('shown');
    Object.assign(pointer.style, { left: `${x}px`, top: `${y}px` });
  }, [box.x + box.width / 2, box.y + box.height / 2]);
  await page.waitForTimeout(600);
  await page.evaluate(() => document.getElementById('promo-pointer')!.classList.add('down'));
  await target.click();
  await page.waitForTimeout(150);
  await page.evaluate(() => document.getElementById('promo-pointer')!.classList.remove('down'));
  // Out of the way of what it clicked.
  await page.waitForTimeout(250);
  await page.evaluate(() => document.getElementById('promo-pointer')!.classList.remove('shown'));
}

const videos = mkdtempSync(join(tmpdir(), 'skill-atlas-promo-'));
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: SIZE,
    deviceScaleFactor: 1,
    colorScheme: 'light',
    locale: 'en-US',
    // The overlay is the promo's, not the page's: its policy would block its styles.
    bypassCSP: true,
    recordVideo: { dir: videos, size: SIZE },
  });
  const recording = Date.now();
  const page = await context.newPage();
  await offline(page, web.url);
  const wait = (seconds: number) => page.waitForTimeout(seconds * 1000);
  const repo = page.locator('#repo');
  const summary = page.locator('#summary');

  await page.goto(web.url);
  await overlay(page);
  await card(page, true, 'Every agent skill in your repositories, at a glance');
  await wait(0.6);
  const start = (Date.now() - recording) / 1000;
  await wait(2.4);
  await card(page, false);
  await wait(0.5);

  // A repository: its skills, grouped by Claude.
  await caption(page, 'Paste a GitHub repository…');
  await click(page, repo);
  await repo.pressSequentially(REPOSITORY, { delay: 30 });
  await click(page, page.locator('#scan button'));
  await summary.filter({ hasText: 'northwind/storefront' }).waitFor();
  await caption(page, '…and see all its skills, grouped by Claude');
  await wait(2.2);

  // A skill: its SKILL.md, rendered.
  await caption(page, 'Click a skill to read its SKILL.md, nicely rendered');
  await click(page, page.locator('#list button[data-name="code-review"]').first());
  await wait(2.8);

  // An organization: every repository at once.
  await caption(page, 'Or scan a whole organization at once');
  await click(page, repo);
  await repo.fill('');
  await repo.pressSequentially(ORGANIZATION, { delay: 30 });
  await click(page, page.locator('#scan button'));
  await summary.filter({ hasText: 'in 4 repositories' }).waitFor();
  await wait(2.2);

  // The filter.
  await caption(page, 'Find the skill you need as you type');
  const filter = page.locator('#filter');
  await click(page, filter);
  await filter.pressSequentially('review', { delay: 140 });
  await wait(1);
  await click(page, page.locator('#list button[data-name="security-review"]').first());
  await wait(1.5);

  // Dark mode.
  await caption(page, 'Light or dark, just like your system');
  await page.emulateMedia({ colorScheme: 'dark' });
  await wait(2.5);

  await caption(page, null);
  await card(page, true, 'Find, browse and read every skill', './skill-atlas serve');
  await wait(4.5);
  const end = (Date.now() - recording) / 1000;
  console.log(`played ${(end - start).toFixed(1)} s`);

  const video = page.video()!;
  await context.close();
  // From the title card on, LENGTH seconds, in H.264 for Slack and every player; no sound.
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-ss', String(start), '-i', await video.path(), '-t', String(LENGTH),
    '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', VIDEO,
  ]);
  console.log(VIDEO);
} finally {
  await browser.close();
  await web.close();
  rmSync(videos, { recursive: true, force: true });
}
