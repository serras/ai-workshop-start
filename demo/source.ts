// The demo's fake GitHub: what it answers for the acme organization, a few of its repositories,
// a user whose profile GitHub does not give, and an empty organization. Local directories are read
// as the CLI reads them. Nothing reaches the network.
import { openGitHub, openGitHubOrganization, parseGitHubOrganization, parseGitHubUrl } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { openDirectory } from '../src/local.ts';

/** The commit every repository is scanned at. */
const COMMIT = '0123456789abcdef0123456789abcdef01234567';

/** acme's avatar: the demo answers it with avatar.svg, in the browser. */
export const AVATAR = 'https://avatars.githubusercontent.com/u/4242?v=4';

const API = 'https://api.github.com';
const raw = (id: string, path: string) => `https://raw.githubusercontent.com/${id}/${COMMIT}/${path}`;
const repository = (id: string, stars: number, fork = false) => ({ full_name: id, default_branch: 'main', stargazers_count: stars, fork });
const skill = (name: string, description: string, body = '') => `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;

const COMMITS = `${skill(
  'commits',
  'Write commit messages **the way this repository does**, as in [the guide](https://acme.example/guide). Use for every commit.',
)}
# Commits

Start with the area, then say what changed: \`engine: keep the thrust after a restart\`.

| Area | Prefix |
| --- | --- |
| The engine | \`engine:\` |
| The docs | \`docs:\` |

\`\`\`console
$ git commit -m "engine: keep the thrust after a restart"
\`\`\`

- See [the release skill](../release/SKILL.md) and [the README](/README.md).
- ![The badge](https://img.example/badge.svg) and ![a local one](badge.png)
- <b>Raw HTML</b> is shown as text.
`;

/** Repository, path and SKILL.md of every skill the demo's GitHub has. */
const SKILLS: [string, string, string][] = [
  ['acme/rocket', '.claude/skills/commits/SKILL.md', COMMITS],
  ['acme/rocket', '.agents/skills/release/SKILL.md', skill('release', 'Cut a release. Then announce it.', '# Release\n\n1. Tag it.\n2. Write the notes.\n3. Announce it.\n')],
  ['acme/rocket', '.claude/skills/release/SKILL.md', skill('release', 'Cut a release. Then announce it.', '# Release\n')],
  ['acme/Anvil', '.github/skills/triage/SKILL.md', '# Triage\n\nLabel the issue, then assign it.\n'],
  ['acme/Anvil', '.github/skills/review/SKILL.md', '---\nname: review\ndescription: Review: carefully\n---\n# Review\n'],
  ['acme/forked', '.cursor/skills/lint/SKILL.md', skill('lint', 'Lint the fork before pushing.')],
  ['acme/docs', 'docs/SKILL.md', '# Not a skill: outside the skill roots\n'],
  ['solo/notes', '.claude/skills/notes/SKILL.md', skill('notes', 'Take notes as you go.', '# Notes\n')],
  // Enough skills for the list to scroll under the filter.
  ...Array.from({ length: 24 }, (_, i): [string, string, string] => {
    const name = `chapter-${String(i + 1).padStart(2, '0')}`;
    return ['acme/handbook', `.agents/skills/${name}/SKILL.md`, skill(name, `Chapter ${i + 1} of the handbook.`, `# Chapter ${i + 1}\n`)];
  }),
];

const search = (query: string, items: unknown[]) => ({
  [`${API}/search/code?q=filename:SKILL.md+${query}&per_page=100&page=1`]: { status: 200, body: { total_count: items.length, items } },
});

/** A repository scanned on its own: its info, its commit and its code search. */
const single = (id: string, stars: number): Recording => ({
  [`${API}/repos/${id}`]: { status: 200, body: repository(id, stars) },
  [`${API}/repos/${id}/commits/main`]: { status: 200, body: { sha: COMMIT } },
  ...search(
    `repo:${id}`,
    SKILLS.filter(([repo]) => repo === id).map(([, path]) => ({ path })),
  ),
});

const RECORDING: Recording = {
  ...Object.fromEntries(SKILLS.map(([id, path, text]) => [raw(id, path), { status: 200, body: text }])),
  [`${API}/users/acme`]: {
    status: 200,
    body: { login: 'acme', type: 'Organization', avatar_url: AVATAR, blog: 'https://acme.example/' },
  },
  ...single('acme/rocket', 56234),
  ...single('acme/handbook', 7),
  ...single('solo/notes', 3),
  [`${API}/users/solo`]: { status: 404, body: { message: 'Not Found' } },
  [`${API}/repos/acme/missing`]: { status: 404, body: { message: 'Not Found' } },
  // The organization: code search finds rocket, Anvil and docs; forked, a fork, is listed through its tree.
  [`${API}/orgs/acme/repos?type=all&per_page=100&page=1`]: {
    status: 200,
    body: [repository('acme/rocket', 56234), repository('acme/Anvil', 999), repository('acme/docs', 12), repository('acme/forked', 1250000, true)],
  },
  ...search(
    'org:acme',
    SKILLS.filter(([id]) => ['acme/rocket', 'acme/Anvil', 'acme/docs'].includes(id)).map(([id, path]) => ({ path, repository: { full_name: id } })),
  ),
  [`${API}/repos/acme/Anvil/commits/main`]: { status: 200, body: { sha: COMMIT } },
  [`${API}/repos/acme/docs/commits/main`]: { status: 200, body: { sha: COMMIT } },
  [`${API}/repos/acme/forked/commits/main`]: { status: 200, body: { sha: COMMIT } },
  [`${API}/repos/acme/forked/git/trees/${COMMIT}?recursive=1`]: {
    status: 200,
    body: { truncated: false, tree: [{ path: '.cursor/skills/lint/SKILL.md', mode: '100644', type: 'blob', sha: 'c' }] },
  },
  // An organization with no repository at all.
  [`${API}/users/empty`]: { status: 200, body: { login: 'empty', type: 'Organization' } },
  [`${API}/orgs/empty/repos?type=all&per_page=100&page=1`]: { status: 200, body: [] },
  ...search('org:empty', []),
};

const github = replay(RECORDING);

/** Opens what the CLI would, with GitHub answering from RECORDING, with a token: through code search. */
export const open = (input: string) =>
  parseGitHubUrl(input)
    ? openGitHub(input, { fetch: github, token: 'demo' })
    : parseGitHubOrganization(input)
      ? openGitHubOrganization(input, { fetch: github, token: 'demo' })
      : openDirectory(input);
