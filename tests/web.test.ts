// The decisions in spec/web.md, checked on what the web view serves: for ./fixture, for the small
// GitHub repository answered in tests/helpers.ts, and for temporary directories; the page itself,
// app.js run in jsdom against the server.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, type TestContext } from 'node:test';
import { JSDOM } from 'jsdom';
import { run } from '../src/commands.ts';
import { openGitHub } from '../src/core/github.ts';
import { replay } from '../src/core/replay.ts';
import { renderSkill } from '../src/render.ts';
import { startWeb, type ScanAnswer } from '../src/web.ts';
import { matches, noMatch } from '../src/web/filter.js';
import { stars } from '../src/web/stars.js';
import { AVATAR, CLI, EXAMPLE_COMMIT, FAKE_CLAUDE, FIXTURE, model, open } from './helpers.ts';

const web = await startWeb({ open, model, port: 0 });
test.after(() => web.close());

/** What the page fetches for the repository typed at the top. */
async function scanned(repo: string) {
  const response = await fetch(`${web.url}/api/scan?repo=${encodeURIComponent(repo)}`);
  return { status: response.status, body: (await response.json()) as ScanAnswer };
}

/** Every skill in the answer, repository after repository. */
const skillsOf = (body: ScanAnswer) => body.repositories.flatMap((result) => result.skills);

/** The page at `search`, with the real app.js running in it against this server; restored after the test. */
async function page(t: TestContext, search: string) {
  const dom = new JSDOM(await (await fetch(`${web.url}/`)).text(), { url: `${web.url}/${search}` });
  const { document, location, history } = dom.window;
  const saved = { fetch: realFetch };
  Object.assign(globalThis, {
    document,
    location,
    history,
    fetch: (url: string, init?: RequestInit) => saved.fetch(new URL(url, location.href), init),
  });
  t.after(() => {
    Object.assign(globalThis, saved);
    for (const name of ['document', 'location', 'history']) delete (globalThis as Record<string, unknown>)[name];
    dom.window.close();
  });
  // A fresh copy of the module for each page, as a reload runs it again.
  await import(`../src/web/app.js?page=${++pages}`);
  const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
  /** The names listed, the filtered-out ones left aside. */
  const listed = () => [...document.querySelectorAll('#list section:not([hidden]) li:not([hidden]) button')].map((chip) => chip.textContent);
  /** The groups listed, with how many skills each shows. */
  const groups = () => [...document.querySelectorAll('#list section:not([hidden]) h3')].map((heading) => heading.textContent);
  /** Whether the element and all around it are shown. */
  const shown = (selector: string) => {
    for (let element: Element | null = $(selector); element; element = element.parentElement) if ((element as HTMLElement).hidden) return false;
    return true;
  };
  const type = (text: string) => {
    $<HTMLInputElement>('#filter').value = text;
    $('#filter').dispatchEvent(new dom.window.Event('input'));
  };
  return { $, listed, groups, shown, type, location, window: dom.window };
}
let pages = 0;
const realFetch = globalThis.fetch;

