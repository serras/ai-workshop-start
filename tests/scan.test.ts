// The decisions in spec/analysis.md and spec/cli.md, checked on what the real command prints for
// ./fixture, for a small GitHub repository answered in tests/helpers.ts, and for temporary
// directories with the edge cases of where skills live.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { openGitHub, parseGitHubOrganization, parseGitHubUrl } from '../src/core/github.ts';
import { parseSkill } from '../src/core/parse.ts';
import { replay } from '../src/core/replay.ts';
import { atlas, CLI, EXAMPLE_COMMIT, FIXTURE } from './helpers.ts';

const fixture = await atlas(['scan', FIXTURE]);
const example = await atlas(['scan', 'github.com/JetBrains/example']);

test('malformed front matter → the directory name, no description and a warning', () => {
  const parsed = parseSkill(readFileSync(join(FIXTURE, '.agents/skills/release-checklist/SKILL.md'), 'utf8'));
  assert.equal(parsed.name, undefined);
  assert.equal(parsed.description, '');
  assert.equal(
    parsed.warning,
    'malformed front matter: Nested mappings are not allowed in compact mappings at line 3, column 14; using the directory name',
  );
});

test('scan prints the repository, then each skill with its first sentence and pinned link', () => {
  assert.equal(example.code, 0, example.stderr);
  assert.equal(
    example.stdout,
    [
      'JetBrains/example · 1 skill',
      'commits — Write commit messages the way this repository does.',
      `  https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`,
    ].join('\n'),
  );
});

test('a /tree/<commit> URL scans that commit, through its tree even with a token', async () => {
  const pinned = '0123456789abcdef0123456789abcdef01234567';
  const github = replay({
    'https://api.github.com/repos/JetBrains/example': { status: 200, body: { full_name: 'JetBrains/example', default_branch: 'main' } },
    [`https://api.github.com/repos/JetBrains/example/commits/${pinned}`]: { status: 200, body: { sha: pinned } },
    [`https://api.github.com/repos/JetBrains/example/git/trees/${pinned}?recursive=1`]: {
      status: 200,
      body: { truncated: false, tree: [{ path: '.claude/skills/commits/SKILL.md', mode: '100644', type: 'blob', sha: 'a' }] },
    },
    [`https://raw.githubusercontent.com/JetBrains/example/${pinned}/.claude/skills/commits/SKILL.md`]: {
      status: 200,
      body: '---\nname: commits\ndescription: Pinned.\n---\n',
    },
  });
  const source = await openGitHub(`https://github.com/JetBrains/example/tree/${pinned}/`, { fetch: github, token: 'test' });
  assert.equal(source.repository.commit, pinned);
  assert.deepEqual(source.paths, ['.claude/skills/commits/SKILL.md']);

  const missing = replay({
    'https://api.github.com/repos/JetBrains/example': { status: 200, body: { full_name: 'JetBrains/example', default_branch: 'main' } },
    'https://api.github.com/repos/JetBrains/example/commits/no-such-ref': { status: 404, body: { message: 'Not Found' } },
  });
  await assert.rejects(openGitHub('github.com/JetBrains/example/tree/no-such-ref', { fetch: missing }), {
    message: 'No branch, tag or commit no-such-ref in https://github.com/JetBrains/example',
  });
});

test('URLs copied from the browser: a query or a fragment is ignored; /tree/<ref>/<folder> is the ref', () => {
  const kotlin = { owner: 'JetBrains', repo: 'kotlin' };
  for (const input of [
    'https://github.com/JetBrains/kotlin?tab=readme-ov-file',
    'https://github.com/JetBrains/kotlin#readme',
    'https://github.com/JetBrains/kotlin/?tab=readme-ov-file#readme',
    'github.com/JetBrains/kotlin.git#readme',
  ]) {
    assert.deepEqual(parseGitHubUrl(input), kotlin, input);
  }
  assert.deepEqual(parseGitHubUrl('https://github.com/JetBrains/kotlin/tree/master/.claude/skills'), { ...kotlin, tree: 'master/.claude/skills' });
  assert.deepEqual(parseGitHubUrl('https://github.com/JetBrains/kotlin/tree/master/?tab=x#y'), { ...kotlin, tree: 'master' });
  assert.equal(parseGitHubOrganization('https://github.com/JetBrains?tab=repositories'), 'JetBrains');
  assert.equal(parseGitHubOrganization('https://github.com/JetBrains#top'), 'JetBrains');
});

