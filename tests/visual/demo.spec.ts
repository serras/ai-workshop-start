// The demo of demo/script.ts, played again: every shot must be the one in shots/, but for at most 2% of its pixels.
// `npm run demo` takes them again after a change to the page.
import { expect, test } from '@playwright/test';
import { offline, play } from '../../demo/script.ts';

test('the demo looks as in shots/', async ({ page, baseURL }) => {
  await offline(page, baseURL!);
  await play(page, baseURL!, {
    pace: 0,
    // Soft: every shot is compared, and every difference reported.
    shot: (name) => expect.soft(page).toHaveScreenshot(`${name}.png`),
  });
});
