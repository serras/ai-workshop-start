// Runs the commands the way the CLI does, with GitHub answering from EXAMPLE below, and Claude
// from tests/claude.json.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { run } from '../src/commands.ts';
import { isGitHubAddress, openGitHub, openGitHubOrganization, parseGitHubOrganization } from '../src/core/github.ts';
import { replay, replayModel, type ModelRecording, type Recording } from '../src/core/replay.ts';
import { openDirectory } from '../src/local.ts';

export const FIXTURE = fileURLToPath(new URL('../fixture', import.meta.url));
export const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

/** The commit GitHub answers for JetBrains/example. */
export const EXAMPLE_COMMIT = '5ab6270ab772d113e8ad52ebfcaa0109c522ae00';

const raw = (repo: string, path: string) => `https://raw.githubusercontent.com/JetBrains/${repo}/${EXAMPLE_COMMIT}/${path}`;
const repository = (name: string, branch = 'main', stars = 0) => ({ full_name: `JetBrains/${name}`, default_branch: branch, stargazers_count: stars });

/** The JetBrains organization's avatar, as GitHub lists it. */
export const AVATAR = 'https://avatars.githubusercontent.com/u/878437?v=4';

/**
 * What GitHub answers for a small repository, JetBrains/example, with one skill and 56234 stars; for
 * its owner, the JetBrains organization, with an avatar and a homepage; and for the
 * JetBrains organization, through code search: example; tools, with two skills, one without front
 * matter, and a copy; docs, with a SKILL.md outside the skill roots, so no skill; blank, which code
 * search finds nothing in; forked, a fork, which code search leaves out, listed through its tree.
 */
const EXAMPLE: Recording = {
  'https://api.github.com/repos/JetBrains/example': { status: 200, body: repository('example', 'main', 56234) },
  'https://api.github.com/repos/JetBrains/example/commits/main': { status: 200, body: { sha: EXAMPLE_COMMIT } },
  'https://api.github.com/search/code?q=filename:SKILL.md+repo:JetBrains/example&per_page=100&page=1': {
    status: 200,
    body: { total_count: 1, items: [{ path: '.claude/skills/commits/SKILL.md' }] },
  },
  [`https://raw.githubusercontent.com/JetBrains/example/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`]: {
    status: 200,
    body: '---\nname: commits\ndescription: Write commit messages the way this repository does. Use for every commit.\n---\n# Commits\n',
  },
  'https://api.github.com/users/JetBrains': {
    status: 200,
    body: { login: 'JetBrains', type: 'Organization', avatar_url: AVATAR, blog: 'www.jetbrains.com' },
  },
  'https://api.github.com/orgs/JetBrains/repos?type=all&per_page=100&page=1': {
    status: 200,
    body: [
      repository('tools', 'main', 999),
      repository('example', 'main', 56234),
      repository('docs', 'trunk', 12),
      repository('blank'),
      { ...repository('forked', 'main', 1250000), fork: true },
    ],
  },
  'https://api.github.com/search/code?q=filename:SKILL.md+org:JetBrains&per_page=100&page=1': {
    status: 200,
    body: {
      total_count: 5,
      items: [
        { path: '.agents/skills/release/SKILL.md', repository: { full_name: 'JetBrains/tools' } },
        { path: '.claude/skills/commits/SKILL.md', repository: { full_name: 'JetBrains/example' } },
        { path: '.claude/skills/release/SKILL.md', repository: { full_name: 'JetBrains/tools' } },
        { path: '.github/skills/triage/SKILL.md', repository: { full_name: 'JetBrains/tools' } },
        { path: 'docs/SKILL.md', repository: { full_name: 'JetBrains/docs' } },
      ],
    },
  },
  // An organization with no repository at all.
  'https://api.github.com/users/empty': { status: 200, body: { login: 'empty', type: 'Organization' } },
  'https://api.github.com/orgs/empty/repos?type=all&per_page=100&page=1': { status: 200, body: [] },
  'https://api.github.com/search/code?q=filename:SKILL.md+org:empty&per_page=100&page=1': { status: 200, body: { total_count: 0, items: [] } },
  'https://api.github.com/repos/JetBrains/tools/commits/main': { status: 200, body: { sha: EXAMPLE_COMMIT } },
  'https://api.github.com/repos/JetBrains/docs/commits/trunk': { status: 200, body: { sha: EXAMPLE_COMMIT } },
  [raw('tools', '.agents/skills/release/SKILL.md')]: {
    status: 200,
    body: '---\nname: release\ndescription: Cut a release. Then announce it.\n---\n# Release\n',
  },
  [raw('tools', '.github/skills/triage/SKILL.md')]: { status: 200, body: '# Triage\n' },
  'https://api.github.com/repos/JetBrains/forked/commits/main': { status: 200, body: { sha: EXAMPLE_COMMIT } },
  [`https://api.github.com/repos/JetBrains/forked/git/trees/${EXAMPLE_COMMIT}?recursive=1`]: {
    status: 200,
    body: { truncated: false, tree: [{ path: '.cursor/skills/lint/SKILL.md', mode: '100644', type: 'blob', sha: 'c' }] },
  },
  [raw('forked', '.cursor/skills/lint/SKILL.md')]: { status: 200, body: '---\nname: lint\ndescription: Lint the fork.\n---\n' },
};

export const github = replay(EXAMPLE);

/** Claude's answers, by prompt: for ./fixture, JetBrains/example and the JetBrains organization. */
export const CLAUDE = fileURLToPath(new URL('./claude.json', import.meta.url));
export const model = replayModel(JSON.parse(readFileSync(CLAUDE, 'utf8')) as ModelRecording);

/** An executable that answers as `claude -p` would, from tests/claude.json. */
export const FAKE_CLAUDE = fileURLToPath(new URL('./claude.ts', import.meta.url));

/** Opens what the CLI would, with GitHub answering from EXAMPLE; with a token, through code search. */
export const open = (input: string) =>
  parseGitHubOrganization(input)
    ? openGitHubOrganization(input, { fetch: github, token: 'test' })
    : // Any other GitHub address is a repository's, or openGitHub says what is wrong with it.
      isGitHubAddress(input)
      ? openGitHub(input, { fetch: github, token: 'test' })
      : openDirectory(input);

/** `skill-atlas <args>`, as the CLI runs it, with GitHub answering from EXAMPLE. */
export async function atlas(args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(args, {
    open,
    print: (text) => stdout.push(text),
    error: (text) => stderr.push(text),
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}