test('the README tab and its anchor scan the repository, as without them', async () => {
  for (const url of ['https://github.com/JetBrains/example?tab=readme-ov-file', 'https://github.com/JetBrains/example#readme']) {
    const copied = await atlas(['scan', url]);
    assert.deepEqual(copied, example, url);
  }
});

test('/tree/<ref>/<folder>: the whole repository at the ref; a ref may have slashes; an unknown one → a clear message', async () => {
  const pinned = '0123456789abcdef0123456789abcdef01234567';
  const noCommit = (sha: string) => ({ status: 422, body: { message: `No commit found for SHA: ${sha}` } });
  const commits = 'https://api.github.com/repos/JetBrains/example/commits';
  const refs = 'https://api.github.com/repos/JetBrains/example/git/matching-refs';
  const github = replay({
    'https://api.github.com/repos/JetBrains/example': { status: 200, body: { full_name: 'JetBrains/example', default_branch: 'main' } },
    [`${commits}/master`]: { status: 200, body: { sha: pinned } },
    // A branch with a slash: its first segment is not a ref.
    [`${commits}/feature`]: { status: 404, body: { message: 'Not Found' } },
    [`${refs}/heads/feature/`]: { status: 200, body: [{ ref: 'refs/heads/feature/login' }] },
    [`${refs}/tags/feature/`]: { status: 200, body: [] },
    [`${commits}/feature/login`]: { status: 200, body: { sha: pinned } },
    // However long the path, an unknown ref costs three requests.
    [`${commits}/nope`]: noCommit('nope'),
    [`${refs}/heads/nope/`]: { status: 200, body: [] },
    [`${refs}/tags/nope/`]: { status: 200, body: [] },
    [`https://api.github.com/repos/JetBrains/example/git/trees/${pinned}?recursive=1`]: {
      status: 200,
      body: {
        truncated: false,
        tree: [
          { path: '.claude/skills/commits/SKILL.md', mode: '100644', type: 'blob', sha: 'a' },
          { path: '.agents/skills/release/SKILL.md', mode: '100644', type: 'blob', sha: 'b' },
        ],
      },
    },
  });
  for (const url of [
    'https://github.com/JetBrains/example/tree/master/.claude/skills',
    'https://github.com/JetBrains/example/tree/feature/login/.claude/skills/',
  ]) {
    const source = await openGitHub(url, { fetch: github, token: 'test' });
    assert.equal(source.repository.commit, pinned, url);
    // Not only the folder: every skill of the repository.
    assert.deepEqual(source.paths, ['.claude/skills/commits/SKILL.md', '.agents/skills/release/SKILL.md'], url);
  }
  await assert.rejects(openGitHub('https://github.com/JetBrains/example/tree/nope/.claude/skills', { fetch: github }), {
    message: 'No branch, tag or commit nope/.claude/skills in https://github.com/JetBrains/example',
  });
  await assert.rejects(openGitHub('https://github.com/JetBrains/example/tree/nope/a/b/c/d/e', { fetch: github }), {
    message: 'No branch, tag or commit nope/a/b/c/d/e in https://github.com/JetBrains/example',
  });
});

test('/tree/<ref> of an empty repository → says it is empty, as without /tree/<ref>', async () => {
  const empty = { status: 409, body: { message: 'Git Repository is empty.' } };
  const github = replay({
    'https://api.github.com/repos/acme/blank': { status: 200, body: { full_name: 'acme/blank', default_branch: 'main' } },
    'https://api.github.com/repos/acme/blank/commits/main': empty,
  });
  for (const url of ['https://github.com/acme/blank', 'https://github.com/acme/blank/tree/main', 'https://github.com/acme/blank/tree/main/.claude']) {
    await assert.rejects(openGitHub(url, { fetch: github }), { message: 'The repository is empty: https://github.com/acme/blank' }, url);
  }
});

test('another page on GitHub → says it is neither a repository nor an organization, exit code 1', async () => {
  for (const url of ['https://github.com/JetBrains/kotlin/pulls', 'https://github.com/JetBrains/kotlin/blob/master/README.md', 'https://github.com/']) {
    const result = await atlas(['scan', url]);
    assert.equal(result.code, 1, url);
    assert.equal(
      result.stderr,
      `Neither a repository nor an organization on GitHub: ${url}; scan github.com/<owner>, github.com/<owner>/<repo> or github.com/<owner>/<repo>/tree/<ref>`,
    );
  }
});

