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
import { openGitHub } from '../src/core/github.ts';
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
    message: 'Not found in https://github.com/JetBrains/example: no-such-ref',
  });
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
