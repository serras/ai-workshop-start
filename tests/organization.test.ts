// The decisions in spec/analysis.md about organizations, checked on what GitHub answers for the
// JetBrains organization in tests/helpers.ts, and for smaller ones answered here.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { run } from '../src/commands.ts';
import { openGitHub, openGitHubOrganization, parseGitHubOrganization, parseGitHubUrl } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { scanOrganization } from '../src/core/scan.ts';
import { atlas, EXAMPLE_COMMIT, github } from './helpers.ts';

const COMMIT = EXAMPLE_COMMIT;

test('github.com/<owner> is an organization; github.com/<owner>/<repo> a repository', () => {
  for (const input of ['github.com/JetBrains', 'https://github.com/JetBrains/', 'http://www.github.com/JetBrains', ' github.com/JetBrains ']) {
    assert.equal(parseGitHubOrganization(input), 'JetBrains', input);
    assert.equal(parseGitHubUrl(input), undefined, input);
  }
  for (const input of ['github.com/JetBrains/kotlin', 'github.com/JetBrains/kotlin/tree/master', './fixture', 'gitlab.com/JetBrains']) {
    assert.equal(parseGitHubOrganization(input), undefined, input);
  }
});

test('an organization, with a token: one code search, forks through their trees; sorted; warnings after the repository', async () => {
  const result = await scanOrganization(await openGitHubOrganization('https://github.com/JetBrains', { fetch: github, token: 'test' }));
  assert.deepEqual(result.organization, { id: 'JetBrains', url: 'https://github.com/JetBrains' });
  // blank: nothing found by code search, so not even opened; forked: through its tree.
  assert.deepEqual(
    result.repositories.map(({ repository, skills }) => [repository.id, skills.map((skill) => [skill.name, skill.copies])]),
    [
      ['JetBrains/docs', []],
      ['JetBrains/example', [['commits', []]]],
      ['JetBrains/forked', [['lint', []]]],
      ['JetBrains/tools', [['release', ['.claude/skills/release/SKILL.md']], ['triage', []]]],
    ],
  );
  const tools = result.repositories[3];
  assert.equal(tools.repository.commit, COMMIT);
  assert.equal(tools.skills[0].id, 'JetBrains/tools:.agents/skills/release/SKILL.md');
  assert.deepEqual(result.warnings, ['JetBrains/tools: .github/skills/triage/SKILL.md: no front matter; using the directory name']);
});

/** An organization of four repositories listed through their trees: no token. */
const ACME: Recording = {
  'https://api.github.com/users/acme': { status: 200, body: { login: 'acme', type: 'Organization' } },
  'https://api.github.com/orgs/acme/repos?type=all&per_page=100&page=1': {
    status: 200,
    body: [
      { full_name: 'acme/Widgets', default_branch: 'main' },
      { full_name: 'acme/blank', default_branch: 'main' },
      { full_name: 'acme/api', default_branch: 'main' },
      { full_name: 'acme/locked', default_branch: 'main', disabled: true },
    ],
  },
  'https://api.github.com/repos/acme/Widgets/commits/main': { status: 200, body: { sha: COMMIT } },
  'https://api.github.com/repos/acme/api/commits/main': { status: 200, body: { sha: COMMIT } },
  'https://api.github.com/repos/acme/blank/commits/main': { status: 409, body: { message: 'Git Repository is empty.' } },
  [`https://api.github.com/repos/acme/Widgets/git/trees/${COMMIT}?recursive=1`]: {
    status: 200,
    body: { truncated: false, tree: [{ path: '.claude/skills/paint/SKILL.md', mode: '100644', type: 'blob', sha: 'a' }] },
  },
  [`https://api.github.com/repos/acme/api/git/trees/${COMMIT}?recursive=1`]: {
    status: 200,
    body: { truncated: false, tree: [{ path: '.agents/skills/deploy/SKILL.md', mode: '100644', type: 'blob', sha: 'b' }] },
  },
  [`https://raw.githubusercontent.com/acme/Widgets/${COMMIT}/.claude/skills/paint/SKILL.md`]: {
    status: 200,
    body: '---\nname: paint\ndescription: Paint widgets.\n---\n',
  },
  [`https://raw.githubusercontent.com/acme/api/${COMMIT}/.agents/skills/deploy/SKILL.md`]: {
    status: 200,
    body: '---\nname: deploy\ndescription: Deploy the API.\n---\n',
  },
};

test('an organization, without a token: each repository through its tree; empty and disabled ones skipped; sorted ignoring case', async () => {
  const result = await scanOrganization(await openGitHubOrganization('github.com/acme', { fetch: replay(ACME) }));
  assert.deepEqual(
    result.repositories.map(({ repository, skills }) => [repository.id, skills.map((skill) => skill.name)]),
    [
      ['acme/api', ['deploy']],
      ['acme/Widgets', ['paint']],
    ],
  );
  assert.deepEqual(result.warnings, []);
});