test('./fixture: every skill, sorted by name, linked to its file, with a warning for the malformed one', () => {
  const root = pathToFileURL(FIXTURE).href;
  assert.equal(fixture.code, 0);
  assert.equal(
    fixture.stdout,
    [
      'fixture · 3 skills',
      "code-style — Follow the project's code style.",
      `  ${root}/.github/skills/code-style/SKILL.md`,
      'commits — Write commit messages the way this repository does.',
      `  ${root}/.claude/skills/commits/SKILL.md`,
      'release-checklist',
      `  ${root}/.agents/skills/release-checklist/SKILL.md`,
    ].join('\n'),
  );
  assert.match(fixture.stderr, /^warning: \.agents\/skills\/release-checklist\/SKILL\.md: malformed front matter: /);
});

test('the CLI prints the result at once and stores nothing', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const scanned = spawnSync(process.execPath, [CLI, 'scan', FIXTURE], { cwd, encoding: 'utf8' });
  assert.equal(scanned.status, 0, scanned.stderr);
  assert.equal(scanned.stdout, `${fixture.stdout}\n`);
  assert.deepEqual(readdirSync(cwd), []);
});

test('a directory written with ~: in the home directory, even when the shell left it as typed; ~<user> is not expanded', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'skill-atlas-home-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, 'projects/nasty/.claude/skills/commits'), { recursive: true });
  writeFileSync(join(home, 'projects/nasty/.claude/skills/commits/SKILL.md'), '---\nname: commits\ndescription: Writes commits.\n---\n');
  const scan = (input: string) => {
    const { status, stdout, stderr } = spawnSync(process.execPath, [CLI, 'scan', input], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
    return { status, stdout, stderr };
  };
  const spelledOut = scan(join(home, 'projects/nasty'));
  assert.equal(spelledOut.status, 0, spelledOut.stderr);
  assert.match(spelledOut.stdout, /^nasty · 1 skills?\ncommits — Writes commits\./);
  assert.deepEqual(scan('~/projects/nasty'), spelledOut);
  assert.match(scan('~').stdout, /^skill-atlas-home-\w+ · 1 skills?\n/);

  const other = scan('~nobody/projects/nasty');
  assert.equal(other.status, 1);
  assert.equal(other.stderr, 'Not a GitHub URL or a readable directory: ~nobody/projects/nasty\n');
});

test('unreachable repository → a clear message, exit code 1', async () => {
  const missing = spawnSync(process.execPath, [CLI, 'scan', join(FIXTURE, 'no-such-directory')], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^Not a GitHub URL or a readable directory: .*no-such-directory\n$/);

  // What GitHub answers for a repository that does not exist.
  const notFound = replay({ 'https://api.github.com/repos/JetBrains/no-such-repository': { status: 404, body: { message: 'Not Found' } } });
  await assert.rejects(openGitHub('https://github.com/JetBrains/no-such-repository', { fetch: notFound }), {
    message: 'Repository not found: https://github.com/JetBrains/no-such-repository',
  });

  const offline = await atlas(['scan', 'https://github.com/JetBrains/not-answered']);
  assert.equal(offline.code, 1);
  assert.match(offline.stderr, /^Cannot reach GitHub: not recorded: https:\/\/api\.github\.com\/repos\/JetBrains\/not-answered$/);
});

test('rate limit → a message that asks for GITHUB_TOKEN', async () => {
  const limited = replay({
    'https://api.github.com/repos/JetBrains/MPS': {
      status: 403,
      body: { message: 'API rate limit exceeded for 192.0.2.1. (But here is the good news: ...)' },
    },
  });
  await assert.rejects(openGitHub('https://github.com/JetBrains/MPS', { fetch: limited }), {
    message: 'GitHub rate limit reached; set GITHUB_TOKEN',
  });
});

/** A repository in a temporary directory: each path holds a SKILL.md with that name. */
async function scanFiles(t: { after(fn: () => void): void }, files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, name] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), `---\nname: ${name}\ndescription: The ${name} skill.\n---\n`);
  }
  return { root: pathToFileURL(root).href, ...(await atlas(['scan', root])) };
}

