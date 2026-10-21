// The skill map of spec/analysis.md: the skills grouped by affinity by a model, here a recording of
// Claude's answers, so every run gives the same groups; and `claude -p` itself, as the web view runs it.
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test, type TestContext } from 'node:test';
import { claude } from '../src/claude.ts';
import { groupPrompt, groupSkills, type Groupings, type Model } from '../src/core/group.ts';
import type { Skill } from '../src/core/model.ts';
import { scan } from '../src/core/scan.ts';
import { openDirectory } from '../src/local.ts';
import { FAKE_CLAUDE, FIXTURE, model } from './helpers.ts';

const skill = (repository: string, name: string, description = ''): Skill => ({
  id: `${repository}:.claude/skills/${name}/SKILL.md`,
  repository,
  path: `.claude/skills/${name}/SKILL.md`,
  name,
  description,
  commit: '',
  copies: [],
  text: '',
});

const SKILLS = [
  skill('acme/rocket', 'release', 'Cut a release.\nThen   announce it.'),
  skill('acme/rocket', 'commits', 'Write commit messages.'),
  skill('acme/Anvil', 'triage'),
  skill('acme/Anvil', 'review', 'Review a pull request.'),
];

/** A model that answers `answer`, and keeps the prompts it was asked. */
function answering(answer: string | Error) {
  const prompts: string[] = [];
  const ask: Model = async (prompt) => {
    prompts.push(prompt);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { ask, prompts };
}

const names = (groups: { name: string; skills: string[] }[]) =>
  groups.map((group) => [group.name, group.skills.map((id) => id.replace(/^.*skills\/(.*)\/SKILL\.md$/, '$1'))]);

test('the prompt: every skill numbered by name, with its description on one line, and the JSON to answer', () => {
  const prompt = groupPrompt(SKILLS);
  assert.match(prompt, /^Group these agent skills by affinity/);
  assert.match(prompt, /Answer with JSON only, in this shape: \{"groups": \[\{"name": "…", "skills": \[1, 2\]\}\]\}/);
  assert.ok(prompt.endsWith('Skills:\n1. commits: Write commit messages.\n2. release: Cut a release. Then announce it.\n3. review: Review a pull request.\n4. triage\n'));
});

test('the groups of the answer: sorted by name ignoring case, each one\'s skills by name, as ids', async () => {
  const { ask, prompts } = answering('{"groups": [{"name": "shipping", "skills": [2, 1]}, {"name": "Code review", "skills": [4, 3]}]}');
  const { groups, warnings } = await groupSkills(SKILLS, ask);
  assert.deepEqual(names(groups), [
    ['Code review', ['review', 'triage']],
    ['shipping', ['commits', 'release']],
  ]);
  assert.equal(groups[0].skills[0], 'acme/Anvil:.claude/skills/review/SKILL.md');
  assert.deepEqual(warnings, []);
  assert.deepEqual(prompts, [groupPrompt(SKILLS)]);
});

test('the answer as Claude may give it: in a code block, after a sentence', async () => {
  const { groups } = await groupSkills(SKILLS, answering('Here they are:\n```json\n{"groups": [{"name": "All", "skills": [1, 2, 3, 4]}]}\n```').ask);
  assert.deepEqual(names(groups), [['All', ['commits', 'release', 'review', 'triage']]]);
});

test('a skill the answer leaves out: in Other, last; one listed twice: in its first group; unknown numbers and empty groups ignored', async () => {
  const answer = JSON.stringify({
    groups: [
      { name: 'Other', skills: [3] },
      { name: 'Shipping', skills: [1, 2, 9, 0, 'x'] },
      { name: 'Again', skills: [2] },
      { name: '  ', skills: [4] },
      { name: 'Empty', skills: [] },
    ],
  });
  const { groups, warnings } = await groupSkills(SKILLS, answering(answer).ask);
  assert.deepEqual(names(groups), [
    ['Shipping', ['commits', 'release']],
    ['Other', ['review', 'triage']],
  ]);
  assert.deepEqual(warnings, []);
});

test('Other in any case is Other, last', async () => {
  const answer = '{"groups": [{"name": " other ", "skills": [1]}, {"name": "Shipping", "skills": [2]}]}';
  const { groups } = await groupSkills(SKILLS, answering(answer).ask);
  assert.deepEqual(names(groups), [
    ['Shipping', ['release']],
    ['Other', ['commits', 'review', 'triage']],
  ]);
});

test('the same skills asked about once; a failure, or an answer that is not a grouping, asked again', async () => {
  const known: Groupings = new Map();
  const good = answering('{"groups": [{"name": "All", "skills": [1, 2, 3, 4]}]}');
  const results = await Promise.all([groupSkills(SKILLS, good.ask, known), groupSkills([...SKILLS].reverse(), good.ask, known)]);
  assert.deepEqual(await groupSkills(SKILLS, good.ask, known), results[0]);
  assert.deepEqual(results[1], results[0]);
  assert.equal(good.prompts.length, 1);

  const answers = [new Error('claude -p failed with exit code 1'), 'Sorry, I cannot.', '{"groups": [{"name": "All", "skills": [1, 2, 3, 4]}]}'];
  const prompts: string[] = [];
  const flaky: Model = async (prompt) => {
    prompts.push(prompt);
    const answer = answers.shift()!;
    if (answer instanceof Error) throw answer;
    return answer;
  };
  const again: Groupings = new Map();
  assert.deepEqual((await groupSkills(SKILLS, flaky, again)).warnings, ['Skills grouped by repository, not by affinity: claude -p failed with exit code 1']);
  assert.deepEqual((await groupSkills(SKILLS, flaky, again)).warnings, ['Skills grouped by repository, not by affinity: its answer is not JSON']);
  assert.deepEqual(names((await groupSkills(SKILLS, flaky, again)).groups), [['All', ['commits', 'release', 'review', 'triage']]]);
  assert.deepEqual(names((await groupSkills(SKILLS, flaky, again)).groups), [['All', ['commits', 'release', 'review', 'triage']]]);
  assert.equal(prompts.length, 3);
});

test('the model fails, or its answer is not a grouping → by repository, sorted ignoring case, and a warning', async () => {
  const byRepository = [
    ['acme/Anvil', ['review', 'triage']],
    ['acme/rocket', ['commits', 'release']],
  ];
  for (const [answer, reason] of [
    [new Error('claude is not installed'), 'claude is not installed'],
    ['I cannot help with that.', 'its answer is not JSON'],
    ['{"clusters": []}', 'its answer has no groups'],
    ['{"groups": [{"name": "Nothing", "skills": [7]}]}', 'its answer groups no skill'],
  ] as const) {
    const { groups, warnings } = await groupSkills(SKILLS, answering(answer).ask);
    assert.deepEqual(names(groups), byRepository, reason);
    assert.deepEqual(warnings, [`Skills grouped by repository, not by affinity: ${reason}`]);
  }
});

test('no skill: no group, and nothing asked', async () => {
  const { ask, prompts } = answering('{"groups": []}');
  assert.deepEqual(await groupSkills([], ask), { groups: [], warnings: [] });
  assert.deepEqual(prompts, []);
});

test('the tests replay Claude\'s recorded answers: the same groups every time; an unrecorded prompt is never sent', async () => {
  const { skills } = await scan(await openDirectory(FIXTURE));
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(await groupSkills(skills, model), {
      groups: [
        { name: 'Code Quality', skills: ['fixture:.github/skills/code-style/SKILL.md'] },
        { name: 'Commits & Releases', skills: ['fixture:.claude/skills/commits/SKILL.md', 'fixture:.agents/skills/release-checklist/SKILL.md'] },
      ],
      warnings: [],
    });
  }
  const { warnings } = await groupSkills(SKILLS, model);
  assert.deepEqual(warnings, ['Skills grouped by repository, not by affinity: not recorded: 1. commits: Write commit messages.']);
});

