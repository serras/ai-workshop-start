// The promo's fake GitHub: northwind, an organization with a few repositories full of skills, as a
// real team would have them. Claude answers from promo/claude.json, asked once with `claude -p` for
// a prompt not there yet. Nothing else reaches the network.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { claude } from '../src/claude.ts';
import type { Model } from '../src/core/group.ts';
import { isGitHubAddress, openGitHub, openGitHubOrganization, parseGitHubOrganization } from '../src/core/github.ts';
import { replay, type ModelRecording, type Recording } from '../src/core/replay.ts';
import { openDirectory } from '../src/local.ts';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
export const AVATAR = 'https://avatars.githubusercontent.com/u/7070?v=4';

const API = 'https://api.github.com';
const raw = (id: string, path: string) => `https://raw.githubusercontent.com/${id}/${COMMIT}/${path}`;
const skill = (name: string, description: string, body = `# ${name}\n`) => `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;

const REVIEW = `---
name: code-review
description: Review a pull request **the way the storefront team does**, before a human looks at it. Use for every PR.
allowed-tools: Read, Grep, Bash(git diff:*)
---
# Code review

Read the whole diff first, then comment from the most important to the least.

## What to look for

| Area | Ask yourself |
| --- | --- |
| Correctness | Does it do what the PR says, also for empty carts? |
| Accessibility | Can it be used with a keyboard only? |
| Performance | Does the product page still load in under a second? |

## How to comment

1. One comment per problem, on the line it is on.
2. Suggest the fix: \`suggestion\` blocks, when it is short.
3. End with a summary: *approve*, or what is left to do.

\`\`\`console
$ git diff origin/main...HEAD
\`\`\`
`;

const SECURITY = `# Security review

Before merging anything that touches requests, queries or credentials:

- [ ] Every query is parameterized: no string concatenation
- [ ] No secret in the diff: tokens live in the vault
- [ ] Every new endpoint checks **who** is asking, not only that someone is

> When in doubt, ask the security channel before merging.
`;

/** Repository, stars and its skills: path and SKILL.md. */
const REPOSITORIES: [string, number, [string, string][]][] = [
  ['northwind/storefront', 48213, [
    ['.claude/skills/code-review/SKILL.md', REVIEW],
    ['.claude/skills/write-tests/SKILL.md', skill('write-tests', 'Write Playwright tests for a new page or a fixed bug. Then run them.')],
    ['.claude/skills/react-components/SKILL.md', skill('react-components', 'Build a React component from the design system, with its stories.')],
    ['.claude/skills/accessibility-check/SKILL.md', skill('accessibility-check', 'Check a page against WCAG 2.2, for contrast, labels and keyboard use.')],
    ['.claude/skills/commit-messages/SKILL.md', skill('commit-messages', 'Write commit messages as this repository does, the area first.')],
    ['.claude/skills/release-notes/SKILL.md', skill('release-notes', 'Write the release notes from the merged pull requests.')],
  ]],
  ['northwind/api', 9870, [
    ['.claude/skills/api-design/SKILL.md', skill('api-design', 'Design a REST endpoint that follows the API guidelines.')],
    ['.claude/skills/database-migrations/SKILL.md', skill('database-migrations', 'Write a safe, reversible Postgres migration.')],
    ['.agents/skills/security-review/SKILL.md', skill('security-review', 'Look for injection, leaked secrets and missing auth checks in a change.', SECURITY)],
    ['.agents/skills/incident-response/SKILL.md', skill('incident-response', 'Lead an incident, from finding the cause to writing the postmortem.')],
    ['.agents/skills/load-testing/SKILL.md', skill('load-testing', 'Run a k6 load test against staging and read its results.')],
  ]],
  ['northwind/mobile', 3120, [
    ['.claude/skills/android-release/SKILL.md', skill('android-release', 'Ship the Android app to the Play Store, from the build to the rollout.')],
    ['.claude/skills/ios-screenshots/SKILL.md', skill('ios-screenshots', 'Take the App Store screenshots in every language.')],
    ['.claude/skills/translate-strings/SKILL.md', skill('translate-strings', 'Translate new UI strings into the twelve supported languages.')],
  ]],
  ['northwind/handbook', 412, [
    ['.claude/skills/write-docs/SKILL.md', skill('write-docs', 'Write a how-to guide in the handbook style.')],
    ['.claude/skills/onboarding/SKILL.md', skill('onboarding', 'Walk a new teammate through their first week.')],
    ['.claude/skills/meeting-notes/SKILL.md', skill('meeting-notes', 'Turn a meeting transcript into notes and action items.')],
  ]],
];

const repository = (id: string, stars: number) => ({ full_name: id, default_branch: 'main', stargazers_count: stars, fork: false });
const search = (query: string, items: unknown[]) => ({
  [`${API}/search/code?q=filename:SKILL.md+${query}&per_page=100&page=1`]: { status: 200, body: { total_count: items.length, items } },
});

const RECORDING: Recording = {
  [`${API}/users/northwind`]: {
    status: 200,
    body: { login: 'northwind', type: 'Organization', avatar_url: AVATAR, blog: 'https://northwind.example/' },
  },
  [`${API}/orgs/northwind/repos?type=all&per_page=100&page=1`]: {
    status: 200,
    body: REPOSITORIES.map(([id, stars]) => repository(id, stars)),
  },
  ...search('org:northwind', REPOSITORIES.flatMap(([id, , skills]) => skills.map(([path]) => ({ path, repository: { full_name: id } })))),
  ...Object.fromEntries(
    REPOSITORIES.flatMap(([id, stars, skills]) => [
      [`${API}/repos/${id}`, { status: 200, body: repository(id, stars) }],
      [`${API}/repos/${id}/commits/main`, { status: 200, body: { sha: COMMIT } }],
      ...Object.entries(search(`repo:${id}`, skills.map(([path]) => ({ path })))),
      ...skills.map(([path, text]) => [raw(id, path), { status: 200, body: text }]),
    ]),
  ),
};

const github = replay(RECORDING);

const ANSWERS = new URL('./claude.json', import.meta.url);
const answers: ModelRecording = existsSync(ANSWERS) ? JSON.parse(readFileSync(ANSWERS, 'utf8')) : {};
const ask = claude({ command: process.env.SKILL_ATLAS_CLAUDE || undefined });

/** Claude's recorded answer; asked, and recorded, the first time. */
export const model: Model = async (prompt) => {
  if (!Object.hasOwn(answers, prompt)) {
    answers[prompt] = await ask(prompt);
    writeFileSync(ANSWERS, `${JSON.stringify(answers, null, 2)}\n`);
  }
  return answers[prompt];
};

export const open = (input: string) =>
  parseGitHubOrganization(input)
    ? openGitHubOrganization(input, { fetch: github, token: 'promo' })
    : isGitHubAddress(input)
      ? openGitHub(input, { fetch: github, token: 'promo' })
      : openDirectory(input);
