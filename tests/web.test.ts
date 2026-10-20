// The decisions in spec/web.md, checked on what the web view serves: for ./fixture, for the small
// GitHub repository answered in tests/helpers.ts, and for temporary directories.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { run } from '../src/commands.ts';
import { renderSkill } from '../src/render.ts';
import { startWeb, type ScanAnswer } from '../src/web.ts';
import { matches, noMatch } from '../src/web/filter.js';
import { CLI, EXAMPLE_COMMIT, FIXTURE, open } from './helpers.ts';

const web = await startWeb({ open, port: 0 });
test.after(() => web.close());

/** What the page fetches for the repository typed at the top. */
async function scanned(repo: string) {
  const response = await fetch(`${web.url}/api/scan?repo=${encodeURIComponent(repo)}`);
  return { status: response.status, body: (await response.json()) as ScanAnswer };
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
  assert.match(page, /<main id="results" hidden>\s*<nav id="skills"[\s\S]*<article id="skill"/);
  // Above the skills, the filter: a field applied as it is typed, with no button of its own.
  assert.match(page, /<nav id="skills"[\s\S]*<input id="filter" type="search"[\s\S]*<ul id="list">[\s\S]*<\/nav>/);
  assert.doesNotMatch(/<nav id="skills"[\s\S]*<\/nav>/.exec(page)![0], /<button/);
  assert.match(await (await fetch(`${web.url}/app.js`)).text(), /filter\.addEventListener\('input'/);
  for (const asset of ['/app.js', '/style.css']) assert.equal((await fetch(`${web.url}${asset}`)).status, 200, asset);
  assert.equal((await fetch(`${web.url}/no-such-page`)).status, 404);
});

test('a scan: the repository, its skills sorted by name with their links and their SKILL.md as HTML, and the warnings', async () => {
  const root = pathToFileURL(FIXTURE).href;
  const { status, body } = await scanned(FIXTURE);
  assert.equal(status, 200);
  assert.equal(body.repository.id, 'fixture');
  assert.deepEqual(
    body.skills.map((skill) => [skill.name, skill.link]),
    [
      ['code-style', `${root}/.github/skills/code-style/SKILL.md`],
      ['commits', `${root}/.claude/skills/commits/SKILL.md`],
      ['release-checklist', `${root}/.agents/skills/release-checklist/SKILL.md`],
    ],
  );
  const [codeStyle, commits, releaseChecklist] = body.skills;
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
  assert.equal(body.repository.id, 'JetBrains/example');
  assert.equal(body.skills.length, 1);
  assert.equal(body.skills[0].link, `https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`);
  assert.match(body.skills[0].html, /<h1>Commits<\/h1>/);
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
  assert.equal(body.skills[0].link, `${pathToFileURL(root).href}/.claude/skills/tricky/SKILL.md`);
  assert.equal(
    body.skills[0].html,
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
  const [skill] = body.skills;
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
  assert.equal((await fetch(`${web.url}/filter.js`)).status, 200);
  const names = (await scanned(FIXTURE)).body.skills.map((skill) => skill.name);
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
  assert.equal(noMatch(names, ' kotlin '), 'No skill matches "kotlin".');
  assert.equal(noMatch([], 'x'), 'No skill matches "x".');
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
  const server = spawn(process.execPath, [CLI, 'serve', '--port', '0'], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => server.kill());
  const [line] = (await once(server.stdout, 'data')) as [Buffer];
  const address = /^Skill Atlas at (http:\/\/localhost:\d+)\n$/.exec(line.toString())?.[1];
  assert.ok(address, line.toString());
  assert.equal((await fetch(`${address}/`)).status, 200);
  const body = (await (await fetch(`${address}/api/scan?repo=${encodeURIComponent(FIXTURE)}`)).json()) as ScanAnswer;
  assert.equal(body.skills.length, 3);

  const port = new URL(address).port;
  const taken = spawnSync(process.execPath, [CLI, 'serve', '--port', port], { encoding: 'utf8' });
  assert.equal(taken.status, 1);
  assert.equal(taken.stderr, `Port ${port} is in use; pick another with --port\n`);
});