/** An executable `claude` in a temporary directory: the shell script `body`. */
function fake(t: TestContext, body: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'skill-atlas-claude-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const command = join(directory, 'claude');
  writeFileSync(command, `#!/bin/sh\n${body}\n`);
  chmodSync(command, 0o755);
  return command;
}

test('the same skills in another repository: asked once, the groups with that repository\'s ids', async () => {
  const known: Groupings = new Map();
  const { ask, prompts } = answering('{"groups": [{"name": "All", "skills": [1, 2]}]}');
  const upstream = await groupSkills([skill('acme/tools', 'commits'), skill('acme/tools', 'review')], ask, known);
  const fork = await groupSkills([skill('me/tools', 'commits'), skill('me/tools', 'review')], ask, known);
  assert.deepEqual(upstream.groups, [{ name: 'All', skills: ['acme/tools:.claude/skills/commits/SKILL.md', 'acme/tools:.claude/skills/review/SKILL.md'] }]);
  assert.deepEqual(fork.groups, [{ name: 'All', skills: ['me/tools:.claude/skills/commits/SKILL.md', 'me/tools:.claude/skills/review/SKILL.md'] }]);
  assert.equal(prompts.length, 1);
});

test('claude -p: the prompt on its stdin, the answer on its stdout, with no tool and no MCP server', async (t) => {
  const { skills } = await scan(await openDirectory(FIXTURE));
  const answer = '{"groups": [{"name": "Code Quality", "skills": [1]}, {"name": "Commits & Releases", "skills": [2, 3]}]}';
  assert.equal(await claude({ command: FAKE_CLAUDE })(groupPrompt(skills)), answer);
  // A path from the directory it was started in, though claude runs elsewhere.
  assert.equal(await claude({ command: relative(process.cwd(), FAKE_CLAUDE) })(groupPrompt(skills)), answer);

  const log = join(mkdtempSync(join(tmpdir(), 'skill-atlas-log-')), 'asked');
  t.after(() => rmSync(log, { force: true }));
  const logged = claude({ command: fake(t, `printf '[%s]' "$@" >> ${log}; cat > /dev/null; echo '{"groups": []}'`) });
  assert.equal(await logged('one'), '{"groups": []}\n');
  assert.equal(readFileSync(log, 'utf8'), '[-p][--tools][][--strict-mcp-config]');
});

test('claude -p fails: not installed, an error, too long → why, for the warning; asked again next time', async (t) => {
  const missing = join(tmpdir(), 'no-such-claude');
  await assert.rejects(claude({ command: missing })('x'), { message: `${missing} is not installed` });
  const failing = fake(t, 'cat > /dev/null; echo "Not logged in · Please run /login"; exit 1');
  await assert.rejects(claude({ command: failing })('x'), { message: `${failing} -p failed: Not logged in · Please run /login` });
  const slow = fake(t, 'cat > /dev/null; exec sleep 5');
  await assert.rejects(claude({ command: slow, timeout: 200 })('x'), { message: `${slow} -p took longer than 0.2 s` });

  const flag = join(mkdtempSync(join(tmpdir(), 'skill-atlas-flag-')), 'ok');
  t.after(() => rmSync(flag, { force: true }));
  const flaky = claude({ command: fake(t, `cat > /dev/null; [ -f ${flag} ] && echo answer || exit 3`) });
  await assert.rejects(flaky('x'), { message: /failed with exit code 3$/ });
  writeFileSync(flag, '');
  assert.equal(await flaky('x'), 'answer\n');
});