/** Waits for the page to show the answer to its scan, `<repo> · 3 skills` by default. */
async function scannedIn(view: Awaited<ReturnType<typeof page>>, repo: string, summary = `${repo} · 3 skills`) {
  for (let i = 0; i < 200 && (view.$('#scanned').hidden || view.$('#summary').textContent !== summary); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(view.$('#summary').textContent, summary);
}

/** Waits for the page to show its status, a failed scan's message. */
async function statusIn(view: Awaited<ReturnType<typeof page>>) {
  for (let i = 0; i < 200 && !view.$('#status').classList.contains('error'); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  return view.$('#status').textContent;
}

test('serve listens on localhost:3000 by default, or on --port', async () => {
  const ports: number[] = [];
  const printed: string[] = [];
  const context = {
    open,
    print: (text: string) => printed.push(text),
    error: (text: string) => printed.push(text),
    serve: async (port: number) => (ports.push(port), `http://localhost:${port}`),
  };
  assert.equal(await run(['serve'], context), 0);
  assert.equal(await run(['serve', '--port', '8080'], context), 0);
  assert.equal(await run(['serve', '--port=8081'], context), 0);
  assert.deepEqual(ports, [3000, 8080, 8081]);
  assert.deepEqual(printed, ['Skill Atlas at http://localhost:3000', 'Skill Atlas at http://localhost:8080', 'Skill Atlas at http://localhost:8081']);

  printed.length = 0;
  assert.equal(await run(['serve', '--port', 'eighty'], context), 1);
  assert.equal(await run(['serve', 'github.com/JetBrains/example'], context), 1);
  assert.deepEqual(printed, ['Not a port: eighty\nUsage: skill-atlas serve [--port <port>]', 'Usage: skill-atlas serve [--port <port>]']);
});

test('the page: a text field for the repository at the top, the skills on the left, the SKILL.md on the right', async () => {
  const response = await fetch(`${web.url}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type')!, /^text\/html/);
  const page = await response.text();
  assert.match(page, /<header>[\s\S]*<form id="scan"[\s\S]*<input id="repo"[\s\S]*<\/header>/);
  assert.match(page, /<main id="results">\s*<nav id="skills"[\s\S]*<article id="skill"/);
  // At the top of the left pane, the filter: a field applied as it is typed, with no button of its own.
  assert.match(page, /<nav id="skills"[^>]*>\s*<input id="filter" type="search"[\s\S]*<div id="list">[\s\S]*<\/nav>/);
  assert.doesNotMatch(/<nav id="skills"[\s\S]*<\/nav>/.exec(page)![0], /<button/);
  assert.match(await (await fetch(`${web.url}/app.js`)).text(), /filter\.addEventListener\('input'/);
  for (const asset of ['/app.js', '/filter.js', '/stars.js', '/style.css']) assert.equal((await fetch(`${web.url}${asset}`)).status, 200, asset);
  assert.equal((await fetch(`${web.url}/no-such-page`)).status, 404);
});

test('the look: the logo before the name, a palette for light and dark, nothing loaded from elsewhere', async () => {
  const page = await (await fetch(`${web.url}/`)).text();
  assert.match(page, /<header>\s*<h1>\s*<svg class="logo"[^>]*aria-hidden="true"[\s\S]*<\/svg>\s*Skill Atlas\s*<\/h1>/);
  const style = await (await fetch(`${web.url}/style.css`)).text();
  assert.match(style, /color-scheme: light dark;/);
  // Every color of the palette, for light and dark: no @media for the dark one.
  for (const color of ['--accent', '--text', '--muted', '--canvas', '--pane', '--paper', '--border', '--on-accent']) {
    assert.match(style, new RegExp(`${color}: light-dark\\(#[0-9a-f]{6}, #[0-9a-f]{6}\\);`), color);
  }
  assert.match(style, /body > header \{[^}]*background: var\(--gradient\);/);
  // The skills as chips, as many on a line as fit; the selected one filled with the accent.
  assert.match(style, /#skills ul \{[^}]*display: flex; flex-wrap: wrap;/);
  assert.match(style, /#list button \{[^}]*border-radius: 999px;/);
  assert.match(style, /#list button\[aria-current="true"\] \{[^}]*background: var\(--accent\);[^}]*color: var\(--on-accent\);/);
  // The page's policy loads nothing from elsewhere: no font, no import, images only data:.
  assert.doesNotMatch(style, /@import|@font-face/);
  for (const [url] of style.matchAll(/url\(([^)]*)\)/g)) assert.match(url, /^url\("data:image\/svg\+xml,/);
});

test('the look: the SKILL.md card holds all of its content, and a failed scan\'s message its red box', async () => {
  // Laid out in a real browser by tests/visual/overflow.spec.ts; here, the rules it relies on.
  const style = await (await fetch(`${web.url}/style.css`)).text();
  // Long code spans, links and values wrap, also in the front matter's table; only a code block scrolls.
  assert.match(style, /#skill > header, #skill > \.markdown \{[^}]*overflow-wrap: anywhere;/);
  assert.match(style, /\.markdown pre \{ overflow-x: auto; \}/);
  // A SKILL.md's headings wrap as text: the page's own name, which does not, is its header's only.
  assert.match(style, /^body > header h1 \{[^}]*white-space: nowrap;/m);
  assert.doesNotMatch(style, /^h1 \{/m);
  // A narrow card: the front matter's keys wrap too, at their hyphens first, anywhere if they must.
  assert.match(style, /@container \(width < 36rem\) \{ \.front-matter th \{ white-space: normal; min-width: 8rem; \} \}/);
  assert.match(style, /#status \{[^}]*overflow-wrap: anywhere;/);
});

test('a scan: the repository, its skills sorted by name with their links and their SKILL.md as HTML, and the warnings', async () => {
  const root = pathToFileURL(FIXTURE).href;
  const { status, body } = await scanned(FIXTURE);
  assert.equal(status, 200);
  assert.equal(body.id, 'fixture');
  assert.deepEqual(
    skillsOf(body).map((skill) => [skill.name, skill.link]),
    [
      ['code-style', `${root}/.github/skills/code-style/SKILL.md`],
      ['commits', `${root}/.claude/skills/commits/SKILL.md`],
      ['release-checklist', `${root}/.agents/skills/release-checklist/SKILL.md`],
    ],
  );
  const [codeStyle, commits, releaseChecklist] = skillsOf(body);
  assert.equal(codeStyle.description, "Follow the project's code style. Use before committing Kotlin or Java changes.");
  assert.equal(
    commits.html,
    '<table class="front-matter"><tbody><tr><th>name</th><td>commits</td></tr>' +
      '<tr><th>description</th><td>Write commit messages the way this repository does. Use for every commit.</td></tr></tbody></table>\n' +
      '<h1>Commits</h1>\n<p>Start with the area, then say what changed: <code>editor: keep the caret after undo</code>.</p>\n',
  );
  // Malformed front matter: the warning, on the page and with the skill, and the body still shown.
  assert.match(releaseChecklist.html, /^<p class="warning">malformed front matter: [\s\S]*<h1>Release checklist<\/h1>/);
  assert.equal(body.warnings.length, 1);
  assert.match(body.warnings[0], /^\.agents\/skills\/release-checklist\/SKILL\.md: malformed front matter: /);
});

test('a GitHub repository: links pin the scanned commit', async () => {
  const { status, body } = await scanned('https://github.com/JetBrains/example');
  assert.equal(status, 200);
  assert.equal(body.id, 'JetBrains/example');
  assert.equal(skillsOf(body).length, 1);
  assert.equal(skillsOf(body)[0].link, `https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`);
  assert.match(skillsOf(body)[0].html, /<h1>Commits<\/h1>/);
});

test('unreachable repository → its message, for the page to show', async () => {
  assert.deepEqual(await scanned(join(FIXTURE, 'no-such-directory')), {
    status: 400,
    body: { error: `Not a GitHub URL or a readable directory: ${join(FIXTURE, 'no-such-directory')}` },
  });
  assert.deepEqual(await scanned('https://github.com/JetBrains/not-answered'), {
    status: 400,
    body: { error: 'Cannot reach GitHub: not recorded: https://api.github.com/repos/JetBrains/not-answered' },
  });
  assert.deepEqual(await scanned(' '), { status: 400, body: { error: 'Type a GitHub URL or a directory' } });
});

test('nothing in a SKILL.md runs: raw HTML is text, only web links are kept; a local file\'s links are only their text', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.claude/skills/tricky'), { recursive: true });
  writeFileSync(
    join(root, '.claude/skills/tricky/SKILL.md'),
    [
      '---',
      'name: tricky',
      'description: <b>bold</b>',
      'allowed-tools: [Read, Grep]',
      '---',
      '<script>alert(1)</script>',
      '',
      '[run](javascript:alert(1)) [docs](https://example.com/docs) [sibling](reference.md) ![logo](https://example.com/logo.png)',
    ].join('\n'),
  );
  const { body } = await scanned(root);
  assert.equal(skillsOf(body)[0].link, `${pathToFileURL(root).href}/.claude/skills/tricky/SKILL.md`);
  assert.equal(
    skillsOf(body)[0].html,
    '<table class="front-matter"><tbody><tr><th>name</th><td>tricky</td></tr>' +
      '<tr><th>description</th><td>&#60;b&#62;bold&#60;/b&#62;</td></tr>' +
      '<tr><th>allowed-tools</th><td>- Read\n- Grep</td></tr></tbody></table>\n' +
      '&#60;script&#62;alert(1)&#60;/script&#62;' +
      '<p>run ' +
      '<a href="https://example.com/docs" target="_blank" rel="noopener noreferrer">docs</a> ' +
      // A page on http://localhost cannot open file: links.
      'sibling ' +
      '<img src="https://example.com/logo.png" alt="logo"></p>\n',
  );
  const policy = (await fetch(`${web.url}/`)).headers.get('content-security-policy')!;
  assert.match(policy, /script-src 'self'/);
});

test('links in a GitHub repository: relative ones against the file, /… against the repository; images over https only', () => {
  const root = `https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/`;
  const place = { link: `${root}.claude/skills/commits/SKILL.md`, root };
  const html = renderSkill(
    '---\nname: commits\n---\n' +
      '[sibling](reference.md) [docs](/docs/guide.md) [other](//example.com/x) ' +
      '![diagram](diagram.png) ![logo](/logo.png) ![plain](http://example.com/plain.png)',
    place,
  );
  const link = (href: string, text: string) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  assert.equal(
    html,
    '<table class="front-matter"><tbody><tr><th>name</th><td>commits</td></tr></tbody></table>\n<p>' +
      `${link(`${root}.claude/skills/commits/reference.md`, 'sibling')} ` +
      `${link(`${root}docs/guide.md`, 'docs')} ` +
      `${link('https://example.com/x', 'other')} ` +
      `<img src="${root}.claude/skills/commits/diagram.png?raw=true" alt="diagram"> ` +
      `<img src="${root}logo.png?raw=true" alt="logo"> ` +
      // The page's policy loads https: images only: an http: one is its text, not a broken image.
      'plain</p>\n',
  );
});

test('the description is Markdown, in the list of skills and in the front matter table', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.claude/skills/styled'), { recursive: true });
  writeFileSync(
    join(root, '.claude/skills/styled/SKILL.md'),
    [
      '---',
      'name: styled',
      "description: Run `npm.test` with **care**, see [the docs](https://example.com/docs). Then <i>stop</i>.",
      '---',
    ].join('\n'),
  );
  const { body } = await scanned(root);
  const [skill] = skillsOf(body);
  // The first sentence only, not cut at the `.` in the code span; the link is only its text, in a button.
  assert.equal(skill.summary, 'Run <code>npm.test</code> with <strong>care</strong>, see the docs.');
  assert.equal(
    skill.html,
    '<table class="front-matter"><tbody><tr><th>name</th><td>styled</td></tr>' +
      '<tr><th>description</th><td>Run <code>npm.test</code> with <strong>care</strong>, see ' +
      '<a href="https://example.com/docs" target="_blank" rel="noopener noreferrer">the docs</a>. ' +
      'Then &#60;i&#62;stop&#60;/i&#62;.</td></tr></tbody></table>\n',
  );
});

test('the filter: the skills whose name contains the typed text, ignoring case; every one when empty; a message for none', async () => {
  const names = skillsOf((await scanned(FIXTURE)).body).map((skill) => skill.name);
  const shown = (typed: string) => names.filter((name) => matches(name, typed));
  assert.deepEqual(shown(''), ['code-style', 'commits', 'release-checklist']);
  assert.deepEqual(shown('   '), ['code-style', 'commits', 'release-checklist']);
  assert.deepEqual(shown('co'), ['code-style', 'commits']);
  assert.deepEqual(shown('COM'), ['commits']);
  assert.deepEqual(shown(' list '), ['release-checklist']);
  // The name only: "Kotlin" is in code-style's description, not its name.
  assert.deepEqual(shown('kotlin'), []);
  assert.equal(noMatch(names, ''), null);
  assert.equal(noMatch(names, 'co'), null);
  assert.equal(noMatch(names, ' kotlin '), 'No skills found');
  // No skill at all: the same message, whatever the filter.
  assert.equal(noMatch([], ''), 'No skills found');
  assert.equal(noMatch([], 'x'), 'No skills found');
});

test('the page: the skills by group, each group\'s name and count, then its skills as chips, only their names', async (t) => {
  const view = await page(t, `?repo=${encodeURIComponent(FIXTURE)}`);
  await scannedIn(view, 'fixture');
  assert.deepEqual(view.groups(), ['Code Quality · 1 skill', 'Commits & Releases · 2 skills']);
  assert.deepEqual(view.listed(), ['code-style', 'commits', 'release-checklist']);
  const chip = view.$('#list button[data-id="fixture:.claude/skills/commits/SKILL.md"]');
  // The name only; the first sentence of the description on hover, as text.
  assert.equal(chip.innerHTML, 'commits');
  assert.equal(chip.title, 'Write commit messages the way this repository does.');
  assert.equal(view.$('#list button[data-id="fixture:.agents/skills/release-checklist/SKILL.md"]').hasAttribute('title'), false);
  chip.click();
  assert.equal(chip.getAttribute('aria-current'), 'true');
  assert.equal(view.$('#skill h2').textContent, 'commits');
});

test('the page: a description\'s Markdown on hover is its text, and nothing of its HTML runs', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.claude/skills/styled'), { recursive: true });
  writeFileSync(join(root, '.claude/skills/styled/SKILL.md'), '---\nname: styled\ndescription: Run `npm.test` with **care**, <img src=x onerror=alert(1)>. Then stop.\n---\n');
  const view = await page(t, `?repo=${encodeURIComponent(root)}`);
  const name = root.split('/').at(-1)!;
  await scannedIn(view, name, `${name} · 1 skill`);
  // Claude is not asked here: by repository, and a warning.
  assert.deepEqual(view.groups(), [`${name} · 1 skill`]);
  assert.equal(view.$('#list button').title, 'Run npm.test with care, <img src=x onerror=alert(1)>.');
  assert.equal(view.$('#list img'), null);
});

test('the page: the selected skill stays on the right when the filter leaves it out of the list', async (t) => {
  const view = await page(t, `?repo=${encodeURIComponent(FIXTURE)}&skill=${encodeURIComponent('fixture:.claude/skills/commits/SKILL.md')}`);
  await scannedIn(view, 'fixture');
  assert.equal(view.$('#skill h2').textContent, 'commits');
  view.type('style');
  assert.deepEqual(view.listed(), ['code-style']);
  assert.equal(view.$('#skill h2').textContent, 'commits');
  assert.equal(view.$('#no-match').hidden, true);
  // The summary stays the scan's; the group's count is what the filter found.
  assert.equal(view.$('#summary').textContent, 'fixture · 3 skills');
  assert.deepEqual(view.groups(), ['Code Quality · 1 skill']);
  view.type('kotlin');
  assert.deepEqual(view.listed(), []);
  assert.deepEqual(view.groups(), []);
  assert.equal(view.$('#no-match').hidden, false);
  assert.equal(view.$('#no-match').textContent, 'No skills found');
  assert.equal(view.$('#skill h2').textContent, 'commits');
});

test('the page: &filter=… in the address, kept as it is typed and applied again on a reload', async (t) => {
  const repo = `?repo=${encodeURIComponent(FIXTURE)}`;
  const first = await page(t, repo);
  await scannedIn(first, 'fixture');
  first.type('COM');
  assert.equal(new URL(first.location.href).searchParams.get('filter'), 'COM');
  const reloaded = await page(t, first.location.search);
  await scannedIn(reloaded, 'fixture');
  assert.equal(reloaded.$<HTMLInputElement>('#filter').value, 'COM');
  assert.deepEqual(reloaded.listed(), ['commits']);
  // Only spaces: every skill, and nothing in the address.
  reloaded.type('  ');
  assert.equal(reloaded.listed().length, 3);
  assert.equal(new URL(reloaded.location.href).searchParams.has('filter'), false);
});

test('the page leaves nothing behind: after a test with two pages, fetch is the real one again', () => {
  assert.equal(globalThis.fetch, realFetch);
});

test('the page: a new scan empties the filter', async (t) => {
  const view = await page(t, `?repo=${encodeURIComponent(FIXTURE)}&filter=com`);
  await scannedIn(view, 'fixture');
  assert.deepEqual(view.listed(), ['commits']);
  view.$<HTMLInputElement>('#repo').value = FIXTURE;
  view.$<HTMLFormElement>('#scan').requestSubmit();
  // The same repository: wait for the filter to be emptied by its answer.
  for (let i = 0; i < 200 && view.listed().length !== 3; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(view.$<HTMLInputElement>('#filter').value, '');
  assert.equal(view.listed().length, 3);
  assert.equal(new URL(view.location.href).searchParams.has('filter'), false);
});

test('an organization: every repository with skills, sorted, each skill after its repository', async () => {
  const { status, body } = await scanned('https://github.com/JetBrains');
  assert.equal(status, 200);
  assert.equal(body.id, 'JetBrains');
  assert.deepEqual(body.organization, {
    id: 'JetBrains',
    url: 'https://github.com/JetBrains',
    avatar: AVATAR,
    homepage: 'https://www.jetbrains.com/',
  });
  // JetBrains/docs has no skill: not in the answer.
  assert.deepEqual(
    body.repositories.map(({ repository, skills }) => [repository.id, skills.map((skill) => [skill.repository, skill.name])]),
    [
      ['JetBrains/example', [['JetBrains/example', 'commits']]],
      ['JetBrains/forked', [['JetBrains/forked', 'lint']]],
      ['JetBrains/tools', [['JetBrains/tools', 'release'], ['JetBrains/tools', 'triage']]],
    ],
  );
  assert.equal(skillsOf(body)[2].link, `https://github.com/JetBrains/tools/blob/${EXAMPLE_COMMIT}/.agents/skills/release/SKILL.md`);
  assert.deepEqual(body.warnings, ['JetBrains/tools: .github/skills/triage/SKILL.md: no front matter; using the directory name']);
});

test('the skill map: the skills grouped by affinity, by Claude, each group named, sorted by name, its skills by name', async () => {
  const { body } = await scanned(FIXTURE);
  assert.deepEqual(body.groups, [
    { name: 'Code Quality', skills: ['fixture:.github/skills/code-style/SKILL.md'] },
    { name: 'Commits & Releases', skills: ['fixture:.claude/skills/commits/SKILL.md', 'fixture:.agents/skills/release-checklist/SKILL.md'] },
  ]);
  // An organization's groups go across its repositories.
  const organization = (await scanned('github.com/JetBrains')).body;
  assert.deepEqual(organization.groups, [
    { name: 'Code Quality', skills: ['JetBrains/forked:.cursor/skills/lint/SKILL.md'] },
    { name: 'Commits & Releases', skills: ['JetBrains/example:.claude/skills/commits/SKILL.md', 'JetBrains/tools:.agents/skills/release/SKILL.md'] },
    { name: 'Issue Tracking', skills: ['JetBrains/tools:.github/skills/triage/SKILL.md'] },
  ]);
  assert.deepEqual(organization.warnings, ['JetBrains/tools: .github/skills/triage/SKILL.md: no front matter; using the directory name']);
  // No skill, nothing to group.
  assert.deepEqual((await scanned('github.com/empty')).body.groups, []);
});

test('the skill map: Claude cannot group the skills → by repository, and a warning', async (t) => {
  const server = await startWeb({ open, model: async () => Promise.reject(new Error('claude is not installed')), port: 0 });
  t.after(() => server.close());
  const answer = async (repo: string) => (await (await realFetch(`${server.url}/api/scan?repo=${encodeURIComponent(repo)}`)).json()) as ScanAnswer;
  const organization = await answer('github.com/JetBrains');
  assert.deepEqual(
    organization.groups.map((group) => [group.name, group.skills.length]),
    [
      ['JetBrains/example', 1],
      ['JetBrains/forked', 1],
      ['JetBrains/tools', 2],
    ],
  );
  assert.equal(organization.warnings.at(-1), 'Skills grouped by repository, not by affinity: claude is not installed');
  const repository = await answer('github.com/JetBrains/example');
  assert.deepEqual(repository.groups, [{ name: 'JetBrains/example', skills: ['JetBrains/example:.claude/skills/commits/SKILL.md'] }]);
  assert.deepEqual(repository.warnings, ['Skills grouped by repository, not by affinity: claude is not installed']);
});

test('the page: an organization\'s skills by group, across its repositories, each with how many the filter found; one with none is left out', async (t) => {
  const tools = 'JetBrains/tools:.agents/skills/release/SKILL.md';
  const view = await page(t, `?repo=${encodeURIComponent('github.com/JetBrains')}&skill=${encodeURIComponent(tools)}`);
  await scannedIn(view, 'JetBrains', 'JetBrains · 4 skills in 3 repositories');
  assert.deepEqual(view.groups(), ['Code Quality · 1 skill', 'Commits & Releases · 2 skills', 'Issue Tracking · 1 skill']);
  assert.deepEqual(view.listed(), ['lint', 'commits', 'release', 'triage']);
  // On hover, the chip's repository and the first sentence of its description.
  assert.equal(view.$(`#list button[data-id="${tools}"]`).title, 'JetBrains/tools: Cut a release.');
  assert.equal(view.$('#list button[data-id="JetBrains/tools:.github/skills/triage/SKILL.md"]').title, 'JetBrains/tools');
  // The selected skill, from the address: its path says which repository it is in.
  assert.equal(view.$('#skill h2').textContent, 'release');
  assert.equal(view.$('#skill .path').textContent, 'JetBrains/tools/.agents/skills/release/SKILL.md');
  view.type('LINT');
  assert.deepEqual(view.groups(), ['Code Quality · 1 skill']);
  assert.deepEqual(view.listed(), ['lint']);
  view.type('i');
  assert.deepEqual(view.groups(), ['Code Quality · 1 skill', 'Commits & Releases · 1 skill', 'Issue Tracking · 1 skill']);
  assert.equal(view.$('#no-match').hidden, true);
  view.type('nothing like it');
  assert.deepEqual(view.groups(), []);
  assert.equal(view.$('#no-match').textContent, 'No skills found');
  assert.equal(view.shown('#no-match'), true);
  // The summary stays the scan's.
  assert.equal(view.$('#summary').textContent, 'JetBrains · 4 skills in 3 repositories');
  assert.equal(view.$('#skill h2').textContent, 'release');
});

test('the page: the filter is at the top of the left pane, before a scan, after one and after a failed one', async (t) => {
  const before = await page(t, '');
  assert.equal(before.$('#skills').firstElementChild, before.$('#filter'));
  assert.equal(before.shown('#filter'), true);
  assert.equal(before.shown('#summary'), false);

  const failed = await page(t, `?repo=${encodeURIComponent(join(FIXTURE, 'no-such-directory'))}`);
  assert.match(await statusIn(failed), /^Not a GitHub URL or a readable directory: /);
  // The message, in place of the skills; the filter still there.
  assert.equal(failed.shown('#status'), true);
  assert.equal(failed.shown('#summary'), false);
  assert.equal(failed.shown('#filter'), true);
});

test('the page: no skills at all, in a repository or an organization → No skills found, whatever the filter', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'README.md'), '# Nothing here\n');
  const view = await page(t, `?repo=${encodeURIComponent(root)}`);
  const name = root.split('/').at(-1)!;
  await scannedIn(view, name, `${name} · 0 skills`);
  assert.deepEqual(view.groups(), []);
  assert.equal(view.shown('#filter'), true);
  assert.equal(view.shown('#no-match'), true);
  assert.equal(view.$('#no-match').textContent, 'No skills found');
  view.type('x');
  assert.equal(view.$('#no-match').textContent, 'No skills found');
  const empty = await page(t, `?repo=${encodeURIComponent('github.com/empty')}`);
  await scannedIn(empty, 'empty', 'empty · 0 skills');
  assert.deepEqual(empty.groups(), []);
  assert.equal(empty.$('#no-match').textContent, 'No skills found');
  assert.equal(empty.shown('#no-match'), true);
});

test('stars: as they are under 1000; else in thousands or millions, rounded to one decimal, without a .0', () => {
  assert.deepEqual(
    [0, 1, 999, 1000, 1049, 1050, 12_345, 56_234, 56_250, 999_949, 999_950, 1_250_000, 12_340_000].map(stars),
    ['0', '1', '999', '1k', '1k', '1.1k', '12.3k', '56.2k', '56.3k', '999.9k', '1m', '1.3m', '12.3m'],
  );
});

test('a GitHub repository: its stars and its owner, with the avatar and homepage of its profile; none for a directory', async () => {
  const { body } = await scanned('https://github.com/JetBrains/example');
  assert.equal(body.repositories[0].repository.stars, 56234);
  assert.deepEqual(body.owner, { id: 'JetBrains', url: 'https://github.com/JetBrains', avatar: AVATAR, homepage: 'https://www.jetbrains.com/' });
  assert.deepEqual(body.warnings, []);
  const organization = (await scanned('github.com/JetBrains')).body;
  assert.deepEqual(organization.owner, organization.organization);
  assert.deepEqual(
    organization.repositories.map(({ repository }) => [repository.id, repository.stars]),
    [
      ['JetBrains/example', 56234],
      ['JetBrains/forked', 1250000],
      ['JetBrains/tools', 999],
    ],
  );
  const local = (await scanned(FIXTURE)).body;
  assert.equal(local.owner, undefined);
  assert.equal(local.repositories[0].repository.stars, undefined);
});

test('the owner\'s profile unanswered: the scan still shows, with the owner\'s login only and a warning', async (t) => {
  const github = replay({
    'https://api.github.com/repos/acme/api': { status: 200, body: { full_name: 'acme/api', default_branch: 'main', stargazers_count: 3 } },
    'https://api.github.com/repos/acme/api/commits/main': { status: 200, body: { sha: EXAMPLE_COMMIT } },
    [`https://api.github.com/repos/acme/api/git/trees/${EXAMPLE_COMMIT}?recursive=1`]: { status: 200, body: { truncated: false, tree: [] } },
  });
  const server = await startWeb({ open: (input) => openGitHub(input, { fetch: github }), model, port: 0 });
  t.after(() => server.close());
  const body = (await (await realFetch(`${server.url}/api/scan?repo=${encodeURIComponent('github.com/acme/api')}`)).json()) as ScanAnswer;
  assert.deepEqual(body.owner, { id: 'acme', url: 'https://github.com/acme' });
  assert.deepEqual(body.warnings, ['acme: no avatar or homepage: Cannot reach GitHub: not recorded: https://api.github.com/users/acme']);
  assert.equal(body.repositories[0].repository.stars, 3);
});

test('the page: the owner above the skills, its avatar, login and homepage; the selected skill\'s repository\'s stars after its path', async (t) => {
  const commits = 'JetBrains/example:.claude/skills/commits/SKILL.md';
  const view = await page(t, `?repo=${encodeURIComponent('github.com/JetBrains/example')}&skill=${encodeURIComponent(commits)}`);
  await scannedIn(view, 'JetBrains/example', 'JetBrains/example · 1 skill');
  assert.equal(view.shown('#owner'), true);
  assert.equal(view.$('#owner').nextElementSibling, view.$('#summary'));
  assert.equal(view.$<HTMLImageElement>('#owner img').src, AVATAR);
  assert.equal(view.$<HTMLAnchorElement>('#owner .login').href, 'https://github.com/JetBrains');
  assert.equal(view.$('#owner .login').textContent, 'JetBrains');
  assert.equal(view.$<HTMLAnchorElement>('#owner .homepage').href, 'https://www.jetbrains.com/');
  assert.equal(view.$('#owner .homepage').textContent, 'www.jetbrains.com');
  assert.equal(view.$('#skill .path').nextElementSibling, view.$('#skill .stars'));
  assert.equal(view.$('#skill .stars').textContent, '★ 56.2k');
  assert.equal(view.$('#skill .stars').title, '56,234 stars');
  // Not in the list: only the names there.
  assert.equal(view.$('#list .stars'), null);

  const organization = await page(t, `?repo=${encodeURIComponent('github.com/JetBrains')}`);
  await scannedIn(organization, 'JetBrains', 'JetBrains · 4 skills in 3 repositories');
  assert.equal(organization.$('#owner .login').textContent, 'JetBrains');
  const starsOf = (id: string) => {
    organization.$<HTMLButtonElement>(`#list button[data-id="${id}"]`).click();
    return [organization.$('#skill .path').textContent, organization.$('#skill .stars').textContent];
  };
  assert.deepEqual(
    ['JetBrains/example:.claude/skills/commits/SKILL.md', 'JetBrains/forked:.cursor/skills/lint/SKILL.md', 'JetBrains/tools:.agents/skills/release/SKILL.md'].map(starsOf),
    [
      ['JetBrains/example/.claude/skills/commits/SKILL.md', '★ 56.2k'],
      ['JetBrains/forked/.cursor/skills/lint/SKILL.md', '★ 1.3m'],
      ['JetBrains/tools/.agents/skills/release/SKILL.md', '★ 999'],
    ],
  );
});

test('the page: an owner whose profile lists no avatar or homepage → its login only; a directory → no owner, no stars', async (t) => {
  const empty = await page(t, `?repo=${encodeURIComponent('github.com/empty')}`);
  await scannedIn(empty, 'empty', 'empty · 0 skills');
  assert.equal(empty.shown('#owner'), true);
  assert.equal(empty.$('#owner .login').textContent, 'empty');
  assert.equal(empty.shown('#owner img'), false);
  assert.equal(empty.shown('#owner .homepage'), false);

  const local = await page(t, `?repo=${encodeURIComponent(FIXTURE)}&skill=${encodeURIComponent('fixture:.claude/skills/commits/SKILL.md')}`);
  await scannedIn(local, 'fixture');
  assert.equal(local.shown('#owner'), false);
  assert.equal(local.$('#skill h2').textContent, 'commits');
  assert.equal(local.$('#skill .stars'), null);
});

test('only this machine is served: another host name is refused', async () => {
  const status = await new Promise<number>((resolve, reject) => {
    const url = new URL(web.url);
    request({ host: url.hostname, port: url.port, path: '/api/scan?repo=.', headers: { Host: 'attacker.example' } }, (response) => {
      response.resume();
      resolve(response.statusCode!);
    })
      .on('error', reject)
      .end();
  });
  assert.equal(status, 403);
});

test('the real CLI serves the web view until it is stopped; a port in use → a clear message, exit code 1', async (t) => {
  // Claude as recorded: the real one is never asked.
  const env = { ...process.env, SKILL_ATLAS_CLAUDE: FAKE_CLAUDE };
  const server = spawn(process.execPath, [CLI, 'serve', '--port', '0'], { stdio: ['ignore', 'pipe', 'inherit'], env });
  t.after(() => server.kill());
  const [line] = (await once(server.stdout, 'data')) as [Buffer];
  const address = /^Skill Atlas at (http:\/\/localhost:\d+)\n$/.exec(line.toString())?.[1];
  assert.ok(address, line.toString());
  assert.equal((await fetch(`${address}/`)).status, 200);
  const body = (await (await fetch(`${address}/api/scan?repo=${encodeURIComponent(FIXTURE)}`)).json()) as ScanAnswer;
  assert.equal(skillsOf(body).length, 3);
  // Grouped by `claude -p`, the one SKILL_ATLAS_CLAUDE names.
  assert.deepEqual(
    body.groups.map((group) => group.name),
    ['Code Quality', 'Commits & Releases'],
  );

  const port = new URL(address).port;
  const taken = spawnSync(process.execPath, [CLI, 'serve', '--port', port], { encoding: 'utf8' });
  assert.equal(taken.status, 1);
  assert.equal(taken.stderr, `Port ${port} is in use; pick another with --port\n`);
});