test('an unreadable repository of an organization → a warning, the others still scanned; a rate limit stops the scan', async () => {
  const listing = (names: string[]) => ({
    status: 200,
    body: names.map((name) => ({ full_name: `acme/${name}`, default_branch: 'main' })),
  });
  const fetch = replay({
    ...ACME,
    'https://api.github.com/orgs/acme/repos?type=all&per_page=100&page=1': listing(['api', 'gone', 'blocked']),
    'https://api.github.com/repos/acme/gone/commits/main': { status: 404, body: { message: 'Not Found' } },
    'https://api.github.com/repos/acme/blocked/commits/main': { status: 451, body: { message: 'Repository access blocked' } },
  });
  const result = await scanOrganization(await openGitHubOrganization('github.com/acme', { fetch }));
  assert.deepEqual(
    result.repositories.map(({ repository, skills }) => [repository.id, skills.map((skill) => skill.name)]),
    [['acme/api', ['deploy']]],
  );
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0], /^acme\/blocked: GitHub answered 451 for .*; skipped$/);
  assert.equal(result.warnings[1], 'acme/gone: Not found in https://github.com/acme/gone: main; skipped');

  const limited = replay({
    ...ACME,
    'https://api.github.com/orgs/acme/repos?type=all&per_page=100&page=1': listing(['api', 'limited']),
    'https://api.github.com/repos/acme/limited/commits/main': { status: 403, body: { message: 'API rate limit exceeded' } },
  });
  await assert.rejects(openGitHubOrganization('github.com/acme', { fetch: limited }), { message: 'GitHub rate limit reached; set GITHUB_TOKEN' });
});

test('a user\'s account is an organization too: every repository it owns, page after page', async () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ full_name: `serras/old-${i}`, default_branch: 'main', disabled: true }));
  const fetch = replay({
    'https://api.github.com/users/serras': { status: 200, body: { login: 'serras', type: 'User' } },
    'https://api.github.com/users/serras/repos?type=owner&per_page=100&page=1': { status: 200, body: many },
    'https://api.github.com/users/serras/repos?type=owner&per_page=100&page=2': {
      status: 200,
      body: [{ full_name: 'serras/ai-workshop-start', default_branch: 'main' }],
    },
    'https://api.github.com/search/code?q=filename:SKILL.md+user:serras&per_page=100&page=1': {
      status: 200,
      // More than code search answers: some skills may be missing.
      body: { total_count: 1200, items: [{ path: '.agents/skills/issue-to-pr/SKILL.md', repository: { full_name: 'serras/ai-workshop-start' } }] },
    },
    'https://api.github.com/repos/serras/ai-workshop-start/commits/main': { status: 200, body: { sha: COMMIT } },
    [`https://raw.githubusercontent.com/serras/ai-workshop-start/${COMMIT}/.agents/skills/issue-to-pr/SKILL.md`]: {
      status: 200,
      body: '---\nname: issue-to-pr\ndescription: Turn a GitHub issue into a pull request\n---\n',
    },
  });
  const result = await scanOrganization(await openGitHubOrganization('github.com/serras', { fetch, token: 'test' }));
  assert.deepEqual(result.organization, { id: 'serras', url: 'https://github.com/serras' });
  assert.deepEqual(
    result.repositories.map(({ repository, skills }) => [repository.id, skills.map((skill) => skill.name)]),
    [['serras/ai-workshop-start', ['issue-to-pr']]],
  );
  assert.deepEqual(result.warnings, ['code search found 1200 SKILL.md files but answers only 1000; some skills may be missing']);
});

test('unknown organization → a clear message; an empty repository on its own → a clear message', async () => {
  const fetch = replay({
    'https://api.github.com/users/no-such-owner': { status: 404, body: { message: 'Not Found' } },
    'https://api.github.com/repos/acme/blank': { status: 200, body: { full_name: 'acme/blank', default_branch: 'main' } },
    ...ACME,
  });
  await assert.rejects(openGitHubOrganization('github.com/no-such-owner', { fetch }), {
    message: 'Organization not found: https://github.com/no-such-owner',
  });
  await assert.rejects(openGitHub('github.com/acme/blank', { fetch }), { message: 'The repository is empty: https://github.com/acme/blank' });
});

test('scan github.com/<owner> prints every repository with skills, each as on its own; warnings after its id', async () => {
  const blob = (repo: string, path: string) => `  https://github.com/JetBrains/${repo}/blob/${COMMIT}/${path}`;
  const { code, stdout, stderr } = await atlas(['scan', 'https://github.com/JetBrains']);
  assert.equal(code, 0, stderr);
  // docs: no skill, so not printed.
  assert.equal(
    stdout,
    [
      'JetBrains · 4 skills in 3 repositories',
      '',
      'JetBrains/example · 1 skill',
      'commits — Write commit messages the way this repository does.',
      blob('example', '.claude/skills/commits/SKILL.md'),
      '',
      'JetBrains/forked · 1 skill',
      'lint — Lint the fork.',
      blob('forked', '.cursor/skills/lint/SKILL.md'),
      '',
      'JetBrains/tools · 2 skills',
      'release — Cut a release.',
      blob('tools', '.agents/skills/release/SKILL.md'),
      '  also in .claude/skills/release/SKILL.md',
      'triage',
      blob('tools', '.github/skills/triage/SKILL.md'),
    ].join('\n'),
  );
  assert.equal(stderr, 'warning: JetBrains/tools: .github/skills/triage/SKILL.md: no front matter; using the directory name');
});

test('scan of an organization without any skill → No skills found; of an unknown one → exit code 1', async () => {
  const fetch = replay({
    'https://api.github.com/users/empty': { status: 200, body: { login: 'empty', type: 'Organization' } },
    'https://api.github.com/orgs/empty/repos?type=all&per_page=100&page=1': { status: 200, body: [] },
    'https://api.github.com/users/nobody': { status: 404, body: { message: 'Not Found' } },
  });
  const printed: string[] = [];
  const context = {
    open: (input: string) => openGitHubOrganization(input, { fetch }),
    print: (text: string) => printed.push(text),
    error: (text: string) => printed.push(`error: ${text}`),
  };
  assert.equal(await run(['scan', 'github.com/empty'], context), 0);
  assert.equal(await run(['scan', 'github.com/nobody'], context), 1);
  assert.deepEqual(printed, ['empty · 0 skills', 'No skills found', 'error: Organization not found: https://github.com/nobody']);
});
