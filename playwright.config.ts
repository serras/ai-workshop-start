// `npm run test:visual`: the demo played again, each shot compared with the one in shots/, pixel for pixel.
import { defineConfig } from '@playwright/test';
import { BROWSER } from './demo/script.ts';

const PORT = 3100;

export default defineConfig({
  testDir: 'tests/visual',
  snapshotPathTemplate: 'shots/{arg}{ext}',
  // Only `npm run demo` takes the shots: a missing one fails, as a different one does.
  updateSnapshots: 'none',
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  expect: { toHaveScreenshot: { threshold: 0, maxDiffPixels: 0 } },
  use: { ...BROWSER, baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  webServer: {
    command: `node demo/serve.ts ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});
