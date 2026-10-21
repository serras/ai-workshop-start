// The colors of spec/cli.md: what is in which style, through the context, and when the real CLI
// shows them: on a terminal, NO_COLOR off, FORCE_COLOR on; never in a pipe.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { run, type Context } from '../src/commands.ts';
import { openGitHubOrganization } from '../src/core/github.ts';
import { replay } from '../src/core/replay.ts';
import { CLI, EXAMPLE_COMMIT, FIXTURE, open } from './helpers.ts';

/** `skill-atlas <args>`, each styled text marked `<style>…</style>`, and on which stream. */
async function painted(args: string[], opener: Context['open'] = open) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(args, {
    open: opener,
    print: (text) => stdout.push(text),
    error: (text) => stderr.push(text),
    paint: (style, text, stream) => `<${style}${stream === 'err' ? ' err' : ''}>${text}</${style}>`,
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

test('a repository: the heading bold, each name bold cyan, its link faint', async () => {
  const example = await painted(['scan', 'github.com/JetBrains/example']);
  assert.equal(example.code, 0, example.stderr);
  assert.equal(
    example.stdout,
    [
      '<heading>JetBrains/example · 1 skill</heading>',
      '<name>commits</name> — Write commit messages the way this repository does.',
      `<faint>  https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md</faint>`,
    ].join('\n'),
  );
});

test('an organization: its summary and each repository bold, copies faint; no skill → `No skills found` faint', async () => {
  const organization = await painted(['scan', 'https://github.com/JetBrains']);
  assert.equal(organization.code, 0, organization.stderr);
  const lines = organization.stdout.split('\n');
  assert.deepEqual(
    lines.filter((line) => line.startsWith('<heading>')),
    [
      '<heading>JetBrains · 4 skills in 3 repositories</heading>',
      '<heading>JetBrains/example · 1 skill</heading>',
      '<heading>JetBrains/forked · 1 skill</heading>',
      '<heading>JetBrains/tools · 2 skills</heading>',
    ],
  );
  assert.ok(lines.includes('<faint>  also in .claude/skills/release/SKILL.md</faint>'));
  assert.ok(lines.includes('<name>triage</name>'));
  assert.match(organization.stderr, /^<warning err>warning: JetBrains\/tools: .*<\/warning>$/);
  const fetch = replay({
    'https://api.github.com/users/empty': { status: 200, body: { login: 'empty', type: 'Organization' } },
    'https://api.github.com/orgs/empty/repos?type=all&per_page=100&page=1': { status: 200, body: [] },
  });
  const empty = await painted(['scan', 'github.com/empty'], (input) => openGitHubOrganization(input, { fetch }));
  assert.equal(empty.stdout, '<heading>empty · 0 skills</heading>\n<faint>No skills found</faint>');
});

test('warnings yellow and errors red, both on stderr', async () => {
  const fixture = await painted(['scan', FIXTURE]);
  assert.match(fixture.stderr, /^<warning err>warning: \.agents\/skills\/release-checklist\/SKILL\.md: malformed front matter: .*<\/warning>$/);
  const missing = await painted(['scan', join(FIXTURE, 'no-such-directory')]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /^<error err>Not a GitHub URL or a readable directory: .*<\/error>$/);
});

/** The real CLI on ./fixture, with only these color variables set. */
function cli(env: Record<string, string>, args = ['scan', FIXTURE]) {
  const { FORCE_COLOR, NO_COLOR, NODE_DISABLE_COLORS, ...rest } = process.env;
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...rest, TERM: 'xterm-256color', ...env } });
}

const ESC = '\u001b[';

test('in a pipe: no colors, the text as it is', () => {
  const plain = cli({});
  assert.equal(plain.status, 0);
  assert.ok(!plain.stdout.includes(ESC) && !plain.stderr.includes(ESC));
  assert.match(plain.stdout, /^fixture · 3 skills$/m);
});

test('FORCE_COLOR: the colors, even in a pipe', () => {
  const forced = cli({ FORCE_COLOR: '1' });
  assert.equal(forced.status, 0);
  assert.ok(forced.stdout.startsWith(`${ESC}1mfixture · 3 skills${ESC}22m\n`));
  assert.ok(forced.stdout.includes(`${ESC}1m${ESC}36mcommits${ESC}39m${ESC}22m — Write commit messages`));
  assert.match(forced.stdout, /\u001b\[2m {2}file:\/\/.*commits\/SKILL\.md\u001b\[22m/);
  assert.ok(forced.stderr.startsWith(`${ESC}33mwarning: `));
  const failed = cli({ FORCE_COLOR: '1' }, ['scan', join(FIXTURE, 'no-such-directory')]);
  assert.equal(failed.status, 1);
  assert.ok(failed.stderr.startsWith(`${ESC}31mNot a GitHub URL or a readable directory`));
  // Without the colors, the same text.
  assert.equal(forced.stdout.replace(/\u001b\[\d+m/g, ''), cli({}).stdout);
});

// `script` gives the CLI a terminal; util-linux's, as on the CI's Linux.
const terminal = process.platform === 'linux' && spawnSync('script', ['--version']).status === 0;

test('on a terminal: the colors; NO_COLOR turns them off', { skip: !terminal && 'no util-linux script' }, () => {
  const onTerminal = (env: string) =>
    spawnSync('script', ['-qec', `${env} TERM=xterm-256color "${process.execPath}" "${CLI}" scan "${FIXTURE}"`, '/dev/null'], {
      encoding: 'utf8',
      env: (({ FORCE_COLOR, NO_COLOR, NODE_DISABLE_COLORS, ...rest }) => rest)(process.env),
    }).stdout;
  assert.ok(onTerminal('').includes(`${ESC}1m${ESC}36mcommits${ESC}39m${ESC}22m`));
  const off = onTerminal('NO_COLOR=1');
  assert.match(off, /fixture · 3 skills/);
  assert.ok(!off.includes(ESC));
});
