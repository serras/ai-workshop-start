// The decisions in spec/analysis.md about organizations, checked on what GitHub answers for the
// JetBrains organization in tests/helpers.ts, and for smaller ones answered here.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { run } from '../src/commands.ts';
import { openGitHub, openGitHubOrganization, parseGitHubOrganization, parseGitHubUrl } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { scanOrganization } from '../src/core/scan.ts';
import { openDirectory } from '../src/local.ts';
import { atlas, AVATAR, EXAMPLE_COMMIT, FIXTURE, github } from './helpers.ts';

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
  assert.deepEqual(result.organization, {
    id: 'JetBrains',
    url: 'https://github.com/JetBrains',
    avatar: AVATAR,
    homepage: 'https://www.jetbrains.com/',
  });
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
  assert.deepEqual(
    result.repositories.map(({ repository }) => repository.stars),
    [12, 56234, 1250000, 999],
  );
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

test('a repository: its stars; its owner, organization or user, with the avatar and homepage of its profile, asked for only when wanted', async () => {
  const asked: string[] = [];
  const fetch = replay({
    ...ACME,
    'https://api.github.com/repos/acme/api': { status: 200, body: { full_name: 'acme/api', default_branch: 'main', stargazers_count: 7 } },
    'https://api.github.com/users/acme': {
      status: 200,
      body: { login: 'acme', type: 'Organization', avatar_url: 'https://avatars.example/acme', blog: 'http://acme.example/about' },
    },
  });
  const source = await openGitHub('github.com/acme/api', { fetch: (url, init) => (asked.push(url), fetch(url, init)) });
  assert.equal(source.repository.stars, 7);
  assert.equal(asked.some((url) => url.includes('/users/')), false);
  assert.deepEqual(await source.owner!(), {
    id: 'acme',
    url: 'https://github.com/acme',
    avatar: 'https://avatars.example/acme',
    homepage: 'http://acme.example/about',
  });
  // A local directory: no stars, no owner.
  const local = await openDirectory(FIXTURE);
  assert.equal(local.repository.stars, undefined);
  assert.equal(local.owner, undefined);
});

test('a profile without a homepage, or with one that is not a web address, or an avatar not over https: only what is', async () => {
  const account = (login: string, avatar_url: string | null, blog: string | null) => ({
    [`https://api.github.com/users/${login}`]: { status: 200, body: { login, type: 'User', avatar_url, blog } },
    [`https://api.github.com/users/${login}/repos?type=owner&per_page=100&page=1`]: { status: 200, body: [] },
  });
  const fetch = replay({
    ...account('blank', 'https://avatars.example/blank', ''),
    ...account('spaces', null, '   '),
    ...account('script', 'http://avatars.example/script', 'javascript:alert(1)'),
    ...account('mail', 'data:image/png;base64,AAAA', 'mailto:someone@example.com'),
    ...account('plain', 'https://avatars.example/plain', ' plain.example '),
  });
  const organization = async (login: string) => (await openGitHubOrganization(`github.com/${login}`, { fetch })).organization;
  assert.deepEqual(await organization('blank'), { id: 'blank', url: 'https://github.com/blank', avatar: 'https://avatars.example/blank' });
  assert.deepEqual(await organization('spaces'), { id: 'spaces', url: 'https://github.com/spaces' });
  assert.deepEqual(await organization('script'), { id: 'script', url: 'https://github.com/script' });
  assert.deepEqual(await organization('mail'), { id: 'mail', url: 'https://github.com/mail' });
  assert.deepEqual(await organization('plain'), {
    id: 'plain',
    url: 'https://github.com/plain',
    avatar: 'https://avatars.example/plain',
    homepage: 'https://plain.example/',
  });
});
