// Runs the commands the way the CLI does, with GitHub answering from EXAMPLE below.
import { fileURLToPath } from 'node:url';
import { run } from '../src/commands.ts';
import { openGitHub, openGitHubOrganization, parseGitHubOrganization, parseGitHubUrl } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { openDirectory } from '../src/local.ts';

export const FIXTURE = fileURLToPath(new URL('../fixture', import.meta.url));
export const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

/** The commit GitHub answers for JetBrains/example. */
export const EXAMPLE_COMMIT = '5ab6270ab772d113e8ad52ebfcaa0109c522ae00';

const raw = (repo: string, path: string) => `https://raw.githubusercontent.com/JetBrains/${repo}/${EXAMPLE_COMMIT}/${path}`;
const repository = (name: string, branch = 'main') => ({ full_name: `JetBrains/${name}`, default_branch: branch });

/**
 * What GitHub answers for a small repository, JetBrains/example, with one skill; and for the
 * JetBrains organization, through code search: example; tools, with two skills, one without front
 * matter, and a copy; docs, with a SKILL.md outside the skill roots, so no skill; blank, which code
 * search finds nothing in; forked, a fork, which code search leaves out, listed through its tree.
 */
const EXAMPLE: Recording = {
  'https://api.github.com/repos/JetBrains/example': { status: 200, body: { full_name: 'JetBrains/example', default_branch: 'main' } },
  'https://api.github.com/repos/JetBrains/example/commits/main': { status: 200, body: { sha: EXAMPLE_COMMIT } },
  'https://api.github.com/search/code?q=filename:SKILL.md+repo:JetBrains/example&per_page=100&page=1': {
    status: 200,
    body: { total_count: 1, items: [{ path: '.claude/skills/commits/SKILL.md' }] },
  },
  [`https://raw.githubusercontent.com/JetBrains/example/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`]: {
    status: 200,
    body: '---\nname: commits\ndescription: Write commit messages the way this repository does. Use for every commit.\n---\n# Commits\n',
  },
  'https://api.github.com/users/JetBrains': { status: 200, body: { login: 'JetBrains', type: 'Organization' } },
  'https://api.github.com/orgs/JetBrains/repos?type=all&per_page=100&page=1': {
    status: 200,
    body: [repository('tools'), repository('example'), repository('docs', 'trunk'), repository('blank'), { ...repository('forked'), fork: true }],
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

/** Opens what the CLI would, with GitHub answering from EXAMPLE; with a token, through code search. */
export const open = (input: string) =>
  parseGitHubUrl(input)
    ? openGitHub(input, { fetch: github, token: 'test' })
    : parseGitHubOrganization(input)
      ? openGitHubOrganization(input, { fetch: github, token: 'test' })
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