test('only skill roots hold project skills: a SKILL.md anywhere else is ignored', async (t) => {
  const { root, code, stdout } = await scanFiles(t, {
    'SKILL.md': 'at-the-root',
    'docs/examples/SKILL.md': 'an-example',
    'skills/loose/SKILL.md': 'loose',
    '.claude/SKILL.md': 'no-skill-directory',
    '.claude/skills/SKILL.md': 'root-file',
    'agents/skills/deploy/SKILL.md': 'deploy',
    'agent/skills/lint/SKILL.md': 'lint',
    '.cursor/skills/review/SKILL.md': 'review',
    'modules/billing/.claude/skills/invoices/SKILL.md': 'invoices',
  });
  assert.equal(code, 0);
  assert.equal(
    stdout,
    [
      `${root.split('/').at(-1)} · 4 skills`,
      'deploy — The deploy skill.',
      `  ${root}/agents/skills/deploy/SKILL.md`,
      'invoices — The invoices skill.',
      `  ${root}/modules/billing/.claude/skills/invoices/SKILL.md`,
      'lint — The lint skill.',
      `  ${root}/agent/skills/lint/SKILL.md`,
      'review — The review skill.',
      `  ${root}/.cursor/skills/review/SKILL.md`,
    ].join('\n'),
  );
});

test('the same skill in several agents\' roots counts once, with its copies', async (t) => {
  const { root, code, stdout } = await scanFiles(t, {
    '.claude/skills/commits/SKILL.md': 'commits',
    '.agents/skills/commits/SKILL.md': 'commits',
    '.github/skills/commits/SKILL.md': 'commits',
    // Another module's skill of the same name is a skill of its own.
    'modules/app/.claude/skills/commits/SKILL.md': 'commits',
  });
  assert.equal(code, 0);
  assert.equal(
    stdout,
    [
      `${root.split('/').at(-1)} · 2 skills`,
      'commits — The commits skill.',
      `  ${root}/.agents/skills/commits/SKILL.md`,
      '  also in .claude/skills/commits/SKILL.md, .github/skills/commits/SKILL.md',
      'commits — The commits skill.',
      `  ${root}/modules/app/.claude/skills/commits/SKILL.md`,
    ].join('\n'),
  );
});

test('skills used as resources, shipped with the product or by tests, are not project skills', async (t) => {
  const { root, code, stdout } = await scanFiles(t, {
    '.claude/skills/commits/SKILL.md': 'commits',
    'plugins/ai/resources/.claude/skills/shipped/SKILL.md': 'shipped',
    'plugins/ai/src/main/resources/agents/skills/bundled/SKILL.md': 'bundled',
    'plugins/ai/test/.claude/skills/in-a-test/SKILL.md': 'in-a-test',
    'plugins/ai/testData/scan/.agents/skills/test-data/SKILL.md': 'test-data',
    'plugins/ai/test-resources/.cursor/skills/test-resource/SKILL.md': 'test-resource',
    'packages/web/__fixtures__/.claude/skills/fixture/SKILL.md': 'fixture',
    // A module whose name only contains one of the words is still a module.
    'modules/test-runner/.claude/skills/run-tests/SKILL.md': 'run-tests',
  });
  assert.equal(code, 0);
  assert.equal(
    stdout,
    [
      `${root.split('/').at(-1)} · 2 skills`,
      'commits — The commits skill.',
      `  ${root}/.claude/skills/commits/SKILL.md`,
      'run-tests — The run-tests skill.',
      `  ${root}/modules/test-runner/.claude/skills/run-tests/SKILL.md`,
    ].join('\n'),
  );
});

test('the first sentence: a `.` in a code span does not end it', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.claude/skills/tests'), { recursive: true });
  writeFileSync(join(root, '.claude/skills/tests/SKILL.md'), '---\nname: tests\ndescription: Run `npm. test` first. Then push.\n---\n');
  const { code, stdout } = await atlas(['scan', root]);
  assert.equal(code, 0);
  assert.equal(stdout.split('\n')[1], 'tests — Run `npm. test` first.');
});

test('the first sentence: a lone backtick does not hide the `.` after it', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.claude/skills/tests'), { recursive: true });
  writeFileSync(join(root, '.claude/skills/tests/SKILL.md'), '---\nname: tests\ndescription: Type ` to quote. Then push.\n---\n');
  const { code, stdout } = await atlas(['scan', root]);
  assert.equal(code, 0);
  assert.equal(stdout.split('\n')[1], 'tests — Type ` to quote.');
});

test('the first sentence: many code spans and no `.` → the whole description, quickly', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.claude/skills/tests'), { recursive: true });
  const description = 'Run `a` '.repeat(40).trim();
  writeFileSync(join(root, '.claude/skills/tests/SKILL.md'), `---\nname: tests\ndescription: ${description}\n---\n`);
  const { code, stdout } = await atlas(['scan', root]);
  assert.equal(code, 0);
  assert.equal(stdout.split('\n')[1], `tests — ${description}`);
});
