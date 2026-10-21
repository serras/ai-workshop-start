// The demo: every feature of the web view, played on the fake GitHub of source.ts, with a shot at
// each key moment. demo/record.ts plays it to take the shots in shots/, and a video;
// tests/visual/demo.spec.ts plays it again and compares each shot with those.
import { readFileSync } from 'node:fs';
import type { BrowserContextOptions, Page, PageScreenshotOptions } from '@playwright/test';

/** The same browser for the shots and the test: same size, scale, colors, language and clock. */
export const BROWSER: BrowserContextOptions = {
  viewport: { width: 1200, height: 760 },
  deviceScaleFactor: 1,
  colorScheme: 'light',
  reducedMotion: 'reduce',
  locale: 'en-US',
  timezoneId: 'UTC',
};

/** What `toHaveScreenshot` uses, so that a shot taken by hand matches it pixel for pixel. */
export const SHOT: PageScreenshotOptions = { animations: 'disabled', caret: 'hide', scale: 'css' };

export type Player = {
  /** Takes the shot `name`, once the page is still. */
  shot(name: string): Promise<void>;
  /** How long to linger after each step, so the video can be followed; 0 in the test. */
  pace: number;
};

const AVATAR = readFileSync(new URL('./avatar.svg', import.meta.url));

/** The page only ever loads from the server: images elsewhere are answered with avatar.svg. */
export async function offline(page: Page, url: string) {
  await page.route(
    (address) => !address.href.startsWith(url),
    (route) =>
      route.request().resourceType() === 'image'
        ? route.fulfill({ status: 200, contentType: 'image/svg+xml', body: AVATAR })
        : route.abort(),
  );
}

export async function play(page: Page, url: string, { shot, pace }: Player) {
  const repo = page.locator('#repo');
  const filter = page.locator('#filter');
  const summary = page.locator('#summary');
  const skill = (name: string) => page.locator(`#list button[data-name="${name}"]`).first();
  const article = page.locator('#skill > header h2');

  async function moment(name: string) {
    // No hover, every image and font loaded.
    await page.mouse.move(0, 0);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].filter((image) => !image.complete).map((image) => image.decode().catch(() => {})));
    });
    await shot(name);
    if (pace) await page.waitForTimeout(pace);
  }

  async function scan(input: string, done: string) {
    await repo.fill(input);
    await page.locator('#scan button').click();
    await summary.filter({ hasText: done }).waitFor();
  }

  async function type(text: string) {
    await filter.fill('');
    await filter.pressSequentially(text, { delay: pace / 8 });
  }

  // Before any scan: the field at the top, the filter on the left.
  await page.goto(url);
  await moment('01-start');

  // While scanning: the scan is held until the shot is taken.
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/scan?*', async (route) => (await held, route.continue()), { times: 1 });
  await repo.fill('https://github.com/acme/rocket');
  await page.locator('#scan button').click();
  await page.locator('#status', { hasText: 'Scanning' }).waitFor();
  await moment('02-scanning');
  release();

  // A repository: its owner's avatar, login and homepage; its skills by affinity, as chips.
  await summary.filter({ hasText: 'acme/rocket · 2 skills' }).waitFor();
  await moment('03-repository');

  // A skill: its front matter as a table, its Markdown, its path linked, its repository's stars.
  await skill('commits').click();
  await article.filter({ hasText: 'commits' }).waitFor();
  await moment('04-skill');

  // An organization: its skills by affinity, across its repositories, and its warnings.
  await scan('https://github.com/acme', 'acme · 5 skills in 3 repositories');
  await page.locator('#warnings summary').click();
  await moment('05-organization');

  // A skill of the organization: its repository in the path, and its copies.
  await skill('release').click();
  await article.filter({ hasText: 'release' }).waitFor();
  await moment('06-copies');

  // The filter, ignoring case: the selected skill stays on the right, even filtered out.
  await type('TRI');
  await moment('07-filter');

  // Nothing matches.
  await type('zzz');
  await page.locator('#no-match', { hasText: 'No skills found' }).waitFor();
  await moment('08-no-match');

  // A reload keeps the scan, the selection and the filter.
  await type('re');
  await page.reload();
  await summary.filter({ hasText: 'acme · 5 skills' }).waitFor();
  await article.filter({ hasText: 'release' }).waitFor();
  await moment('09-reload');

  // A long list scrolls under the filter, which stays at the top; a new scan empties it.
  await scan('https://github.com/acme/handbook', 'acme/handbook · 60 skills');
  await page.locator('#found').evaluate((found) => (found.scrollTop = found.scrollHeight));
  await moment('10-scroll');

  // An owner GitHub gives no profile for: its login only, and a warning.
  await scan('https://github.com/solo/notes', 'solo/notes · 1 skill');
  await page.locator('#warnings summary').click();
  await moment('11-no-profile');

  // A local directory: no owner, no stars, the path only text.
  await scan('./fixture', 'fixture · 3 skills');
  await skill('code-style').click();
  await article.filter({ hasText: 'code-style' }).waitFor();
  await moment('12-directory');

  // An organization without skills.
  await scan('https://github.com/empty', 'empty · 0 skills');
  await moment('13-empty');

  // A failed scan: its message, under the filter.
  await repo.fill('https://github.com/acme/missing');
  await page.locator('#scan button').click();
  await page.locator('#status.error', { hasText: 'Repository not found' }).waitFor();
  await moment('14-error');

  // The same page in dark mode.
  await scan('https://github.com/acme/rocket', 'acme/rocket · 2 skills');
  await skill('commits').click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await moment('15-dark');
}
