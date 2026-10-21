// The selected SKILL.md's card holds all of its content, in a real browser: long code spans, links
// and values wrap, and only a code block scrolls sideways. So does a failed scan's message in its box.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { offline } from '../../demo/script.ts';

const URL = 'https://example.com/a/very/long/path/that/never/ends/and/keeps/going/on/and/on/forever/and/ever/and/ever/index.html';
const PATH = 'repo/test-runtime/src/main/kotlin/org/jetbrains/kotlin/test/services/configuration/JvmEnvironmentConfigurator.kt';

const SKILLS = {
  'long-word': `---
name: long-word
description: Look at ${URL} for more.
homepage: ${URL}
---
# Long
`,
  'build-tools-add-test-federation-annotations-to-integration-tests': `---
name: build-tools-add-test-federation-annotations-to-integration-tests
description: Adds \`@MustRunOnChangesInXYZ\` to the tests of \`kotlin-gradle-plugin-integration-tests-and-some-more-of-them\`.
---
# Annotate the tests
Open \`${PATH}\`, then [${URL}](${URL}) and ${URL}.

| File | What |
| --- | --- |
| \`${PATH}\` | the configurator |

\`\`\`kotlin
@MustRunOnChangesInXYZ(paths = ["${PATH}", "${PATH}"])
\`\`\`
`,
};

let root: string;
test.beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-atlas-overflow-'));
  for (const [name, text] of Object.entries(SKILLS)) {
    mkdirSync(join(root, '.claude', 'skills', name), { recursive: true });
    writeFileSync(join(root, '.claude', 'skills', name, 'SKILL.md'), text);
  }
});
test.afterAll(() => rmSync(root, { recursive: true, force: true }));

/** How far `selector` sticks out sideways: its content past its box, and its box past `within`'s. */
const overflow = (page: Page, selector: string, within: string) =>
  page.evaluate(([selector, within]) => {
    const element = document.querySelector(selector)!;
    const outer = document.querySelector(within)!.getBoundingClientRect();
    return { content: Math.max(0, element.scrollWidth - element.clientWidth), box: Math.max(0, element.getBoundingClientRect().right - outer.right) };
  }, [selector, within] as const);

async function select(page: Page, baseURL: string, width: number, name: string) {
  await offline(page, baseURL);
  await page.setViewportSize({ width, height: 760 });
  await page.goto('/');
  await page.locator('#repo').fill(root);
  await page.locator('#scan button').click();
  await page.locator(`#list button[data-name="${name}"]`).click();
  await page.locator('#skill > header h2').filter({ hasText: name }).waitFor();
}

for (const width of [700, 1200]) {
  test(`at ${width} px, long code spans, links and values wrap in the card; only a code block scrolls`, async ({ page, baseURL }) => {
    await select(page, baseURL!, width, 'build-tools-add-test-federation-annotations-to-integration-tests');
    expect(await overflow(page, '#skill', 'main')).toEqual({ content: 0, box: 0 });
    for (const part of ['#skill > header', '#skill > .markdown', '.front-matter', '.markdown > table']) {
      expect(await overflow(page, part, '#skill'), part).toEqual({ content: 0, box: 0 });
    }
    const block = await overflow(page, '#skill > .markdown pre', '#skill > .markdown');
    expect(block.box).toBe(0);
    expect(block.content).toBeGreaterThan(0);
  });

  test(`at ${width} px, a long URL in the front matter wraps in the card`, async ({ page, baseURL }) => {
    await select(page, baseURL!, width, 'long-word');
    expect(await overflow(page, '#skill', 'main')).toEqual({ content: 0, box: 0 });
    expect(await overflow(page, '.front-matter', '#skill')).toEqual({ content: 0, box: 0 });
  });
}

test('a failed scan\'s long message wraps in its red box, in the left pane', async ({ page, baseURL }) => {
  await offline(page, baseURL!);
  await page.goto('/');
  await page.locator('#repo').fill(`./${URL.replace(/^https:\/\//, '')}`);
  await page.locator('#scan button').click();
  await page.locator('#status.error').waitFor();
  expect(await overflow(page, '#status', '#skills')).toEqual({ content: 0, box: 0 });
  expect(await overflow(page, '#skills', '#skills')).toEqual({ content: 0, box: 0 });
});
